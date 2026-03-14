const CURRENT_USER_KEY = 'gold_current_user'
const USER_LIST_KEY = 'gold_users'
const LEGACY_STORAGE_KEY = 'gold_transactions'
const WEDDING_PROFILE_PREFIX = 'wedding_profile'
const WEDDING_NOTES_PREFIX = 'wedding_notes'
const WEDDING_TASKS_PREFIX = 'wedding_tasks'
const WEDDING_EXPENSES_PREFIX = 'wedding_expenses'
const WEDDING_INVITE_PREFIX = 'wedding_invite'
const CSV_HEADER = 'id,type,price,weight,platform,date,fee_rate,fee_amount,net_amount,timestamp\n'
const PLATFORMS = ['民生', '招商', '浙商', '其他']
const CLOUD_TX_LIMIT = 1000
const PROFILE_MAIN_ID = 'PROFILE_MAIN'
const INVITE_MAIN_ID = 'INVITE_MAIN'

function platformCode(platform) {
  const map = {
    民生: 'MS',
    招商: 'ZS',
    浙商: 'ZH',
    其他: 'OT'
  }
  return map[platform] || 'OT'
}

function sanitizePlatform(platform) {
  return String(platform || '').trim().slice(0, 20)
}

function normalizePlatformName(platform, allowEmpty) {
  const text = sanitizePlatform(platform)
  if (!text) {
    return allowEmpty ? '' : '其他'
  }
  if (PLATFORMS.includes(text)) {
    return text
  }
  return '其他'
}

function getTransactionsStorageKey(userId) {
  return `gold_transactions_${userId}`
}

function getWeddingProfileStorageKey(userId) {
  return `${WEDDING_PROFILE_PREFIX}_${userId}`
}

function getWeddingNotesStorageKey(userId) {
  return `${WEDDING_NOTES_PREFIX}_${userId}`
}

function getWeddingTasksStorageKey(userId) {
  return `${WEDDING_TASKS_PREFIX}_${userId}`
}

function getWeddingExpensesStorageKey(userId) {
  return `${WEDDING_EXPENSES_PREFIX}_${userId}`
}

function getWeddingInviteStorageKey(userId) {
  return `${WEDDING_INVITE_PREFIX}_${userId}`
}

function getUsers() {
  try {
    const users = wx.getStorageSync(USER_LIST_KEY)
    return Array.isArray(users) ? users : []
  } catch (error) {
    console.error('获取用户列表失败', error)
    return []
  }
}

function saveUsers(users) {
  wx.setStorageSync(USER_LIST_KEY, users)
}

/**
 * 微信登录
 * @param {Object} user 微信用户对象（包含nickname、avatarUrl、code等）
 * @returns {Object} 登录后的用户对象
 */
function loginByWechat(user) {
  try {
    if (!user || !user.id || !user.nickname) {
      return null
    }

    const openId = String(user.openId || '').trim()
    const stableId = String(user.id || '').trim()

    // 检查是否已存在该微信用户（优先 openId，其次稳定 id）
    const users = getUsers()
    const existedUser = users.find((u) => {
      if (!u || !u.isWechatAuth) {
        return false
      }

      const targetOpenId = String(u.openId || '').trim()
      if (openId && targetOpenId && targetOpenId === openId) {
        return true
      }

      return String(u.id || '').trim() === stableId
    })
    
    if (existedUser) {
      // 更新用户信息（昵称可修改，但身份不变）
      const nextAvatarUrl = String(user.avatarUrl || '').trim()
      existedUser.id = stableId
      existedUser.openId = openId || existedUser.openId || ''
      existedUser.nickname = user.nickname
      existedUser.avatarUrl = nextAvatarUrl || existedUser.avatarUrl || ''
      existedUser.gender = user.gender
      existedUser.province = user.province
      existedUser.country = user.country
      existedUser.lastLoginAt = new Date().toISOString()
      saveUsers(users)
      wx.setStorageSync(CURRENT_USER_KEY, existedUser)
      return existedUser
    }

    // 新用户，直接保存
    user.avatarUrl = String(user.avatarUrl || '').trim()
    user.id = stableId
    user.openId = openId
    user.lastLoginAt = new Date().toISOString()
    users.push(user)
    saveUsers(users)
    wx.setStorageSync(CURRENT_USER_KEY, user)
    migrateLegacyDataToUser(user.id)
    return user
  } catch (error) {
    console.error('微信登录失败', error)
    return null
  }
}

function logout() {
  wx.removeStorageSync(CURRENT_USER_KEY)
}

function getCurrentUser() {
  try {
    const user = wx.getStorageSync(CURRENT_USER_KEY)
    if (user && user.id && user.nickname && user.isWechatAuth) {
      return user
    }

    if (user && user.id && user.nickname && !user.isWechatAuth) {
      wx.removeStorageSync(CURRENT_USER_KEY)
    }

    return null
  } catch (error) {
    console.error('获取当前用户失败', error)
    return null
  }
}

function requireCurrentUser() {
  const user = getCurrentUser()
  if (!user) {
    throw new Error('未登录')
  }
  return user
}

function canUseCloud() {
  return !!(wx && wx.cloud && typeof wx.cloud.callFunction === 'function')
}

function normalizeTransaction(item) {
  return {
    id: String(item.id || ''),
    type: item.type,
    price: Number(item.price) || 0,
    weight: Number(item.weight) || 0,
    platform: normalizePlatformName(item.platform, false),
    date: sanitizeWeddingDate(item.date),
    fee_rate: Number(item.fee_rate) || 0,
    fee_amount: Number(item.fee_amount) || 0,
    net_amount: Number(item.net_amount) || 0,
    timestamp: String(item.timestamp || '')
  }
}

async function syncTransactionsFromCloud(userId) {
  const activeUserId = userId || requireCurrentUser().id

  if (!canUseCloud()) {
    return { success: false, message: 'cloud-unavailable', data: getTransactions(activeUserId) }
  }

  try {
    const res = await wx.cloud.callFunction({
      name: 'getTransactions',
      data: {
        userId: activeUserId,
        limit: CLOUD_TX_LIMIT,
        offset: 0
      }
    })

    const result = (res && res.result) || {}
    if (!result.success) {
      return { success: false, message: result.message || '云端读取失败', data: getTransactions(activeUserId) }
    }

    const list = Array.isArray(result.data) ? result.data.map(normalizeTransaction) : []
    saveTransactions(list, activeUserId)
    return { success: true, data: list }
  } catch (error) {
    console.error('云同步交易失败', error)
    return { success: false, message: error.message || '云同步失败', data: getTransactions(activeUserId) }
  }
}

async function saveTransactionAsync(input) {
  const activeUserId = requireCurrentUser().id

  if (!canUseCloud()) {
    return saveTransaction(input)
  }

  try {
    const res = await wx.cloud.callFunction({
      name: 'saveTransaction',
      data: {
        action: 'create',
        userId: activeUserId,
        transaction: input
      }
    })

    const result = (res && res.result) || { success: false, message: '云端保存失败' }
    if (!result.success) {
      return { success: false, message: result.message || '云端保存失败' }
    }

    await syncTransactionsFromCloud(activeUserId)
    return { success: true, transaction: result.transaction || null }
  } catch (error) {
    console.error('云端保存交易失败', error)
    return { success: false, message: error.message || '云端保存失败' }
  }
}

