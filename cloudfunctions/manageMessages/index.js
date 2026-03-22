const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const _ = db.command

const ALLOWED_SCENES = ['gold', 'wedding']
const THREAD_PREFIX = 'TH'

function normalizeScene(scene) {
  return ALLOWED_SCENES.includes(scene) ? scene : 'gold'
}

function safeText(value, max = 2000) {
  return String(value || '').trim().slice(0, max)
}

function buildThreadId(scene, userA, userB) {
  const pair = [String(userA || '').trim(), String(userB || '').trim()].sort()
  return `${THREAD_PREFIX}_${normalizeScene(scene)}_${pair[0]}_${pair[1]}`
}

function nowTs() {
  return Date.now()
}

function toDateValue(ts) {
  return new Date(Number(ts || Date.now()))
}

async function getUserSummaryMap(userIds) {
  const ids = Array.from(new Set((userIds || []).map((id) => String(id || '').trim()).filter(Boolean)))
  if (!ids.length) {
    return {}
  }

  const users = await db.collection('users')
    .where({ openId: _.in(ids) })
    .limit(100)
    .get()
    .then((res) => (res && res.data) || [])

  const map = {}
  users.forEach((item) => {
    const openId = safeText(item && item.openId, 80)
    if (!openId) return
    map[openId] = {
      id: openId,
      nickname: safeText(item.nickname || `用户${openId.slice(-6)}`, 20),
      avatarUrl: safeText(item.avatarUrl || '', 400)
    }
  })

  ids.forEach((id) => {
    if (!map[id]) {
      map[id] = {
        id,
        nickname: `用户${id.slice(-6)}`,
        avatarUrl: ''
      }
    }
  })

  return map
}

async function getAcceptedPairRelations(scene, userA, userB) {
  const normalizedScene = normalizeScene(scene)
  return db.collection('social_relations')
    .where(_.or([
      { scene: normalizedScene, status: 'accepted', requesterId: userA, targetId: userB },
      { scene: normalizedScene, status: 'accepted', requesterId: userB, targetId: userA }
    ]))
    .limit(50)
    .get()
    .then((res) => (res && res.data) || [])
}

async function ensureChatPermission(callerId, peerId, scene) {
  const left = String(callerId || '').trim()
  const right = String(peerId || '').trim()
  if (!left || !right || left === right) {
    return { ok: false, message: '聊天对象无效' }
  }
  return { ok: true }
}

function getPairRelationInfo(relations, userA, userB) {
  const left = String(userA || '').trim()
  const right = String(userB || '').trim()
  const list = Array.isArray(relations) ? relations : []

  const hasCouple = list.some((item) => item && item.type === 'couple')
  const hasKin = list.some((item) => item && item.type === 'kin')
  const hasFollowAToB = list.some((item) => item && item.type === 'follow' && String(item.requesterId) === left && String(item.targetId) === right)
  const hasFollowBToA = list.some((item) => item && item.type === 'follow' && String(item.requesterId) === right && String(item.targetId) === left)
  const hasAnyRelation = hasCouple || hasKin || hasFollowAToB || hasFollowBToA

  let label = '陌生人'
  if (hasCouple) {
    label = '情侣'
  } else if (hasKin) {
    label = '亲友'
  } else if (hasFollowAToB && hasFollowBToA) {
    label = '好友'
  } else if (hasFollowAToB || hasFollowBToA) {
    label = '单向关注'
  }

  return {
    isStranger: !hasAnyRelation,
    label
  }
}

async function getThreadById(threadId) {
  if (!threadId) return null
  const list = await db.collection('social_threads')
    .where({ id: threadId })
    .limit(1)
    .get()
    .then((res) => (res && res.data) || [])
  return list[0] || null
}

async function getOrCreateThread(scene, callerId, peerId) {
  const normalizedScene = normalizeScene(scene)
  const threadId = buildThreadId(normalizedScene, callerId, peerId)
  const existing = await getThreadById(threadId)
  if (existing) {
    return existing
  }

  const memberA = [callerId, peerId].sort()[0]
  const memberB = [callerId, peerId].sort()[1]
  const ts = nowTs()
  const initial = {
    id: threadId,
    scene: normalizedScene,
    memberIds: [callerId, peerId],
    memberA,
    memberB,
    lastMessagePreview: '',
    lastMessageAtMs: 0,
    lastMessageAt: null,
    unreadBy: {
      [callerId]: 0,
      [peerId]: 0
    },
    createdAtMs: ts,
    updatedAtMs: ts,
    createdAt: toDateValue(ts),
    updatedAt: toDateValue(ts)
  }

  await db.collection('social_threads').add({ data: initial })
  return initial
}

