const cloud = require('wx-server-sdk')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const db = cloud.database()

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  const { dataType, userId, startDate, endDate } = event || {}

  const collectionMap = {
    profile: 'workout_profiles',
    sessions: 'workout_sessions',
    plans: 'workout_plans',
    weights: 'workout_weight_records'
  }

  const collectionName = collectionMap[dataType]
  if (!collectionName) {
    return { success: false, message: '未知的数据类型' }
  }

  const targetUserId = String(userId || wxContext.OPENID)

  try {
    const collection = db.collection(collectionName)
    let query = collection.where({ userId: targetUserId })

    if ((dataType === 'sessions' || dataType === 'weights') && startDate && endDate) {
      const dateField = dataType === 'sessions' ? 'workoutDate' : 'recordDate'
      query = collection.where({
        userId: targetUserId,
        [dateField]: db.command.gte(startDate).and(db.command.lte(endDate))
      })
    }

    const orderFieldMap = {
      profile: 'updatedAt',
      sessions: 'workoutDate',
      plans: 'updatedAt',
      weights: 'recordDate'
    }

    const orderField = orderFieldMap[dataType] || 'updatedAt'
    const res = await query.orderBy(orderField, 'desc').get()

    return {
      success: true,
      dataType,
      data: Array.isArray(res.data) ? res.data : []
    }
  } catch (error) {
    console.error('获取锻炼数据失败:', error)
    return {
      success: false,
      message: '获取数据失败',
      error: error.message
    }
  }
}
