const storage = require('./storage')

const SCENES = ['gold', 'wedding']

function normalizeScene(scene) {
  return SCENES.includes(scene) ? scene : 'gold'
}

function ensureCloudReady() {
  return !!(wx && wx.cloud && typeof wx.cloud.callFunction === 'function')
}

function getCurrentUser() {
  return storage.getCurrentUser()
}

function canUseChat() {
  const user = getCurrentUser()
  if (!user || !user.id) {
    return false
  }
  if (user.isGuest) {
    return false
  }
  return ensureCloudReady()
}

async function callManageMessages(data) {
  if (!canUseChat()) {
    return { success: false, message: '当前账号暂不支持聊天' }
  }

  try {
    const res = await wx.cloud.callFunction({
      name: 'manageMessages',
      data
    })
    return (res && res.result) || { success: false, message: '云端返回异常' }
  } catch (error) {
    return {
      success: false,
      message: (error && error.message) || '消息服务调用失败'
    }
  }
}

function formatBeijingDateTime(ms) {
  const ts = Number(ms) || 0
  if (!(ts > 0)) {
    return ''
  }

  const beijingMs = ts + (8 * 60 * 60 * 1000)
  const d = new Date(beijingMs)
  const year = d.getUTCFullYear()
  const month = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  const hour = String(d.getUTCHours()).padStart(2, '0')
  const minute = String(d.getUTCMinutes()).padStart(2, '0')
  return `${year}-${month}-${day} ${hour}:${minute}`
}

function formatTimeOnly(ms) {
  const ts = Number(ms) || 0
  if (!(ts > 0)) {
    return ''
  }

  const beijingMs = ts + (8 * 60 * 60 * 1000)
  const d = new Date(beijingMs)
  const hour = String(d.getUTCHours()).padStart(2, '0')
  const minute = String(d.getUTCMinutes()).padStart(2, '0')
  return `${hour}:${minute}`
}

function todayBeijingDate(ms) {
  const ts = Number(ms) || Date.now()
  const beijingMs = ts + (8 * 60 * 60 * 1000)
  const d = new Date(beijingMs)
  const year = d.getUTCFullYear()
  const month = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function formatConversationTime(ms) {
  const ts = Number(ms) || 0
  if (!(ts > 0)) {
    return ''
  }

  const dateText = todayBeijingDate(ts)
  const nowDateText = todayBeijingDate(Date.now())
  if (dateText === nowDateText) {
    return formatTimeOnly(ts)
  }
  return formatBeijingDateTime(ts).slice(5)
}

async function getUnreadCount(scene = 'gold') {
  const result = await callManageMessages({
    action: 'getUnread',
    scene: normalizeScene(scene)
  })

  if (!result.success) {
    return 0
  }

  return Number(result.unreadTotal) || 0
}

async function listConversations(scene = 'gold') {
  const result = await callManageMessages({
    action: 'listThreads',
    scene: normalizeScene(scene)
  })

  if (!result.success) {
    return { success: false, message: result.message || '加载会话失败', list: [], unreadTotal: 0 }
  }

  const list = Array.isArray(result.data) ? result.data.map((item) => ({
    ...item,
    timeText: formatConversationTime(item.lastMessageAtMs || item.updatedAtMs),
    lastMessagePreview: String(item.lastMessagePreview || '').trim() || '暂无消息'
  })) : []

  return {
    success: true,
    list,
    unreadTotal: Number(result.unreadTotal) || 0
  }
}

async function getMessages(params = {}) {
  const scene = normalizeScene(params.scene)
  const payload = {
    action: 'getMessages',
    scene,
    threadId: params.threadId || '',
    targetUserId: params.targetUserId || '',
    beforeMs: Number(params.beforeMs) || 0,
    limit: Number(params.limit) || 30
  }

  const result = await callManageMessages(payload)
  if (!result.success) {
    return { success: false, message: result.message || '加载消息失败', list: [], hasMore: false, threadId: '' }
  }

  const list = Array.isArray(result.data) ? result.data.map((item) => ({
    ...item,
    timeText: formatBeijingDateTime(item.createdAtMs)
  })) : []

  return {
    success: true,
    threadId: String(result.threadId || ''),
    peer: result.peer || null,
    relationInfo: result.relationInfo || null,
    hasMore: !!result.hasMore,
    list
  }
}

async function sendMessage(params = {}) {
  const scene = normalizeScene(params.scene)
  const payload = {
    action: 'sendMessage',
    scene,
    threadId: params.threadId || '',
    targetUserId: params.targetUserId || '',
    type: params.type || 'text',
    content: String(params.content || '').trim(),
    clientMsgId: params.clientMsgId || ''
  }

  const result = await callManageMessages(payload)
  if (!result.success) {
    return { success: false, message: result.message || '发送失败' }
  }

  const message = result.message || null
  if (message) {
    message.timeText = formatBeijingDateTime(message.createdAtMs)
  }

  return {
    success: true,
    threadId: String(result.threadId || ''),
    message
  }
}

async function markRead(scene = 'gold', threadId = '') {
  const result = await callManageMessages({
    action: 'markRead',
    scene: normalizeScene(scene),
    threadId: String(threadId || '')
  })

  return {
    success: !!result.success,
    message: result.message || ''
  }
}

module.exports = {
  normalizeScene,
  canUseChat,
  getUnreadCount,
  listConversations,
  getMessages,
  sendMessage,
  markRead,
  formatBeijingDateTime
}
