// 云函数：saveTransaction - 保存交易记录
const cloud = require('wx-server-sdk')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const db = cloud.database()
const _ = db.command

// 平台代码映射
const PLATFORM_CODE_MAP = {
  招商: 'ZS',
  民生: 'MS',
  浙商: 'ZH',
  支付宝: 'AL',
  工行: 'IC',
  微信: 'WX'
}

function generateTransactionId(platform, existingTransactions) {
  const code = PLATFORM_CODE_MAP[platform] || 'OT'
  let maxSerial = 0
  
  existingTransactions.forEach(tx => {
    const txId = tx && tx.id ? String(tx.id) : ''
    const match = txId.match(new RegExp(`^${code}(\\d{4,})$`))
    if (match) {
      const serial = parseInt(match[1], 10)
      if (serial > maxSerial) maxSerial = serial
    }
  })
  
  return `${code}${String(maxSerial + 1).padStart(4, '0')}`
}

function calculateFee(type, price, weight, platform, inputFeeRate) {
  // inputFeeRate 优先，如果未提供则按平台默认：招商=0，内置非招商=0.004，自定义=0
  let feeRate = Number(inputFeeRate)
  const hasFeeRate = Number.isFinite(feeRate) && feeRate >= 0

  if (type === 'sell') {
    if (hasFeeRate) {
      feeRate = feeRate
    } else if (platform === '招商') {
      feeRate = 0
    } else if (['民生', '浙商'].includes(platform)) {
      feeRate = 0.004
    } else {
      // 自定义平台或未知平台默认 0
      feeRate = 0
    }
    const feeAmount = price * weight * feeRate
    const netAmount = price * weight - feeAmount
    return { feeRate, feeAmount, netAmount }
  }

  return { feeRate: 0, feeAmount: 0, netAmount: -(price * weight) }
}

function normalizePlatform(platform) {
  const text = String(platform || '').trim()
  if (!text) return '其他'
  // 保留自定义平台名，不再统一映射为 '其他'
  return text
}

function normalizeDate(dateText, fallbackDate) {
  const text = String(dateText || '').trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return text
  }
  return fallbackDate
}

function getBeijingDateTimeParts(inputDate) {
  const sourceDate = inputDate instanceof Date ? inputDate : new Date()
  const beijingMs = sourceDate.getTime() + (8 * 60 * 60 * 1000)
  const beijingDate = new Date(beijingMs)

  const dateText = `${beijingDate.getUTCFullYear()}-${String(beijingDate.getUTCMonth() + 1).padStart(2, '0')}-${String(beijingDate.getUTCDate()).padStart(2, '0')}`
  const timeText = `${String(beijingDate.getUTCHours()).padStart(2, '0')}:${String(beijingDate.getUTCMinutes()).padStart(2, '0')}:${String(beijingDate.getUTCSeconds()).padStart(2, '0')}`

  return {
    dateText,
    timeText
  }
}

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  const { action, transaction, userId } = event

  try {
    const transactionsCollection = db.collection('transactions')
    const targetUserId = userId || wxContext.OPENID

    // 获取用户现有交易记录（用于生成 ID 和验证）
    const existingTransactions = await transactionsCollection
      .where({ userId: targetUserId })
      .get()
      .then(res => res.data)

    if (action === 'create') {
      // 创建新交易
      const { type, price, weight, platform, date } = transaction
      
      // 参数验证
      if (!type || !['buy', 'sell'].includes(type)) {
        return { success: false, message: '交易类型无效' }
      }
      if (!platform) {
        return { success: false, message: '交易平台不能为空' }
      }
      if (!(price > 0)) {
        return { success: false, message: '成交价格必须大于 0' }
      }
      if (!(weight > 0)) {
        return { success: false, message: '交易克数必须大于 0' }
      }

      const now = new Date()
      const nowBeijing = getBeijingDateTimeParts(now)
      const txDate = date || nowBeijing.dateText
      const timeText = nowBeijing.timeText
      const timestamp = `${txDate} ${timeText}`

      const feeInfo = calculateFee(type, price, weight, platform, transaction.fee_rate)
      
      const newTransaction = {
        userId: targetUserId,
        id: generateTransactionId(platform, existingTransactions),
        type,
        price,
        weight,
        platform,
        date: txDate,
        fee_rate: feeInfo.feeRate,
        fee_amount: feeInfo.feeAmount,
        net_amount: feeInfo.netAmount,
        timestamp,
        createdAt: now,
        updatedAt: now
      }

      const result = await transactionsCollection.add({
        data: newTransaction
      })

      return {
        success: true,
        transaction: { _id: result._id, ...newTransaction }
      }

    } else if (action === 'update') {
      // 更新交易
      const { id, ...updateData } = transaction || {}
      
      const targetTx = await transactionsCollection
        .where({ userId: targetUserId, id: id })
        .get()
        .then(res => res.data[0])

      if (!targetTx) {
        return { success: false, message: '交易记录不存在' }
      }

      const type = ['buy', 'sell'].includes(updateData.type)
        ? updateData.type
        : targetTx.type
      const price = Number(updateData.price)
      const weight = Number(updateData.weight)
      const platform = normalizePlatform(updateData.platform || targetTx.platform)
      const fallbackDate = String(targetTx.date || getBeijingDateTimeParts(new Date()).dateText)
      const txDate = normalizeDate(updateData.date, fallbackDate)

      if (!(price > 0) || !(weight > 0)) {
        return { success: false, message: '成交价格和克数必须大于 0' }
      }

      const now = new Date()
      const timeText = getBeijingDateTimeParts(now).timeText
      const feeInfo = calculateFee(type, price, weight, platform, updateData.fee_rate !== undefined ? updateData.fee_rate : targetTx.fee_rate)

      await transactionsCollection
        .where({ userId: targetUserId, id: id })
        .update({
          data: {
            type,
            price,
            weight,
            platform,
            date: txDate,
            fee_rate: feeInfo.feeRate,
            fee_amount: feeInfo.feeAmount,
            net_amount: feeInfo.netAmount,
            timestamp: `${txDate} ${timeText}`,
            updatedAt: now
          }
        })

      return {
        success: true,
        message: '更新成功'
      }

    } else if (action === 'delete') {
      // 删除交易
      const { id } = transaction

      await transactionsCollection
        .where({ userId: targetUserId, id: id })
        .remove()

      return { success: true, message: '删除成功' }

    } else if (action === 'clearAll') {
      // 清空当前用户全部交易
      const removeResult = await transactionsCollection
        .where({ userId: targetUserId })
        .remove()

      return {
        success: true,
        message: '清空成功',
        deletedCount: (removeResult && removeResult.stats && removeResult.stats.removed) || 0
      }

    } else {
      return { success: false, message: '未知的操作类型' }
    }

  } catch (error) {
    console.error('保存交易记录失败:', error)
    return {
      success: false,
      message: '保存失败，请稍后重试',
      error: error.message
    }
  }
}