async function updateTransactionAsync(transactionId, input) {
  const activeUserId = requireCurrentUser().id

  if (!canUseCloud()) {
    return updateTransaction(transactionId, input)
  }

  try {
    const res = await wx.cloud.callFunction({
      name: 'saveTransaction',
      data: {
        action: 'update',
        userId: activeUserId,
        transaction: {
          id: transactionId,
          ...input
        }
      }
    })

    const result = (res && res.result) || { success: false, message: '云端更新失败' }
    if (!result.success) {
      return { success: false, message: result.message || '云端更新失败' }
    }

    await syncTransactionsFromCloud(activeUserId)
    return { success: true }
  } catch (error) {
    console.error('云端更新交易失败', error)
    return { success: false, message: error.message || '云端更新失败' }
  }
}

async function deleteTransactionAsync(transactionId) {
  const activeUserId = requireCurrentUser().id

  if (!canUseCloud()) {
    return deleteTransaction(transactionId)
  }

  try {
    const res = await wx.cloud.callFunction({
      name: 'saveTransaction',
      data: {
        action: 'delete',
        userId: activeUserId,
        transaction: {
          id: transactionId
        }
      }
    })

    const result = (res && res.result) || { success: false, message: '云端删除失败' }
    if (!result.success) {
      return { success: false, message: result.message || '云端删除失败' }
    }

    await syncTransactionsFromCloud(activeUserId)
    return { success: true }
  } catch (error) {
    console.error('云端删除交易失败', error)
    return { success: false, message: error.message || '云端删除失败' }
  }
}

function parseCSV(csvData) {
  const text = String(csvData || '').trim()
  if (!text) return []

  const lines = text.split('\n')
  if (lines.length <= 1) return []

  const transactions = []
  for (let index = 1; index < lines.length; index++) {
    const line = lines[index].trim()
    if (!line) continue

    const values = line.split(',')
    if (values.length >= 10) {
      const price = parseFloat(values[2])
      const weight = parseFloat(values[3])
      const fee_rate = parseFloat(values[6])
      const fee_amount = parseFloat(values[7])
      const net_amount = parseFloat(values[8])

      if (!isNaN(price) && !isNaN(weight)) {
        transactions.push({
          id: (values[0] || '').trim(),
          type: (values[1] || '').trim(),
          price: price,
          weight: weight,
          platform: normalizePlatformName((values[4] || '').trim(), false),
          date: (values[5] || '').trim(),
          fee_rate: !isNaN(fee_rate) ? fee_rate : 0,
          fee_amount: !isNaN(fee_amount) ? fee_amount : 0,
          net_amount: !isNaN(net_amount) ? net_amount : 0,
          timestamp: (values[9] || '').trim()
        })
      }
    }
  }
  return transactions
}

function convertToCSV(transactions) {
  let csv = CSV_HEADER
  transactions.forEach(tx => {
    csv += `${tx.id},${tx.type},${tx.price},${tx.weight},${tx.platform},${tx.date},${tx.fee_rate},${tx.fee_amount},${tx.net_amount},${tx.timestamp}\n`
  })
  return csv
}

function migrateLegacyDataToUser(userId) {
  try {
    const legacyCSV = wx.getStorageSync(LEGACY_STORAGE_KEY)
    if (!legacyCSV) return

    const key = getTransactionsStorageKey(userId)
    const current = wx.getStorageSync(key)
    if (current) return

    wx.setStorageSync(key, legacyCSV)
    wx.removeStorageSync(LEGACY_STORAGE_KEY)
  } catch (error) {
    console.error('迁移历史数据失败', error)
  }
}

function getTransactions(userId) {
  try {
    const activeUserId = userId || requireCurrentUser().id
    const csvData = wx.getStorageSync(getTransactionsStorageKey(activeUserId))
    if (!csvData) return []
    return parseCSV(csvData)
  } catch (error) {
    console.error('获取交易记录失败', error)
    return []
  }
}

function saveTransactions(transactions, userId) {
  const activeUserId = userId || requireCurrentUser().id
  const csvData = convertToCSV(transactions)
  wx.setStorageSync(getTransactionsStorageKey(activeUserId), csvData)
}

function clearTransactions(userId) {
  saveTransactions([], userId)
}

async function clearTransactionsAsync(userId) {
  const activeUserId = userId || requireCurrentUser().id

  // 先清本地，确保用户立即看到清空结果。
  saveTransactions([], activeUserId)

  if (!canUseCloud()) {
    return { success: true, localOnly: true }
  }

  try {
    const res = await wx.cloud.callFunction({
      name: 'saveTransaction',
      data: {
        action: 'clearAll',
        userId: activeUserId
      }
    })

    const result = (res && res.result) || { success: false, message: '云端清空失败' }
    if (!result.success) {
      await syncTransactionsFromCloud(activeUserId)
      return { success: false, message: result.message || '云端清空失败' }
    }

    return {
      success: true,
      deletedCount: Number(result.deletedCount) || 0
    }
  } catch (error) {
    console.error('云端清空交易失败', error)
    await syncTransactionsFromCloud(activeUserId)
    return { success: false, message: error.message || '云端清空失败' }
  }
}

function sortTransactionsForReplay(transactions) {
  return [...transactions].sort((a, b) => {
    const left = a.timestamp || `${a.date} 00:00:00`
    const right = b.timestamp || `${b.date} 00:00:00`
    if (left === right) return 0
    return left > right ? 1 : -1
  })
}

function validateTransactionSequence(transactions) {
  const ordered = sortTransactionsForReplay(transactions)
  const holdingByPlatform = {}

  for (let index = 0; index < ordered.length; index++) {
    const tx = ordered[index]
    const platform = tx.platform
    const currentHolding = holdingByPlatform[platform] || 0

    if (tx.type === 'buy') {
      holdingByPlatform[platform] = currentHolding + tx.weight
      continue
    }

    if (tx.type === 'sell') {
      if (tx.weight > currentHolding + 1e-8) {
        return {
          valid: false,
          failedTransaction: tx,
          message: `交易 ${tx.id} 在平台 ${platform} 卖出克数超过当时持仓`
        }
      }
      holdingByPlatform[platform] = currentHolding - tx.weight
    }
  }

  return { valid: true }
}

