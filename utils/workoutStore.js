const storage = require('./storage')
const social = require('./social')

const WORKOUT_PROFILE_PREFIX = 'workout_profile'
const WORKOUT_SESSIONS_PREFIX = 'workout_sessions'
const WORKOUT_PLANS_PREFIX = 'workout_plans'
const WORKOUT_WEIGHT_PREFIX = 'workout_weight_records'

function nowIso() {
  return new Date().toISOString()
}

function toBeijingDate(input) {
  const base = input ? new Date(input) : new Date()
  const utc = base.getTime() + base.getTimezoneOffset() * 60000
  const cst = new Date(utc + 8 * 3600000)
  const year = cst.getUTCFullYear()
  const month = String(cst.getUTCMonth() + 1).padStart(2, '0')
  const day = String(cst.getUTCDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function makeId(prefix) {
  const random = Math.floor(Math.random() * 1000).toString().padStart(3, '0')
  return `${prefix}${Date.now()}${random}`
}

function canUseCloud() {
  return !!(wx && wx.cloud && typeof wx.cloud.callFunction === 'function')
}

function getCurrentUserId() {
  const user = storage.getCurrentUser()
  if (!user || !user.id) {
    throw new Error('未登录')
  }
  return String(user.id)
}

function getWorkoutWorkspaceOwnerId() {
  const currentUserId = getCurrentUserId()
  try {
    return String(social.getWeddingWorkspaceOwnerId(currentUserId) || currentUserId)
  } catch (error) {
    return currentUserId
  }
}

function getWorkoutWorkspaceRole() {
  const currentUserId = getCurrentUserId()
  try {
    return String(social.getWeddingWorkspaceRole(currentUserId) || 'self')
  } catch (error) {
    return 'self'
  }
}

function readList(key) {
  try {
    const list = wx.getStorageSync(key)
    return Array.isArray(list) ? list : []
  } catch (error) {
    console.warn('读取锻炼缓存失败', key, error)
    return []
  }
}

function readObject(key) {
  try {
    const data = wx.getStorageSync(key)
    return data && typeof data === 'object' ? data : {}
  } catch (error) {
    console.warn('读取锻炼对象缓存失败', key, error)
    return {}
  }
}

function write(key, value) {
  wx.setStorageSync(key, value)
}

function keyProfile(userId) {
  return `${WORKOUT_PROFILE_PREFIX}_${userId}`
}

function keySessions(userId) {
  return `${WORKOUT_SESSIONS_PREFIX}_${userId}`
}

function keyPlans(userId) {
  return `${WORKOUT_PLANS_PREFIX}_${userId}`
}

function keyWeights(userId) {
  return `${WORKOUT_WEIGHT_PREFIX}_${userId}`
}

function normalizeSession(input) {
  const now = nowIso()
  return {
    id: String(input.id || makeId('WS')),
    workoutDate: String(input.workoutDate || toBeijingDate()),
    type: String(input.type || '其他').trim() || '其他',
    durationMin: Math.max(0, parseInt(input.durationMin, 10) || 0),
    intensity: String(input.intensity || '中').trim() || '中',
    bodyParts: Array.isArray(input.bodyParts) ? input.bodyParts : [],
    calories: Math.max(0, Number(input.calories) || 0),
    note: String(input.note || '').trim().slice(0, 300),
    schemaVersion: 1,
    createdAt: input.createdAt || now,
    updatedAt: now
  }
}

function normalizeWeight(input) {
  const now = nowIso()
  return {
    id: String(input.id || makeId('WW')),
    recordDate: String(input.recordDate || toBeijingDate()),
    weight: Math.max(0, Number(input.weight) || 0),
    bodyFat: Math.max(0, Number(input.bodyFat) || 0),
    targetWeight: Math.max(0, Number(input.targetWeight) || 0),
    targetEndDate: String(input.targetEndDate || '').trim(),
    schemaVersion: 1,
    createdAt: input.createdAt || now,
    updatedAt: now
  }
}

function normalizePlan(input) {
  const now = nowIso()
  return {
    id: String(input.id || 'PLAN_MAIN'),
    weekStartDate: String(input.weekStartDate || toBeijingDate()),
    weeklyTargetDays: Math.max(0, parseInt(input.weeklyTargetDays, 10) || 0),
    items: Array.isArray(input.items) ? input.items : [],
    completionRate: Math.max(0, Number(input.completionRate) || 0),
    note: String(input.note || '').trim().slice(0, 300),
    schemaVersion: 1,
    createdAt: input.createdAt || now,
    updatedAt: now
  }
}

function normalizeProfile(input) {
  const now = nowIso()
  return {
    id: 'PROFILE_MAIN',
    goalType: String(input.goalType || '减脂').trim() || '减脂',
    weeklyTargetDays: Math.max(0, parseInt(input.weeklyTargetDays, 10) || 0),
    reminderTime: String(input.reminderTime || '').trim(),
    schemaVersion: 1,
    createdAt: input.createdAt || now,
    updatedAt: now
  }
}

async function callWriteCloud(dataType, data, userId, action = 'upsert') {
  if (!canUseCloud()) return { success: false, message: 'cloud-unavailable' }
  try {
    const res = await wx.cloud.callFunction({
      name: 'saveWorkoutData',
      data: { action, dataType, data, userId }
    })
    return (res && res.result) || { success: false, message: '云端写入失败' }
  } catch (error) {
    return { success: false, message: error.message || '云端写入失败' }
  }
}

async function callReadCloud(dataType, userId) {
  if (!canUseCloud()) return { success: false, message: 'cloud-unavailable' }
  try {
    const res = await wx.cloud.callFunction({
      name: 'getWorkoutData',
      data: { dataType, userId }
    })
    return (res && res.result) || { success: false, message: '云端读取失败' }
  } catch (error) {
    return { success: false, message: error.message || '云端读取失败' }
  }
}

function getWorkoutBootstrap() {
  const workspaceOwnerId = getWorkoutWorkspaceOwnerId()
  return {
    workspaceOwnerId,
    workspaceRole: getWorkoutWorkspaceRole(),
    profile: readObject(keyProfile(workspaceOwnerId)),
    sessions: readList(keySessions(workspaceOwnerId)),
    plans: readList(keyPlans(workspaceOwnerId)),
    weights: readList(keyWeights(workspaceOwnerId))
  }
}

async function syncFromCloud() {
  const workspaceOwnerId = getWorkoutWorkspaceOwnerId()
  const [profileRes, sessionsRes, plansRes, weightRes] = await Promise.all([
    callReadCloud('profile', workspaceOwnerId),
    callReadCloud('sessions', workspaceOwnerId),
    callReadCloud('plans', workspaceOwnerId),
    callReadCloud('weights', workspaceOwnerId)
  ])

  if (profileRes.success && Array.isArray(profileRes.data)) {
    write(keyProfile(workspaceOwnerId), profileRes.data[0] || {})
  }
  if (sessionsRes.success && Array.isArray(sessionsRes.data)) {
    write(keySessions(workspaceOwnerId), sessionsRes.data)
  }
  if (plansRes.success && Array.isArray(plansRes.data)) {
    write(keyPlans(workspaceOwnerId), plansRes.data)
  }
  if (weightRes.success && Array.isArray(weightRes.data)) {
    write(keyWeights(workspaceOwnerId), weightRes.data)
  }

  return getWorkoutBootstrap()
}

async function upsertProfile(input) {
  const workspaceOwnerId = getWorkoutWorkspaceOwnerId()
  const profile = normalizeProfile(input || {})
  write(keyProfile(workspaceOwnerId), profile)
  await callWriteCloud('profile', profile, workspaceOwnerId, 'upsert')
  return profile
}

async function saveSession(input) {
  const workspaceOwnerId = getWorkoutWorkspaceOwnerId()
  const list = readList(keySessions(workspaceOwnerId))
  const next = normalizeSession(input || {})
  const index = list.findIndex((item) => item.id === next.id)
  if (index >= 0) {
    list[index] = next
  } else {
    list.unshift(next)
  }
  write(keySessions(workspaceOwnerId), list)
  await callWriteCloud('sessions', next, workspaceOwnerId, 'upsert')
  return next
}

async function deleteSession(sessionId) {
  const workspaceOwnerId = getWorkoutWorkspaceOwnerId()
  const id = String(sessionId || '').trim()
  if (!id) {
    return { success: false, message: '记录ID无效' }
  }

  const list = readList(keySessions(workspaceOwnerId))
  const nextList = list.filter((item) => String(item.id) !== id)
  write(keySessions(workspaceOwnerId), nextList)
  await callWriteCloud('sessions', { id }, workspaceOwnerId, 'delete')
  return { success: true }
}

async function upsertPlan(input) {
  const workspaceOwnerId = getWorkoutWorkspaceOwnerId()
  const list = readList(keyPlans(workspaceOwnerId))
  const next = normalizePlan(input || {})
  const index = list.findIndex((item) => item.id === next.id)
  if (index >= 0) {
    list[index] = next
  } else {
    list.unshift(next)
  }
  write(keyPlans(workspaceOwnerId), list)
  await callWriteCloud('plans', next, workspaceOwnerId, 'upsert')
  return next
}

async function saveWeight(input) {
  const workspaceOwnerId = getWorkoutWorkspaceOwnerId()
  const list = readList(keyWeights(workspaceOwnerId))
  const next = normalizeWeight(input || {})
  const index = list.findIndex((item) => item.id === next.id)
  if (index >= 0) {
    list[index] = next
  } else {
    list.unshift(next)
  }
  write(keyWeights(workspaceOwnerId), list)
  await callWriteCloud('weights', next, workspaceOwnerId, 'upsert')
  return next
}

async function deleteWeight(weightId) {
  const workspaceOwnerId = getWorkoutWorkspaceOwnerId()
  const id = String(weightId || '').trim()
  if (!id) {
    return { success: false, message: '记录ID无效' }
  }

  const list = readList(keyWeights(workspaceOwnerId))
  const nextList = list.filter((item) => String(item.id) !== id)
  write(keyWeights(workspaceOwnerId), nextList)
  await callWriteCloud('weights', { id }, workspaceOwnerId, 'delete')
  return { success: true }
}

module.exports = {
  toBeijingDate,
  getWorkoutBootstrap,
  syncFromCloud,
  upsertProfile,
  saveSession,
  deleteSession,
  upsertPlan,
  saveWeight,
  deleteWeight
}