function normalizeThreadForClient(thread, callerId, userMap) {
  const members = Array.isArray(thread.memberIds) ? thread.memberIds : []
  const peerId = members.find((id) => String(id) !== String(callerId)) || ''
  const peer = userMap[peerId] || { id: peerId, nickname: '未知用户', avatarUrl: '' }
  const unreadBy = thread.unreadBy || {}

  return {
    id: String(thread.id || ''),
    scene: normalizeScene(thread.scene),
    peer,
    lastMessagePreview: safeText(thread.lastMessagePreview || '', 80),
    lastMessageAtMs: Number(thread.lastMessageAtMs) || 0,
    unreadCount: Number(unreadBy[callerId]) || 0,
    updatedAtMs: Number(thread.updatedAtMs) || 0
  }
}

function normalizeMessageForClient(message, callerId, userMap) {
  const senderId = String(message.senderId || '')
  const sender = userMap[senderId] || { id: senderId, nickname: '未知用户', avatarUrl: '' }

  return {
    id: String(message.id || ''),
    threadId: String(message.threadId || ''),
    scene: normalizeScene(message.scene),
    senderId,
    sender,
    isSelf: senderId === callerId,
    type: String(message.type || 'text'),
    content: safeText(message.content || '', 2000),
    createdAtMs: Number(message.createdAtMs) || 0
  }
}

async function handleGetUnread(openId, event) {
  const scene = normalizeScene(event.scene)
  const list = await db.collection('social_threads')
    .where(_.or([
      { scene, memberA: openId },
      { scene, memberB: openId }
    ]))
    .limit(500)
    .get()
    .then((res) => (res && res.data) || [])

  const unreadTotal = list.reduce((sum, item) => {
    const unreadBy = item && item.unreadBy ? item.unreadBy : {}
    return sum + (Number(unreadBy[openId]) || 0)
  }, 0)

  return {
    success: true,
    scene,
    unreadTotal
  }
}

async function handleListThreads(openId, event) {
  const scene = normalizeScene(event.scene)
  const list = await db.collection('social_threads')
    .where(_.or([
      { scene, memberA: openId },
      { scene, memberB: openId }
    ]))
    .limit(500)
    .get()
    .then((res) => (res && res.data) || [])

  const sorted = list.sort((a, b) => {
    const left = Number(a && a.updatedAtMs) || 0
    const right = Number(b && b.updatedAtMs) || 0
    return right - left
  })

  const userIds = []
  sorted.forEach((item) => {
    const members = Array.isArray(item && item.memberIds) ? item.memberIds : []
    members.forEach((memberId) => {
      if (String(memberId) !== openId) {
        userIds.push(String(memberId))
      }
    })
  })

  const userMap = await getUserSummaryMap(userIds)
  const threads = []
  for (let i = 0; i < sorted.length; i += 1) {
    const item = sorted[i]
    const baseThread = normalizeThreadForClient(item, openId, userMap)
    const peerId = String(baseThread.peer && baseThread.peer.id || '')
    const relations = await getAcceptedPairRelations(scene, openId, peerId)
    const relationInfo = getPairRelationInfo(relations, openId, peerId)
    threads.push({
      ...baseThread,
      relationInfo
    })
  }
  const unreadTotal = threads.reduce((sum, item) => sum + (Number(item.unreadCount) || 0), 0)

  return {
    success: true,
    scene,
    unreadTotal,
    data: threads
  }
}