function calculateHoldings(transactions) {
  const ordered = sortTransactionsForReplay(transactions || [])

  let currentHolding = 0
  let avgCost = 0
  let realizedProfit = 0
  let totalInvestment = 0
  let costPool = 0

  ordered.forEach(tx => {
    if (tx.type === 'buy') {
      const buyAmount = tx.price * tx.weight
      currentHolding += tx.weight
      costPool += buyAmount
      totalInvestment += buyAmount
      avgCost = currentHolding > 0 ? costPool / currentHolding : 0
    } else if (tx.type === 'sell') {
      if (tx.weight <= 0 || currentHolding <= 0 || tx.weight > currentHolding + 1e-8) {
        return
      }

      const netAmount = Number(tx.net_amount)
      const effectiveSellPrice = netAmount > 0
        ? netAmount / tx.weight
        : tx.price * 0.996
      const sellProfit = tx.weight * (effectiveSellPrice - avgCost)
      realizedProfit += sellProfit

      const costReduction = avgCost * tx.weight
      currentHolding -= tx.weight
      costPool -= costReduction

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

function calculateAveragePrice(transactions, type) {
  const filtered = (transactions || []).filter(tx => tx.type === type)
  if (filtered.length === 0) return null

  let totalAmount = 0
  let totalWeight = 0
  let totalFee = 0

  filtered.forEach(tx => {
    totalAmount += tx.price * tx.weight
    totalWeight += tx.weight
    totalFee += (tx.fee_amount || 0)
  })

  return {
    avgPrice: totalWeight > 0 ? totalAmount / totalWeight : 0,
    totalWeight,
    totalAmount,
    totalFee,
    count: filtered.length
  }
}

function filterByDateRange(transactions, startDate, endDate) {
  return (transactions || []).filter(tx => tx.date >= startDate && tx.date <= endDate)
}

function buildTransactionFromInput(input, options = {}) {
  const now = new Date()
  const date = input.date || now.toISOString().split('T')[0]
  const timeText = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`
  const timestamp = `${date} ${timeText}`

  const price = parseFloat(input.price)
  const weight = parseFloat(input.weight)
  const type = input.type
  const platform = normalizePlatformName(input.platform, false)

  let feeRate = 0
  let feeAmount = 0
  let netAmount = 0

  if (type === 'sell') {
    // 招商平台卖出不收手续费，其他平台收0.4%手续费
    if (platform === '招商') {
      feeRate = 0
      feeAmount = 0
      netAmount = price * weight
    } else {
      feeRate = 0.004
      feeAmount = price * weight * feeRate
      netAmount = price * weight * 0.996
    }
  } else {
    netAmount = -(price * weight)
  }

  return {
    id: options.id,
    type,
    price,
    weight,
    platform,
    date,
    fee_rate: feeRate,
    fee_amount: feeAmount,
    net_amount: netAmount,
    timestamp
  }
}

function validateTransactionInput(input, transactions, editingId) {
  const price = parseFloat(input.price)
  const weight = parseFloat(input.weight)
  const type = input.type
  const rawPlatform = sanitizePlatform(input.platform)
  const platform = normalizePlatformName(rawPlatform, true)

  if (!type || (type !== 'buy' && type !== 'sell')) {
    return { valid: false, message: '交易类型无效' }
  }

  if (!platform) {
    return { valid: false, message: '交易平台不能为空' }
  }

  if (!(price > 0)) {
    return { valid: false, message: '成交价格必须大于0' }
  }

  if (!(weight > 0)) {
    return { valid: false, message: '交易克数必须大于0' }
  }

  const baseList = [...(transactions || [])]
  const composed = buildTransactionFromInput(input, { id: editingId || 'TEMP' })

  let nextList = []
  if (editingId) {
    nextList = baseList.map(tx => (tx.id === editingId ? composed : tx))
  } else {
    nextList = [...baseList, composed]
  }

  const result = validateTransactionSequence(nextList)
  if (!result.valid) {
    return {
      valid: false,
      message: type === 'sell' ? '卖出克数超过该平台当时持仓，无法保存' : result.message
    }
  }

  return { valid: true }
}

function generateTransactionId(platform, transactions) {
  const code = platformCode(platform)
  const maxSerial = (transactions || []).reduce((max, tx) => {
    const matched = String(tx.id || '').match(new RegExp(`^${code}(\\d{4,})$`))
    if (!matched) return max
    const serial = parseInt(matched[1], 10)
    return serial > max ? serial : max
  }, 0)

  return `${code}${String(maxSerial + 1).padStart(4, '0')}`
}

function saveTransaction(input) {
  try {
    const transactions = getTransactions()
    const check = validateTransactionInput(input, transactions)
    if (!check.valid) {
      return { success: false, message: check.message }
    }

    const tx = buildTransactionFromInput(input, {
      id: generateTransactionId(input.platform, transactions)
    })

    const next = [...transactions, tx]
    saveTransactions(next)
    return { success: true, transaction: tx }
  } catch (error) {
    console.error('保存交易记录失败', error)
    return { success: false, message: '保存失败，请重试' }
  }
}

function updateTransaction(transactionId, input) {
  try {
    const transactions = getTransactions()
    const target = transactions.find(tx => tx.id === transactionId)
    if (!target) {
      return { success: false, message: '记录不存在' }
    }

    const merged = {
      type: input.type || target.type,
      price: input.price,
      weight: input.weight,
      platform: input.platform,
      date: input.date || target.date
    }

    const check = validateTransactionInput(merged, transactions, transactionId)
    if (!check.valid) {
      return { success: false, message: check.message }
    }

    const rebuilt = buildTransactionFromInput(merged, { id: transactionId })
    const next = transactions.map(tx => (tx.id === transactionId ? rebuilt : tx))
    saveTransactions(next)

    return { success: true, transaction: rebuilt }
  } catch (error) {
    console.error('更新交易记录失败', error)
    return { success: false, message: '更新失败，请重试' }
  }
}

function deleteTransaction(transactionId) {
  try {
    const transactions = getTransactions()
    const next = transactions.filter(tx => tx.id !== transactionId)

    const result = validateTransactionSequence(next)
    if (!result.valid) {
      return { success: false, message: '删除后会导致历史持仓异常，无法删除' }
    }

    saveTransactions(next)
    return { success: true }
  } catch (error) {
    console.error('删除交易记录失败', error)
    return { success: false, message: '删除失败，请重试' }
  }
}

function buildProfitCurve(transactions, selectedPlatform) {
  const list = selectedPlatform && selectedPlatform !== '全部'
    ? (transactions || []).filter(tx => tx.platform === selectedPlatform)
    : [...(transactions || [])]

  const ordered = sortTransactionsForReplay(list)
  let holding = 0
  let costPool = 0
  let avgCost = 0
  let cumulativeProfit = 0

  const points = []
  ordered.forEach(tx => {
    if (tx.type === 'buy') {
      holding += tx.weight
      costPool += tx.price * tx.weight
      avgCost = holding > 0 ? costPool / holding : 0
    } else if (tx.type === 'sell' && tx.weight <= holding + 1e-8) {
      const netAmount = Number(tx.net_amount)
      const effectiveSellPrice = netAmount > 0
        ? netAmount / tx.weight
        : tx.price * 0.996
      const profit = tx.weight * (effectiveSellPrice - avgCost)
      cumulativeProfit += profit
      const reduction = avgCost * tx.weight
      holding -= tx.weight
      costPool -= reduction
      avgCost = holding > 0 ? costPool / holding : 0
    }

    points.push({
      id: tx.id,
      label: tx.date,
      value: cumulativeProfit
    })
  })

  return points
}

function callWeddingCloud(action, dataType, data, userId) {
  if (!canUseCloud()) {
    return Promise.resolve({ success: false, message: 'cloud-unavailable' })
  }

  const activeUserId = userId || requireCurrentUser().id
  return wx.cloud.callFunction({
    name: 'saveWeddingData',
    data: {
      action,
      dataType,
      data,
      userId: activeUserId
    }
  }).then(res => (res && res.result) || { success: false, message: '云函数调用失败' })
}

function fireAndForget(promise, label) {
  if (!promise || typeof promise.then !== 'function') {
    return
  }
  promise.catch(error => {
    console.warn(label || '后台同步失败', error)
  })
}

function normalizeWeddingCloudProfile(list) {
  const first = Array.isArray(list) && list.length > 0 ? list[0] : null
  if (!first) {
    return { weddingDate: '', location: '', totalBudget: 0, hasSaved: false }
  }
  return {
    weddingDate: sanitizeWeddingDate(first.weddingDate),
    location: sanitizeWeddingText(first.location, 40),
    totalBudget: Math.max(0, parseFloat(first.totalBudget) || 0),
    hasSaved: true
  }
}

async function syncWeddingDataFromCloud(userId) {
  const activeUserId = userId || requireCurrentUser().id
  if (!canUseCloud()) {
    return { success: false, message: 'cloud-unavailable' }
  }

  try {
    const read = (dataType) => wx.cloud.callFunction({
      name: 'getWeddingData',
      data: {
        dataType,
        userId: activeUserId
      }
    }).then(res => ((res && res.result && res.result.data) || []))

    const [profileDocs, taskDocs, expenseDocs, noteDocs, inviteDocs] = await Promise.all([
      read('profile'),
      read('tasks'),
      read('expenses'),
      read('notes'),
      read('invites')
    ])

    const profile = normalizeWeddingCloudProfile(profileDocs)
    wx.setStorageSync(getWeddingProfileStorageKey(activeUserId), {
      ...profile,
      updatedAt: new Date().toISOString()
    })

    const tasks = (Array.isArray(taskDocs) ? taskDocs : []).map(item => ({
      id: String(item.id || ''),
      title: sanitizeWeddingText(item.title, 60),
      type: sanitizeWeddingText(item.type, 20) || '其他',
      dueDate: sanitizeWeddingDate(item.dueDate),
      checked: !!item.checked,
      priority: normalizeTaskPriority(item.priority),
      budgetAmount: Math.max(0, parseFloat(item.budgetAmount) || 0),
      actualAmount: Math.max(0, parseFloat(item.actualAmount) || 0),
      note: sanitizeWeddingText(item.note, 300),
      sortOrder: Number(item.sortOrder) || 0,
      createdAt: item.createdAt || '',
      updatedAt: item.updatedAt || ''
    }))
    wx.setStorageSync(getWeddingTasksStorageKey(activeUserId), tasks)

    const expenses = (Array.isArray(expenseDocs) ? expenseDocs : []).map(item => ({
      id: String(item.id || ''),
      category: sanitizeExpenseCategory(item.category),
      amount: Math.max(0, parseFloat(item.amount) || 0),
      date: sanitizeWeddingDate(item.date),
      createdAt: item.createdAt || ''
    }))
    wx.setStorageSync(getWeddingExpensesStorageKey(activeUserId), expenses)

    const notes = (Array.isArray(noteDocs) ? noteDocs : []).map(item => ({
      id: String(item.id || ''),
      title: sanitizeWeddingText(item.title, 60),
      content: sanitizeWeddingText(item.content, 1000),
      module: sanitizeWeddingModule(item.module),
      stage: sanitizeWeddingStage(item.stage),
      status: sanitizeWeddingStatus(item.status),
      dueDate: sanitizeWeddingDate(item.dueDate),
      createdAt: item.createdAt || '',
      updatedAt: item.updatedAt || ''
    }))
    wx.setStorageSync(getWeddingNotesStorageKey(activeUserId), notes)

    const inviteDoc = Array.isArray(inviteDocs) && inviteDocs.length > 0 ? inviteDocs[0] : null
    const invite = inviteDoc
      ? {
          id: String(inviteDoc.id || INVITE_MAIN_ID),
          linkCode: sanitizeWeddingText(inviteDoc.linkCode, 20) || buildInviteCode(),
          message: sanitizeWeddingText(inviteDoc.message, 120) || '诚邀您见证我们的婚礼。',
          ownerName: sanitizeWeddingText(inviteDoc.ownerName, 30),
          invitees: Array.isArray(inviteDoc.invitees) ? inviteDoc.invitees.map(item => ({
            id: String(item.id || ''),
            name: sanitizeWeddingText(item.name, 30),
            status: sanitizeInviteStatus(item.status)
          })) : []
        }
      : {
          id: INVITE_MAIN_ID,
          linkCode: buildInviteCode(),
          message: '诚邀您见证我们的婚礼。',
          ownerName: sanitizeWeddingText(requireCurrentUser().nickname, 30),
          invitees: []
        }
    wx.setStorageSync(getWeddingInviteStorageKey(activeUserId), invite)

    return { success: true }
  } catch (error) {
    console.error('云同步备婚数据失败', error)
    return { success: false, message: error.message || '云同步失败' }
  }
}

async function getWeddingGuestViewByCodeAsync(code) {
  if (!canUseCloud()) {
    return getWeddingGuestViewByCode(code)
  }

  try {
    const res = await wx.cloud.callFunction({
      name: 'getWeddingData',
      data: {
        dataType: 'guestViewByCode',
        code: sanitizeWeddingText(code, 20)
      }
    })
    const result = (res && res.result) || {}
    if (!result.success || !result.data) {
      return null
    }
    return result.data
  } catch (error) {
    console.error('云端读取亲友页失败', error)
    return getWeddingGuestViewByCode(code)
  }
}

async function confirmWeddingGuestAttendanceByCodeAsync(code, guestName) {
  if (!canUseCloud()) {
    return confirmWeddingGuestAttendanceByCode(code, guestName)
  }

  try {
    const res = await wx.cloud.callFunction({
      name: 'saveWeddingData',
      data: {
        action: 'confirm',
        dataType: 'guestAttendanceByCode',
        code: sanitizeWeddingText(code, 20),
        guestName: sanitizeWeddingText(guestName, 30)
      }
    })
    const result = (res && res.result) || { success: false, message: '确认失败' }
    return result
  } catch (error) {
    console.error('云端确认出席失败', error)
    return { success: false, message: error.message || '确认失败，请重试' }
  }
}

function sanitizeWeddingDate(date) {
  const text = String(date || '').trim()
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : ''
}

function getWeddingProfile(userId) {
  try {
    const activeUserId = userId || requireCurrentUser().id
    const profile = wx.getStorageSync(getWeddingProfileStorageKey(activeUserId))
    if (!profile || typeof profile !== 'object') {
      return { weddingDate: '', location: '', totalBudget: 0 }
    }

    const budget = parseFloat(profile.totalBudget)
    return {
      weddingDate: sanitizeWeddingDate(profile.weddingDate),
      location: sanitizeWeddingText(profile.location, 40),
      totalBudget: budget > 0 ? budget : 0,
      hasSaved: profile.hasSaved === true
    }
  } catch (error) {
    console.error('获取备婚档案失败', error)
    return { weddingDate: '', location: '', totalBudget: 0, hasSaved: false }
  }
}

function saveWeddingProfile(input, userId) {
  try {
    const activeUserId = userId || requireCurrentUser().id
    const budget = parseFloat(input && input.totalBudget)
    const profile = {
      weddingDate: sanitizeWeddingDate(input && input.weddingDate),
      location: sanitizeWeddingText(input && input.location, 40),
      totalBudget: budget > 0 ? budget : 0,
      hasSaved: true,
      updatedAt: new Date().toISOString()
    }
    wx.setStorageSync(getWeddingProfileStorageKey(activeUserId), profile)
    fireAndForget(
      callWeddingCloud('upsert', 'profile', {
        id: PROFILE_MAIN_ID,
        weddingDate: profile.weddingDate,
        location: profile.location,
        totalBudget: profile.totalBudget,
        hasSaved: true
      }, activeUserId),
      '同步婚礼档案失败'
    )
    return {
      weddingDate: profile.weddingDate,
      location: profile.location,
      totalBudget: profile.totalBudget,
      hasSaved: profile.hasSaved
    }
  } catch (error) {
    console.error('保存备婚档案失败', error)
    return { weddingDate: '', location: '', totalBudget: 0, hasSaved: false }
  }
}

function clearWeddingAllData(userId) {
  try {
    const activeUserId = userId || requireCurrentUser().id
    const user = getCurrentUser() || { nickname: '新人' }

    const tasks = getWeddingTasks(activeUserId)
    const expenses = getWeddingExpenses(activeUserId)
    const notes = getWeddingNotes(activeUserId)

    const emptyProfile = {
      weddingDate: '',
      location: '',
      totalBudget: 0,
      hasSaved: false,
      updatedAt: new Date().toISOString()
    }

    const emptyInvite = {
      id: INVITE_MAIN_ID,
      linkCode: buildInviteCode(),
      message: '诚邀您见证我们的婚礼。',
      ownerName: sanitizeWeddingText(user.nickname, 30) || '新人',
      invitees: []
    }

    wx.setStorageSync(getWeddingProfileStorageKey(activeUserId), emptyProfile)
    wx.setStorageSync(getWeddingTasksStorageKey(activeUserId), [])
    wx.setStorageSync(getWeddingExpensesStorageKey(activeUserId), [])
    wx.setStorageSync(getWeddingNotesStorageKey(activeUserId), [])
    wx.setStorageSync(getWeddingInviteStorageKey(activeUserId), emptyInvite)

    fireAndForget(
      callWeddingCloud('upsert', 'profile', {
        id: PROFILE_MAIN_ID,
        weddingDate: '',
        location: '',
        totalBudget: 0,
        hasSaved: false
      }, activeUserId),
      '清空云端婚礼档案失败'
    )

    fireAndForget(
      callWeddingCloud('upsert', 'invites', emptyInvite, activeUserId),
      '重置云端邀请信息失败'
    )

    tasks.forEach(item => {
      if (!item || !item.id) return
      fireAndForget(callWeddingCloud('delete', 'tasks', { id: item.id }, activeUserId), '删除云端任务失败')
    })

    expenses.forEach(item => {
      if (!item || !item.id) return
      fireAndForget(callWeddingCloud('delete', 'expenses', { id: item.id }, activeUserId), '删除云端支出失败')
    })

    notes.forEach(item => {
      if (!item || !item.id) return
      fireAndForget(callWeddingCloud('delete', 'notes', { id: item.id }, activeUserId), '删除云端笔记失败')
    })

    return { success: true }
  } catch (error) {
    console.error('清空备婚数据失败', error)
    return { success: false, message: '清空失败，请重试' }
  }
}

function sanitizeWeddingText(value, max = 300) {
  return String(value || '').trim().slice(0, max)
}

function sanitizeWeddingStatus(status) {
  const map = ['未开始', '进行中', '已完成', '已逾期']
  return map.includes(status) ? status : '未开始'
}

function sanitizeWeddingModule(module) {
  const map = ['备婚流程', '预算管理', '任务提醒', '亲友协同', '备婚资料库']
  return map.includes(module) ? module : '备婚流程'
}

function sanitizeWeddingStage(stage) {
  const map = ['婚前12个月', '婚前10个月', '婚前6个月', '婚前3个月', '婚前1个月', '婚前1周', '婚礼当天']
  return map.includes(stage) ? stage : '婚前6个月'
}

function getWeddingNotes(userId) {
  try {
    const activeUserId = userId || requireCurrentUser().id
    const notes = wx.getStorageSync(getWeddingNotesStorageKey(activeUserId))
    if (!Array.isArray(notes)) {
      return []
    }

    return notes
      .filter(item => item && item.id)
      .map(item => ({
        id: String(item.id),
        title: sanitizeWeddingText(item.title, 60),
        content: sanitizeWeddingText(item.content, 1000),
        module: sanitizeWeddingModule(item.module),
        stage: sanitizeWeddingStage(item.stage),
        status: sanitizeWeddingStatus(item.status),
        dueDate: sanitizeWeddingDate(item.dueDate),
        createdAt: item.createdAt || '',
        updatedAt: item.updatedAt || ''
      }))
      .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
  } catch (error) {
    console.error('获取备婚笔记失败', error)
    return []
  }
}

function saveWeddingNotes(notes, userId) {
  const activeUserId = userId || requireCurrentUser().id
  const safeList = Array.isArray(notes) ? notes : []
  wx.setStorageSync(getWeddingNotesStorageKey(activeUserId), safeList)
  safeList.forEach(item => {
    fireAndForget(callWeddingCloud('upsert', 'notes', item, activeUserId), '同步备婚笔记失败')
  })
}

function createWeddingNote(input, userId) {
  try {
    const title = sanitizeWeddingText(input && input.title, 60)
    if (!title) {
      return { success: false, message: '标题不能为空' }
    }

    const now = new Date().toISOString()
    const note = {
      id: `WN${Date.now()}${Math.floor(Math.random() * 1000).toString().padStart(3, '0')}`,
      title,
      content: sanitizeWeddingText(input && input.content, 1000),
      module: sanitizeWeddingModule(input && input.module),
      stage: sanitizeWeddingStage(input && input.stage),
      status: sanitizeWeddingStatus(input && input.status),
      dueDate: sanitizeWeddingDate(input && input.dueDate),
      createdAt: now,
      updatedAt: now
    }

    const notes = getWeddingNotes(userId)
    saveWeddingNotes([note, ...notes], userId)
    return { success: true, note }
  } catch (error) {
    console.error('创建备婚笔记失败', error)
    return { success: false, message: '保存失败，请重试' }
  }
}

function updateWeddingNote(noteId, input, userId) {
  try {
    const notes = getWeddingNotes(userId)
    const index = notes.findIndex(item => item.id === noteId)
    if (index < 0) {
      return { success: false, message: '笔记不存在' }
    }

    const title = sanitizeWeddingText(input && input.title, 60)
    if (!title) {
      return { success: false, message: '标题不能为空' }
    }

    const updated = {
      ...notes[index],
      title,
      content: sanitizeWeddingText(input && input.content, 1000),
      module: sanitizeWeddingModule(input && input.module),
      stage: sanitizeWeddingStage(input && input.stage),
      status: sanitizeWeddingStatus(input && input.status),
      dueDate: sanitizeWeddingDate(input && input.dueDate),
      updatedAt: new Date().toISOString()
    }

    notes[index] = updated
    saveWeddingNotes(notes, userId)
    return { success: true, note: updated }
  } catch (error) {
    console.error('更新备婚笔记失败', error)
    return { success: false, message: '更新失败，请重试' }
  }
}

function deleteWeddingNote(noteId, userId) {
  try {
    const activeUserId = userId || requireCurrentUser().id
    const notes = getWeddingNotes(userId)
    const next = notes.filter(item => item.id !== noteId)
    saveWeddingNotes(next, userId)
    fireAndForget(callWeddingCloud('delete', 'notes', { id: noteId }, activeUserId), '删除云端备婚笔记失败')
    return { success: true }
  } catch (error) {
    console.error('删除备婚笔记失败', error)
    return { success: false, message: '删除失败，请重试' }
  }
}

function getWeddingTasks(userId) {
  try {
    const activeUserId = userId || requireCurrentUser().id
    const list = wx.getStorageSync(getWeddingTasksStorageKey(activeUserId))
    if (!Array.isArray(list)) {
      return []
    }

    return list
      .filter(item => item && item.id)
      .map(item => ({
        id: String(item.id),
        title: sanitizeWeddingText(item.title, 60),
        type: sanitizeWeddingText(item.type, 20) || '其他',
        dueDate: sanitizeWeddingDate(item.dueDate),
        checked: !!item.checked,
        priority: normalizeTaskPriority(item.priority),
        budgetAmount: Math.max(0, parseFloat(item.budgetAmount) || 0),
        actualAmount: Math.max(0, parseFloat(item.actualAmount) || 0),
        note: sanitizeWeddingText(item.note, 300),
        sortOrder: Number(item.sortOrder) || 0,
        createdAt: item.createdAt || '',
        updatedAt: item.updatedAt || ''
      }))
      .sort((a, b) => a.sortOrder - b.sortOrder)
  } catch (error) {
    console.error('获取备婚任务失败', error)
    return []
  }
}

function normalizeTaskPriority(priority) {
  const num = parseInt(priority, 10)
  if (!Number.isFinite(num)) return 3
  if (num < 1) return 1
  if (num > 5) return 5
  return num
}

function saveWeddingTasks(tasks, userId) {
  const activeUserId = userId || requireCurrentUser().id
  wx.setStorageSync(getWeddingTasksStorageKey(activeUserId), Array.isArray(tasks) ? tasks : [])
}

function createWeddingTask(input, userId) {
  try {
    const title = sanitizeWeddingText(input && input.title, 60)
    if (!title) {
      return { success: false, message: '任务名称不能为空' }
    }

    const now = new Date().toISOString()
    const tasks = getWeddingTasks(userId)
    const maxOrder = tasks.reduce((max, item) => {
      const current = Number(item.sortOrder) || 0
      return current > max ? current : max
    }, 0)

    const task = {
      id: `WT${Date.now()}${Math.floor(Math.random() * 1000).toString().padStart(3, '0')}`,
      title,
      type: sanitizeWeddingText(input && input.type, 20) || '其他',
      dueDate: sanitizeWeddingDate(input && input.dueDate),
      checked: false,
      priority: normalizeTaskPriority(input && input.priority),
      budgetAmount: Math.max(0, parseFloat(input && input.budgetAmount) || 0),
      actualAmount: Math.max(0, parseFloat(input && input.actualAmount) || 0),
      note: sanitizeWeddingText(input && input.note, 300),
      sortOrder: maxOrder + 1,
      createdAt: now,
      updatedAt: now
    }

    const activeUserId = userId || requireCurrentUser().id
    saveWeddingTasks([task, ...tasks], userId)
    fireAndForget(callWeddingCloud('upsert', 'tasks', task, activeUserId), '同步备婚任务失败')
    return { success: true, task }
  } catch (error) {
    console.error('新增备婚任务失败', error)
    return { success: false, message: '新增任务失败，请重试' }
  }
}

function toggleWeddingTask(taskId, checked, userId) {
  try {
    const activeUserId = userId || requireCurrentUser().id
    const tasks = getWeddingTasks(userId)
    const index = tasks.findIndex(item => item.id === taskId)
    if (index < 0) {
      return { success: false, message: '任务不存在' }
    }

    tasks[index] = {
      ...tasks[index],
      checked: !!checked,
      updatedAt: new Date().toISOString()
    }
    saveWeddingTasks(tasks, userId)
    fireAndForget(callWeddingCloud('upsert', 'tasks', tasks[index], activeUserId), '同步任务状态失败')
    return { success: true, task: tasks[index] }
  } catch (error) {
    console.error('更新任务状态失败', error)
    return { success: false, message: '更新失败，请重试' }
  }
}

function updateWeddingTask(taskId, input, userId) {
  try {
    const activeUserId = userId || requireCurrentUser().id
    const tasks = getWeddingTasks(userId)
    const index = tasks.findIndex(item => item.id === taskId)
    if (index < 0) {
      return { success: false, message: '任务不存在' }
    }

    const current = tasks[index]
    const nextTitle = sanitizeWeddingText(input && input.title, 60)
    if (!nextTitle) {
      return { success: false, message: '任务事项不能为空' }
    }

    tasks[index] = {
      ...current,
      title: nextTitle,
      type: sanitizeWeddingText(input && input.type, 20) || current.type || '其他',
      dueDate: sanitizeWeddingDate(input && input.dueDate) || current.dueDate,
      priority: normalizeTaskPriority(input && input.priority),
      budgetAmount: Math.max(0, parseFloat(input && input.budgetAmount) || 0),
      actualAmount: Math.max(0, parseFloat(input && input.actualAmount) || 0),
      note: sanitizeWeddingText(input && input.note, 300),
      updatedAt: new Date().toISOString()
    }

    saveWeddingTasks(tasks, userId)
    fireAndForget(callWeddingCloud('upsert', 'tasks', tasks[index], activeUserId), '同步更新任务失败')
    return { success: true, task: tasks[index] }
  } catch (error) {
    console.error('更新备婚任务失败', error)
    return { success: false, message: '更新失败，请重试' }
  }
}

function reorderWeddingTasks(taskIds, userId) {
  try {
    const activeUserId = userId || requireCurrentUser().id
    const ids = Array.isArray(taskIds) ? taskIds.map(String) : []
    if (ids.length === 0) {
      return { success: false, message: '排序数据为空' }
    }

    const tasks = getWeddingTasks(userId)
    const map = {}
    tasks.forEach(item => {
      map[item.id] = item
    })

    const reordered = []
    ids.forEach((id, index) => {
      if (!map[id]) {
        return
      }
      reordered.push({
        ...map[id],
        sortOrder: index + 1,
        updatedAt: new Date().toISOString()
      })
      delete map[id]
    })

    // Append any task not included in the payload to avoid accidental data loss.
    Object.keys(map).forEach((id) => {
      reordered.push({
        ...map[id],
        sortOrder: reordered.length + 1,
        updatedAt: new Date().toISOString()
      })
    })

    saveWeddingTasks(reordered, userId)
    reordered.forEach(item => {
      fireAndForget(callWeddingCloud('upsert', 'tasks', item, activeUserId), '同步任务排序失败')
    })
    return { success: true }
  } catch (error) {
    console.error('重排备婚任务失败', error)
    return { success: false, message: '任务重排失败，请重试' }
  }
}

function deleteWeddingTask(taskId, userId) {
  try {
    const activeUserId = userId || requireCurrentUser().id
    const tasks = getWeddingTasks(userId)
    const next = tasks.filter(item => item.id !== taskId)
    saveWeddingTasks(next, userId)
    fireAndForget(callWeddingCloud('delete', 'tasks', { id: taskId }, activeUserId), '删除云端任务失败')
    return { success: true }
  } catch (error) {
    console.error('删除备婚任务失败', error)
    return { success: false, message: '删除失败，请重试' }
  }
}

function restoreWeddingTask(task, userId) {
  try {
    if (!task || !task.id) {
      return { success: false, message: '任务数据无效' }
    }

    const tasks = getWeddingTasks(userId)
    const existed = tasks.find(item => item.id === task.id)
    if (existed) {
      return { success: false, message: '任务已存在' }
    }

    const restored = {
      id: String(task.id),
      title: sanitizeWeddingText(task.title, 60),
      type: sanitizeWeddingText(task.type, 20) || '其他',
      dueDate: sanitizeWeddingDate(task.dueDate),
      checked: !!task.checked,
      priority: normalizeTaskPriority(task.priority),
      budgetAmount: Math.max(0, parseFloat(task.budgetAmount) || 0),
      actualAmount: Math.max(0, parseFloat(task.actualAmount) || 0),
      note: sanitizeWeddingText(task.note, 300),
      sortOrder: Number(task.sortOrder) || 0,
      createdAt: task.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }

    const activeUserId = userId || requireCurrentUser().id
    saveWeddingTasks([restored, ...tasks], userId)
    fireAndForget(callWeddingCloud('upsert', 'tasks', restored, activeUserId), '恢复云端任务失败')
    return { success: true, task: restored }
  } catch (error) {
    console.error('恢复备婚任务失败', error)
    return { success: false, message: '恢复失败，请重试' }
  }
}

function sanitizeExpenseCategory(category) {
  return sanitizeWeddingText(category, 30)
}

function getWeddingExpenses(userId) {
  try {
    const activeUserId = userId || requireCurrentUser().id
    const list = wx.getStorageSync(getWeddingExpensesStorageKey(activeUserId))
    if (!Array.isArray(list)) {
      return []
    }

    return list
      .filter(item => item && item.id)
      .map(item => {
        const amount = parseFloat(item.amount)
        return {
          id: String(item.id),
          category: sanitizeExpenseCategory(item.category),
          amount: amount > 0 ? amount : 0,
          date: sanitizeWeddingDate(item.date),
          createdAt: item.createdAt || ''
        }
      })
      .sort((a, b) => {
        if (a.date === b.date) {
          return a.createdAt < b.createdAt ? 1 : -1
        }
        return a.date < b.date ? 1 : -1
      })
  } catch (error) {
    console.error('获取备婚支出失败', error)
    return []
  }
}

function saveWeddingExpenses(expenses, userId) {
  const activeUserId = userId || requireCurrentUser().id
  const safeList = Array.isArray(expenses) ? expenses : []
  wx.setStorageSync(getWeddingExpensesStorageKey(activeUserId), safeList)
  safeList.forEach(item => {
    fireAndForget(callWeddingCloud('upsert', 'expenses', item, activeUserId), '同步支出失败')
  })
}

function createWeddingExpense(input, userId) {
  try {
    const category = sanitizeExpenseCategory(input && input.category)
    const amount = parseFloat(input && input.amount)
    const date = sanitizeWeddingDate(input && input.date)

    if (!category) {
      return { success: false, message: '支出类别不能为空' }
    }
    if (!(amount > 0)) {
      return { success: false, message: '支出金额必须大于0' }
    }
    if (!date) {
      return { success: false, message: '请选择支出日期' }
    }

    const item = {
      id: `WE${Date.now()}${Math.floor(Math.random() * 1000).toString().padStart(3, '0')}`,
      category,
      amount,
      date,
      createdAt: new Date().toISOString()
    }

    const activeUserId = userId || requireCurrentUser().id
    const expenses = getWeddingExpenses(userId)
    saveWeddingExpenses([item, ...expenses], userId)
    fireAndForget(callWeddingCloud('upsert', 'expenses', item, activeUserId), '同步新增支出失败')
    return { success: true, expense: item }
  } catch (error) {
    console.error('新增备婚支出失败', error)
    return { success: false, message: '保存失败，请重试' }
  }
}

function deleteWeddingExpense(expenseId, userId) {
  try {
    const activeUserId = userId || requireCurrentUser().id
    const expenses = getWeddingExpenses(userId)
    const next = expenses.filter(item => item.id !== expenseId)
    saveWeddingExpenses(next, userId)
    fireAndForget(callWeddingCloud('delete', 'expenses', { id: expenseId }, activeUserId), '删除云端支出失败')
    return { success: true }
  } catch (error) {
    console.error('删除备婚支出失败', error)
    return { success: false, message: '删除失败，请重试' }
  }
}

function buildInviteCode() {
  const random = Math.random().toString(36).slice(2, 8)
  return `${Date.now().toString(36)}${random}`.slice(0, 12)
}

function sanitizeInviteStatus(status) {
  const map = ['已确认', '未确认']
  return map.includes(status) ? status : '未确认'
}

function getWeddingInvite(userId) {
  try {
    const activeUserId = userId || requireCurrentUser().id
    const raw = wx.getStorageSync(getWeddingInviteStorageKey(activeUserId))
    const base = raw && typeof raw === 'object' ? raw : {}

    const invitees = Array.isArray(base.invitees) ? base.invitees : []
    return {
      id: sanitizeWeddingText(base.id || INVITE_MAIN_ID, 40) || INVITE_MAIN_ID,
      linkCode: sanitizeWeddingText(base.linkCode || buildInviteCode(), 20),
      message: sanitizeWeddingText(base.message || '诚邀您见证我们的婚礼。', 120),
      ownerName: sanitizeWeddingText(base.ownerName || requireCurrentUser().nickname, 30),
      invitees: invitees
        .filter(item => item && item.id)
        .map(item => ({
          id: String(item.id),
          name: sanitizeWeddingText(item.name, 30),
          status: sanitizeInviteStatus(item.status)
        }))
    }
  } catch (error) {
    console.error('获取亲友邀请信息失败', error)
    return {
      id: INVITE_MAIN_ID,
      linkCode: buildInviteCode(),
      message: '诚邀您见证我们的婚礼。',
      ownerName: '新人',
      invitees: []
    }
  }
}

function saveWeddingInvite(invite, userId) {
  const activeUserId = userId || requireCurrentUser().id
  const currentUser = getCurrentUser() || { nickname: '新人' }
  const safeInvite = {
    id: sanitizeWeddingText(invite && invite.id, 40) || INVITE_MAIN_ID,
    linkCode: sanitizeWeddingText(invite && invite.linkCode, 20) || buildInviteCode(),
    message: sanitizeWeddingText(invite && invite.message, 120) || '诚邀您见证我们的婚礼。',
    ownerName: sanitizeWeddingText(invite && invite.ownerName, 30) || sanitizeWeddingText(currentUser.nickname, 30) || '新人',
    invitees: Array.isArray(invite && invite.invitees) ? invite.invitees : []
  }
  wx.setStorageSync(getWeddingInviteStorageKey(activeUserId), safeInvite)
  fireAndForget(callWeddingCloud('upsert', 'invites', safeInvite, activeUserId), '同步邀请信息失败')
}

function updateWeddingInviteMessage(message, userId) {
  const current = getWeddingInvite(userId)
  const next = {
    ...current,
    message: sanitizeWeddingText(message, 120)
  }
  saveWeddingInvite(next, userId)
  return next
}

function regenerateWeddingInviteLink(userId) {
  const current = getWeddingInvite(userId)
  const next = {
    ...current,
    linkCode: buildInviteCode()
  }
  saveWeddingInvite(next, userId)
  return next
}

function addWeddingInvitee(name, userId) {
  const safeName = sanitizeWeddingText(name, 30)
  if (!safeName) {
    return { success: false, message: '亲友姓名不能为空' }
  }

  const current = getWeddingInvite(userId)
  const invitee = {
    id: `WI${Date.now()}${Math.floor(Math.random() * 1000).toString().padStart(3, '0')}`,
    name: safeName,
    status: '未确认'
  }

  const next = {
    ...current,
    invitees: [invitee, ...current.invitees]
  }
  saveWeddingInvite(next, userId)
  return { success: true, invitee }
}

function updateWeddingInviteeStatus(inviteeId, status, userId) {
  const current = getWeddingInvite(userId)
  const nextInvitees = current.invitees.map(item => {
    if (item.id !== inviteeId) return item
    return {
      ...item,
      status: sanitizeInviteStatus(status)
    }
  })

  saveWeddingInvite({
    ...current,
    invitees: nextInvitees
  }, userId)

  return { success: true }
}

function deleteWeddingInvitee(inviteeId, userId) {
  const current = getWeddingInvite(userId)
  const nextInvitees = current.invitees.filter(item => item.id !== inviteeId)
  saveWeddingInvite({
    ...current,
    invitees: nextInvitees
  }, userId)
  return { success: true }
}

function getWeddingGuestViewByCode(code) {
  const inviteCode = sanitizeWeddingText(code, 20)
  if (!inviteCode) {
    return null
  }

  try {
    const users = getUsers()
    for (let index = 0; index < users.length; index++) {
      const user = users[index]
      if (!user || !user.id) {
        continue
      }

      const invite = getWeddingInvite(user.id)
      if (invite.linkCode !== inviteCode) {
        continue
      }

      const profile = getWeddingProfile(user.id)
      const tasks = getWeddingTasks(user.id)
      const totalTasks = tasks.length
      const completedTasks = tasks.filter(item => item.checked).length

      return {
        inviteCode,
        ownerName: sanitizeWeddingText(user.nickname, 20) || '新人',
        weddingDate: profile.weddingDate,
        weddingLocation: profile.location,
        inviteMessage: invite.message,
        totalTasks,
        completedTasks
      }
    }

    return null
  } catch (error) {
    console.error('通过邀请码读取亲友页失败', error)
    return null
  }
}

function confirmWeddingGuestAttendanceByCode(code, guestName) {
  const inviteCode = sanitizeWeddingText(code, 20)
  const name = sanitizeWeddingText(guestName, 30)

  if (!inviteCode || !name) {
    return { success: false, message: '邀请码或姓名无效' }
  }

  try {
    const users = getUsers()
    for (let index = 0; index < users.length; index++) {
      const user = users[index]
      if (!user || !user.id) {
        continue
      }

      const invite = getWeddingInvite(user.id)
      if (invite.linkCode !== inviteCode) {
        continue
      }

      const existed = invite.invitees.find(item => item.name === name)
      if (existed) {
        updateWeddingInviteeStatus(existed.id, '已确认', user.id)
        return { success: true }
      }

      const addResult = addWeddingInvitee(name, user.id)
      if (!addResult.success) {
        return addResult
      }
      updateWeddingInviteeStatus(addResult.invitee.id, '已确认', user.id)
      return { success: true }
    }

    return { success: false, message: '邀请码不存在' }
  } catch (error) {
    console.error('亲友确认出席失败', error)
    return { success: false, message: '确认失败，请重试' }
  }
}

module.exports = {
  PLATFORMS,
  loginByWechat,
  logout,
  getCurrentUser,
  getUsers,
  getTransactions,
  saveTransactions,
  clearTransactions,
  clearTransactionsAsync,
  saveTransaction,
  saveTransactionAsync,
  updateTransaction,
  updateTransactionAsync,
  deleteTransaction,
  deleteTransactionAsync,
  syncTransactionsFromCloud,
  parseCSV,
  convertToCSV,
  calculateHoldings,
  filterByDateRange,
  calculateAveragePrice,
  validateTransactionSequence,
  buildProfitCurve,
  clearWeddingAllData,
  getWeddingProfile,
  saveWeddingProfile,
  getWeddingTasks,
  createWeddingTask,
  updateWeddingTask,
  toggleWeddingTask,
  reorderWeddingTasks,
  deleteWeddingTask,
  restoreWeddingTask,
  getWeddingExpenses,
  createWeddingExpense,
  deleteWeddingExpense,
  getWeddingInvite,
  updateWeddingInviteMessage,
  regenerateWeddingInviteLink,
  addWeddingInvitee,
  updateWeddingInviteeStatus,
  deleteWeddingInvitee,
  syncWeddingDataFromCloud,
  getWeddingGuestViewByCode,
  getWeddingGuestViewByCodeAsync,
  confirmWeddingGuestAttendanceByCode,
  confirmWeddingGuestAttendanceByCodeAsync,
  getWeddingNotes,
  createWeddingNote,
  updateWeddingNote,
  deleteWeddingNote
}
