const cloud = require('wx-server-sdk')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const db = cloud.database()

function sanitizeText(value, maxLen = 200) {
  return String(value || '').trim().slice(0, maxLen)
}

function sanitizeDate(text) {
  const value = String(text || '').trim()
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : ''
}

function makeId(prefix) {
  const random = Math.floor(Math.random() * 1000).toString().padStart(3, '0')
  return `${prefix}${Date.now()}${random}`
}

function normalizeProfile(data, userId) {
  const now = new Date()
  return {
    id: 'PROFILE_MAIN',
    userId,
    goalType: sanitizeText(data.goalType || '减脂', 20),
    weeklyTargetDays: Math.max(0, parseInt(data.weeklyTargetDays, 10) || 0),
    reminderTime: sanitizeText(data.reminderTime, 10),
    schemaVersion: 1,
    createdAt: data.createdAt || now,
    updatedAt: now
  }
}

function normalizeSession(data, userId) {
  const now = new Date()
  return {
    id: sanitizeText(data.id || makeId('WS'), 40),
    userId,
    workoutDate: sanitizeDate(data.workoutDate),
    type: sanitizeText(data.type || '其他', 30),
    durationMin: Math.max(0, parseInt(data.durationMin, 10) || 0),
    intensity: sanitizeText(data.intensity || '中', 10),
    bodyParts: Array.isArray(data.bodyParts) ? data.bodyParts : [],
    calories: Math.max(0, Number(data.calories) || 0),
    note: sanitizeText(data.note, 300),
    schemaVersion: 1,
    createdAt: data.createdAt || now,
    updatedAt: now
  }
}

function normalizePlan(data, userId) {
  const now = new Date()
  return {
    id: sanitizeText(data.id || 'PLAN_MAIN', 40),
    userId,
    weekStartDate: sanitizeDate(data.weekStartDate),
    weeklyTargetDays: Math.max(0, parseInt(data.weeklyTargetDays, 10) || 0),
    items: Array.isArray(data.items) ? data.items : [],
    completionRate: Math.max(0, Number(data.completionRate) || 0),
    note: sanitizeText(data.note, 300),
    schemaVersion: 1,
    createdAt: data.createdAt || now,
    updatedAt: now
  }
}

function normalizeWeight(data, userId) {
  const now = new Date()
  return {
    id: sanitizeText(data.id || makeId('WW'), 40),
    userId,
    recordDate: sanitizeDate(data.recordDate),
    weight: Math.max(0, Number(data.weight) || 0),
    bodyFat: Math.max(0, Number(data.bodyFat) || 0),
    targetWeight: Math.max(0, Number(data.targetWeight) || 0),
    targetEndDate: sanitizeDate(data.targetEndDate),
    schemaVersion: 1,
    createdAt: data.createdAt || now,
    updatedAt: now
  }
}

function normalizeByType(dataType, data, userId) {
  if (dataType === 'profile') return normalizeProfile(data, userId)
  if (dataType === 'sessions') return normalizeSession(data, userId)
  if (dataType === 'plans') return normalizePlan(data, userId)
  if (dataType === 'weights') return normalizeWeight(data, userId)
  return null
}

async function findDocByBizId(collection, userId, bizId) {
  const result = await collection.where({ userId, id: bizId }).limit(1).get()
  return (result.data && result.data[0]) || null
}

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  const { action, dataType, data = {}, userId } = event || {}

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

    if (action === 'delete') {
      const bizId = sanitizeText(data.id, 40)
      if (!bizId) return { success: false, message: '缺少记录ID' }

      const existed = await findDocByBizId(collection, targetUserId, bizId)
      if (!existed || !existed._id) return { success: false, message: '记录不存在' }

      await collection.doc(existed._id).remove()
      return { success: true, message: '删除成功' }
    }

    if (action !== 'upsert' && action !== 'create' && action !== 'update') {
      return { success: false, message: '未知的操作类型' }
    }

    const normalized = normalizeByType(dataType, data, targetUserId)
    if (!normalized) {
      return { success: false, message: '数据校验失败' }
    }

    const existed = await findDocByBizId(collection, targetUserId, normalized.id)
    if (existed && existed._id) {
      await collection.doc(existed._id).update({
        data: {
          ...normalized,
          updatedAt: new Date()
        }
      })
      return { success: true, message: '更新成功', id: normalized.id }
    }

    await collection.add({ data: normalized })
    return { success: true, message: '创建成功', id: normalized.id }
  } catch (error) {
    console.error('保存锻炼数据失败:', error)
    return {
      success: false,
      message: '保存失败，请稍后重试',
      error: error.message
    }
  }
}