async function resolveThreadAndPeer(openId, event) {
  const scene = normalizeScene(event.scene)
  const inputThreadId = safeText(event.threadId, 120)
  const inputTargetUserId = safeText(event.targetUserId, 80)

  let thread = null
  let peerId = ''

  if (inputThreadId) {
    thread = await getThreadById(inputThreadId)
    if (!thread) {
      return { success: false, message: '会话不存在' }
    }

    const members = Array.isArray(thread.memberIds) ? thread.memberIds.map((id) => String(id)) : []
    if (!members.includes(openId)) {
      return { success: false, message: '无权访问该会话' }
    }

    peerId = members.find((id) => id !== openId) || ''
    return { success: true, scene: normalizeScene(thread.scene), thread, peerId }
  }

  if (!inputTargetUserId) {
    return { success: false, message: '缺少会话参数' }
  }

  const permission = await ensureChatPermission(openId, inputTargetUserId, scene)
  if (!permission.ok) {
    return { success: false, message: permission.message }
  }

  const threadId = buildThreadId(scene, openId, inputTargetUserId)
  thread = await getThreadById(threadId)
  peerId = inputTargetUserId
  return { success: true, scene, thread, peerId, threadId }
}

async function handleGetMessages(openId, event) {
  const resolved = await resolveThreadAndPeer(openId, event)
  if (!resolved.success) {
    return resolved
  }

  const scene = normalizeScene(resolved.scene)
  const thread = resolved.thread
  const beforeMs = Number(event.beforeMs) || 0
  const limit = Math.max(1, Math.min(100, Number(event.limit) || 30))

  if (!thread) {
    const userMap = await getUserSummaryMap([resolved.peerId])
    const relations = await getAcceptedPairRelations(scene, openId, resolved.peerId)
    const relationInfo = getPairRelationInfo(relations, openId, resolved.peerId)
    return {
      success: true,
      scene,
      threadId: resolved.threadId,
      peer: userMap[resolved.peerId] || null,
      relationInfo,
      hasMore: false,
      data: []
    }
  }

  let list = await db.collection('social_messages')
    .where({ threadId: String(thread.id) })
    .limit(500)
    .get()
    .then((res) => (res && res.data) || [])

  list = list.sort((a, b) => {
    const left = Number(a && a.createdAtMs) || 0
    const right = Number(b && b.createdAtMs) || 0
    return left - right
  })

  if (beforeMs > 0) {
    list = list.filter((item) => (Number(item && item.createdAtMs) || 0) < beforeMs)
  }

  const sliced = list.slice(Math.max(0, list.length - limit))
  const hasMore = list.length > sliced.length

  const senderIds = sliced.map((item) => String(item.senderId || '')).filter(Boolean)
  const userMap = await getUserSummaryMap([...senderIds, resolved.peerId])
  const messages = sliced.map((item) => normalizeMessageForClient(item, openId, userMap))
  const relations = await getAcceptedPairRelations(scene, openId, resolved.peerId)
  const relationInfo = getPairRelationInfo(relations, openId, resolved.peerId)

  return {
    success: true,
    scene,
    threadId: String(thread.id),
    peer: userMap[resolved.peerId] || null,
    relationInfo,
    hasMore,
    data: messages
  }
}

