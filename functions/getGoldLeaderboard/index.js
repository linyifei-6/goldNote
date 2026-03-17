const cloud = require('wx-server-sdk')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const db = cloud.database()

function toNumber(value) {
  const num = Number(value)
  return Number.isFinite(num) ? num : 0
}

function normalizeUser(doc) {
  if (!doc) return null
  const openId = String(doc.openId || '').trim()
  const id = openId || String(doc.id || doc._id || '').trim()
  if (!id) return null
  return {
    id,
    nickname: String(doc.nickname || '用户').slice(0, 20),
    avatarUrl: String(doc.avatarUrl || '').trim()
  }
}

function normalizeTransaction(doc) {
  return {
    id: String((doc && doc.id) || ''),
    userId: String((doc && doc.userId) || '').trim(),
    type: doc && doc.type === 'sell' ? 'sell' : 'buy',
    price: toNumber(doc && doc.price),
    weight: toNumber(doc && doc.weight),
    net_amount: toNumber(doc && doc.net_amount),
    timestamp: String((doc && doc.timestamp) || ''),
    date: String((doc && doc.date) || '')
  }
}

function sortTransactionsForReplay(transactions) {
  const list = (transactions || []).slice()
  list.sort((a, b) => {
    const aTs = String(a.timestamp || '')
    const bTs = String(b.timestamp || '')
    if (aTs === bTs) {
      return String(a.id || '').localeCompare(String(b.id || ''))
    }
    return aTs > bTs ? 1 : -1
  })
  return list
}

function calculateHoldings(transactions) {
  const ordered = sortTransactionsForReplay(transactions)
  let currentHolding = 0
  let avgCost = 0
  let realizedProfit = 0
  let totalInvestment = 0
  let costPool = 0

  ordered.forEach((tx) => {
    if (tx.type === 'buy') {
      const buyAmount = tx.price * tx.weight
      currentHolding += tx.weight
      costPool += buyAmount
      totalInvestment += buyAmount
      avgCost = currentHolding > 0 ? costPool / currentHolding : 0
      return
    }

    if (tx.type === 'sell') {
      if (tx.weight <= 0 || currentHolding <= 0 || tx.weight > currentHolding + 1e-8) {
        return
      }

      const effectiveSellPrice = tx.net_amount > 0 ? tx.net_amount / tx.weight : tx.price * 0.996
      realizedProfit += tx.weight * (effectiveSellPrice - avgCost)

      const reduction = avgCost * tx.weight
      currentHolding -= tx.weight
      costPool -= reduction
      if (currentHolding <= 1e-8) {
        currentHolding = 0
        costPool = 0
        avgCost = 0
      } else {
        avgCost = costPool / currentHolding
      }
    }
  })

  return {
    currentHolding,
    avgCost,
    realizedProfit,
    totalInvestment
  }
}

function buildLatestTransaction(transactions) {
  const list = (transactions || []).slice().sort((a, b) => {
    const aTs = String(a.timestamp || '')
    const bTs = String(b.timestamp || '')
    if (aTs === bTs) {
      return String(a.id || '') < String(b.id || '') ? 1 : -1
    }
    return aTs < bTs ? 1 : -1
  })
  const latest = list[0]
  if (!latest) {
    return null
  }
  return {
    id: latest.id,
    type: latest.type,
    price: latest.price,
    weight: latest.weight,
    date: latest.date,
    timestamp: latest.timestamp
  }
}

async function fetchAllDocs(collectionName, query = {}) {
  const pageSize = 100
  let offset = 0
  let all = []

  while (true) {
    const batch = await db.collection(collectionName).where(query).skip(offset).limit(pageSize).get()
    const data = (batch && batch.data) || []
    all = all.concat(data)
    if (data.length < pageSize) {
      break
    }
    offset += pageSize
  }

  return all
}

async function getFollowerCountMap() {
  try {
    const relations = await fetchAllDocs('social_relations_gold', {
      type: 'follow',
      status: 'accepted'
    })

    const map = {}
    relations.forEach((item) => {
      const targetId = String((item && item.targetId) || '').trim()
      if (!targetId) {
        return
      }
      map[targetId] = (map[targetId] || 0) + 1
    })
    return map
  } catch (error) {
    return {}
  }
}

function buildTop10(list, compare) {
  return list
    .slice()
    .sort(compare)
    .slice(0, 10)
    .map((item, index) => ({
      ...item,
      rank: index + 1
    }))
}

exports.main = async (event) => {
  const currentPrice = toNumber(event && event.currentPrice)

  try {
    const [userDocs, transactionDocs, followerCountMap] = await Promise.all([
      fetchAllDocs('users'),
      fetchAllDocs('transactions'),
      getFollowerCountMap()
    ])

    const users = userDocs.map(normalizeUser).filter(Boolean)
    const txMap = {}

    transactionDocs.map(normalizeTransaction).forEach((tx) => {
      if (!tx.userId) {
        return
      }
      if (!txMap[tx.userId]) {
        txMap[tx.userId] = []
      }
      txMap[tx.userId].push(tx)
    })

    const items = users.map((user) => {
      const txList = txMap[user.id] || []
      const holdings = calculateHoldings(txList)
      const unrealizedProfit = currentPrice > 0
        ? holdings.currentHolding * (currentPrice - holdings.avgCost)
        : 0
      const totalProfit = holdings.realizedProfit

      return {
        user,
        followerCount: toNumber(followerCountMap[user.id]),
        contentCount: txList.length,
        currentHolding: toNumber(holdings.currentHolding),
        totalProfit,
        totalInvestment: toNumber(holdings.totalInvestment),
        latestTransaction: buildLatestTransaction(txList)
      }
    })

    return {
      success: true,
      data: {
        profit: buildTop10(items, (a, b) => b.totalProfit - a.totalProfit),
        fans: buildTop10(items, (a, b) => b.followerCount - a.followerCount),
        holding: buildTop10(items, (a, b) => b.currentHolding - a.currentHolding)
      }
    }
  } catch (error) {
    console.error('获取黄金排行榜失败', error)
    return {
      success: false,
      message: '获取黄金排行榜失败',
      error: error.message
    }
  }
}