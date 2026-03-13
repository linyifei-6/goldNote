// 云函数：getTransactions - 获取交易记录
const cloud = require('wx-server-sdk')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const db = cloud.database()

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  const { userId, limit = 100, offset = 0 } = event

  try {
    const transactionsCollection = db.collection('transactions')
    
    // 查询条件：当前用户的交易记录
    const query = {
      userId: userId || wxContext.OPENID
    }

    // 如果提供了日期范围，添加过滤
    if (event.startDate && event.endDate) {
      query.date = {
        $gte: event.startDate,
        $lte: event.endDate
      }
    }

    // 如果提供了平台过滤
    if (event.platform && event.platform !== '全部') {
      query.platform = event.platform
    }

    // 如果提供了类型过滤
    if (event.type && ['buy', 'sell'].includes(event.type)) {
      query.type = event.type
    }

    const result = await transactionsCollection
      .where(query)
      .orderBy('timestamp', 'desc')
      .skip(offset)
      .limit(limit)
      .get()

    return {
      success: true,
      data: result.data,
      total: result.data.length
    }

  } catch (error) {
    console.error('获取交易记录失败:', error)
    return {
      success: false,
      message: '获取交易记录失败',
      error: error.message
    }
  }
}