async function handleSendMessage(openId, event) {
  const scene = normalizeScene(event.scene)
  const targetUserId = safeText(event.targetUserId, 80)
  const inputThreadId = safeText(event.threadId, 120)
  const type = safeText(event.type || 'text', 20) || 'text'
  const content = safeText(event.content, 2000)
  const clientMsgId = safeText(event.clientMsgId, 80)

  if (!content) {
    return { success: false, message: '消息内容不能为空' }
  }

  let thread = null
  let peerId = ''

  if (inputThreadId) {
    thread = await getThreadById(inputThreadId)
    if (!thread) {
      return { success: false, message: '会话不存在' }
    }

    const members = Array.isArray(thread.memberIds) ? thread.memberIds.map((id) => String(id)) : []
    if (!members.includes(openId)) {
      return { success: false, message: '无权发送该会话消息' }
    }

    peerId = members.find((id) => id !== openId) || ''
  } else {
    if (!targetUserId) {
      return { success: false, message: '目标用户不能为空' }
    }

    const permission = await ensureChatPermission(openId, targetUserId, scene)
    if (!permission.ok) {
      return { success: false, message: permission.message }
    }

    thread = await getOrCreateThread(scene, openId, targetUserId)
    peerId = targetUserId
  }

  if (!peerId || peerId === openId) {
    return { success: false, message: '聊天对象无效' }
  }

  const scenePermission = await ensureChatPermission(openId, peerId, thread.scene || scene)
  if (!scenePermission.ok) {
    return { success: false, message: scenePermission.message }
  }

  if (clientMsgId) {
    const duplicate = await db.collection('social_messages')
      .where({ threadId: String(thread.id), senderId: openId, clientMsgId })
      .limit(1)
      .get()
      .then((res) => (res && res.data) || [])

    if (duplicate.length > 0) {
      const userMap = await getUserSummaryMap([openId, peerId])
      return {
        success: true,
        threadId: String(thread.id),
        message: normalizeMessageForClient(duplicate[0], openId, userMap)
      }
    }
  }

  const ts = nowTs()
  const messageId = `MSG_${thread.id}_${ts}_${Math.floor(Math.random() * 1000).toString().padStart(3, '0')}`
  const messageData = {
    id: messageId,
    threadId: String(thread.id),
    scene: normalizeScene(thread.scene),
    senderId: openId,
    type,
    content,
    clientMsgId,
    createdAtMs: ts,
    createdAt: toDateValue(ts)
  }

  await db.collection('social_messages').add({ data: messageData })

  const currentUnreadBy = thread.unreadBy || {}
  const nextPeerUnread = (Number(currentUnreadBy[peerId]) || 0) + 1
  const nextUnreadBy = {
    ...currentUnreadBy,
    [peerId]: nextPeerUnread,
    [openId]: 0
  }

  await db.collection('social_threads')
    .where({ id: String(thread.id) })
    .update({
      data: {
        lastMessagePreview: content.slice(0, 80),
        lastMessageAtMs: ts,
        lastMessageAt: toDateValue(ts),
        updatedAtMs: ts,
        updatedAt: toDateValue(ts),
        unreadBy: nextUnreadBy
      }
    })

  const userMap = await getUserSummaryMap([openId, peerId])
  return {
    success: true,
    threadId: String(thread.id),
    message: normalizeMessageForClient(messageData, openId, userMap)
  }
}

function buildSystemNoticeContent(noticeType, leftName, rightName) {
  if (noticeType === 'follow-mutual') {
    return {
      leftContent: `你和${rightName}已互相关注，已成为好友`,
      rightContent: `你和${leftName}已互相关注，已成为好友`
    }
  }

  return {
    leftContent: `你已关注${rightName}`,
    rightContent: `${leftName}关注了你`
  }
}

