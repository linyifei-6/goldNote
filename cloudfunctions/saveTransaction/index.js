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

function calculateFee(type, price, weight, platform) {
  if (type === 'sell') {
    // 招商平台卖出不收手续费，其他平台收 0.4%
    if (platform === '招商') {
      return { feeRate: 0, feeAmount: 0, netAmount: price * weight }
    } else {
      const feeRate = 0.004
      const feeAmount = price * weight * feeRate
      const netAmount = price * weight * 0.996
      return { feeRate, feeAmount, netAmount }
    }
  } else {
    return { feeRate: 0, feeAmount: 0, netAmount: -(price * weight) }
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
      const txDate = date || now.toISOString().split('T')[0]
      const timeText = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`
      const timestamp = `${txDate} ${timeText}`

      const feeInfo = calculateFee(type, price, weight, platform)
      
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
      const { id, ...updateData } = transaction
      
      const targetTx = await transactionsCollection
        .where({ userId: targetUserId, id: id })
        .get()
        .then(res => res.data[0])

      if (!targetTx) {
        return { success: false, message: '交易记录不存在' }
      }

      await transactionsCollection
        .where({ userId: targetUserId, id: id })
        .update({
          data: {
            ...updateData,
            updatedAt: new Date()
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