async function handleSendSystemNotice(openId, event) {
  const scene = normalizeScene(event.scene)
  const leftUserId = safeText(event.leftUserId, 80)
  const rightUserId = safeText(event.rightUserId, 80)
  const noticeType = safeText(event.noticeType, 40) || 'follow-created'
  const eventKey = safeText(event.eventKey, 120) || `${noticeType}_${scene}_${leftUserId}_${rightUserId}`

  if (!leftUserId || !rightUserId || leftUserId === rightUserId) {
    return { success: false, message: '系统消息目标无效' }
  }
  if (openId !== leftUserId && openId !== rightUserId) {
    return { success: false, message: '无权发送该系统消息' }
  }

  const thread = await getOrCreateThread(scene, leftUserId, rightUserId)
  const userMap = await getUserSummaryMap([leftUserId, rightUserId])
  const leftName = (userMap[leftUserId] && userMap[leftUserId].nickname) || `用户${leftUserId.slice(-6)}`
  const rightName = (userMap[rightUserId] && userMap[rightUserId].nickname) || `用户${rightUserId.slice(-6)}`
  const contentPair = buildSystemNoticeContent(noticeType, leftName, rightName)

  const leftClientMsgId = `SYS_${eventKey}_L`
  const rightClientMsgId = `SYS_${eventKey}_R`
  const existing = await db.collection('social_messages')
    .where({
      threadId: String(thread.id),
      clientMsgId: _.in([leftClientMsgId, rightClientMsgId])
    })
    .limit(20)
    .get()
    .then((res) => (res && res.data) || [])

  const exists = {}
  existing.forEach((item) => {
    const key = safeText(item && item.clientMsgId, 120)
    if (key) {
      exists[key] = true
    }
  })

  const baseTs = nowTs()
  const pendingMessages = []

  if (!exists[leftClientMsgId]) {
    pendingMessages.push({
      id: `MSG_${thread.id}_${baseTs}_S1`,
      threadId: String(thread.id),
      scene: normalizeScene(thread.scene),
      senderId: leftUserId,
      type: 'system',
      content: contentPair.leftContent,
      clientMsgId: leftClientMsgId,
      createdAtMs: baseTs,
      createdAt: toDateValue(baseTs)
    })
  }

  if (!exists[rightClientMsgId]) {
    const ts = baseTs + 1
    pendingMessages.push({
      id: `MSG_${thread.id}_${ts}_S2`,
      threadId: String(thread.id),
      scene: normalizeScene(thread.scene),
      senderId: rightUserId,
      type: 'system',
      content: contentPair.rightContent,
      clientMsgId: rightClientMsgId,
      createdAtMs: ts,
      createdAt: toDateValue(ts)
    })
  }

  if (!pendingMessages.length) {
    return { success: true, threadId: String(thread.id), skipped: true }
  }

  for (let i = 0; i < pendingMessages.length; i += 1) {
    await db.collection('social_messages').add({ data: pendingMessages[i] })
  }

  const currentUnreadBy = thread.unreadBy || {}
  const leftCurrent = Number(currentUnreadBy[leftUserId]) || 0
  const rightCurrent = Number(currentUnreadBy[rightUserId]) || 0
  const leftInc = pendingMessages.reduce((sum, msg) => sum + (msg.senderId === rightUserId ? 1 : 0), 0)
  const rightInc = pendingMessages.reduce((sum, msg) => sum + (msg.senderId === leftUserId ? 1 : 0), 0)
  const lastMessage = pendingMessages[pendingMessages.length - 1]

  await db.collection('social_threads')
    .where({ id: String(thread.id) })
    .update({
      data: {
        lastMessagePreview: safeText(lastMessage.content, 80),
        lastMessageAtMs: Number(lastMessage.createdAtMs) || nowTs(),
        lastMessageAt: toDateValue(lastMessage.createdAtMs),
        updatedAtMs: nowTs(),
        updatedAt: toDateValue(nowTs()),
        unreadBy: {
          ...currentUnreadBy,
          [leftUserId]: leftCurrent + leftInc,
          [rightUserId]: rightCurrent + rightInc
        }
      }
    })

  return { success: true, threadId: String(thread.id) }
}

async function handleMarkRead(openId, event) {
  const threadId = safeText(event.threadId, 120)
  if (!threadId) {
    return { success: false, message: '会话ID不能为空' }
  }

  const thread = await getThreadById(threadId)
  if (!thread) {
    return { success: false, message: '会话不存在' }
  }

  const members = Array.isArray(thread.memberIds) ? thread.memberIds.map((id) => String(id)) : []
  if (!members.includes(openId)) {
    return { success: false, message: '无权操作该会话' }
  }

  await db.collection('social_threads')
    .where({ id: threadId })
    .update({
      data: {
        unreadBy: {
          ...(thread.unreadBy || {}),
          [openId]: 0
        },
        updatedAtMs: nowTs(),
        updatedAt: toDateValue(nowTs())
      }
    })

  return { success: true }
}

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  const openId = String(wxContext.OPENID || '').trim()

  if (!openId) {
    return { success: false, message: '未登录' }
  }

  try {
    const action = safeText(event.action, 40)
    if (action === 'getUnread') {
      return await handleGetUnread(openId, event)
    }
    if (action === 'listThreads') {
      return await handleListThreads(openId, event)
    }
    if (action === 'getMessages') {
      return await handleGetMessages(openId, event)
    }
    if (action === 'sendMessage') {
      return await handleSendMessage(openId, event)
    }
    if (action === 'sendSystemNotice') {
      return await handleSendSystemNotice(openId, event)
    }
    if (action === 'markRead') {
      return await handleMarkRead(openId, event)
    }

    return { success: false, message: '未知操作' }
  } catch (error) {
    console.error('manageMessages 执行失败', error)
    return { success: false, message: '云端操作失败', error: error.message }
  }
}
