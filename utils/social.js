const storage = require('./storage')

const LEGACY_SOCIAL_RELATIONS_KEY = 'social_relations'
const SCENE_RELATION_KEYS = {
  gold: 'social_relations_gold',
  wedding: 'social_relations_wedding'
}
const GOLD_VIEW_PREFIX = 'social_gold_view_target'
const WEDDING_BLESSINGS_PREFIX = 'wedding_blessings'

const RELATION_TYPES = ['follow', 'couple', 'kin']
const LEGACY_TYPE_MAP = {
  gold: 'follow',
  guest: 'kin'
}
const RELATION_STATUSES = ['pending', 'accepted', 'rejected', 'cancelled', 'ended']
const SCENE_ALLOWED_TYPES = {
  gold: ['follow'],
  wedding: ['follow', 'couple', 'kin']
}
const USER_LIST_KEY = 'gold_users'

function nowIso() {
  return new Date().toISOString()
}

function makeId(prefix) {
  return `${prefix}${Date.now()}${Math.floor(Math.random() * 1000).toString().padStart(3, '0')}`
}

function safeText(value, max = 100) {
  return String(value || '').trim().slice(0, max)
}

function normalizeScene(scene) {
  return scene === 'wedding' ? 'wedding' : 'gold'
}

function inferSceneByType(type) {
  return type === 'couple' || type === 'kin' ? 'wedding' : 'gold'
}

function getSceneRelationKey(scene) {
  return SCENE_RELATION_KEYS[normalizeScene(scene)]
}

function getAllowedTypes(scene) {
  return SCENE_ALLOWED_TYPES[normalizeScene(scene)] || SCENE_ALLOWED_TYPES.gold
}

function getCurrentUserId() {
  const user = storage.getCurrentUser()
  if (!user || !user.id) {
    throw new Error('未登录')
  }
  return String(user.id)
}

function normalizeRelationType(rawType) {
  const type = String(rawType || '').trim()
  return LEGACY_TYPE_MAP[type] || type
}

function normalizeRelation(item, scene) {
  if (!item || !item.id || !item.requesterId || !item.targetId) {
    return null
  }

  const type = normalizeRelationType(item.type)
  const status = String(item.status || '').trim()
  if (!RELATION_TYPES.includes(type) || !RELATION_STATUSES.includes(status)) {
    return null
  }
  if (!getAllowedTypes(scene).includes(type)) {
    return null
  }

  return {
    ...item,
    type,
    status,
    requesterId: String(item.requesterId),
    targetId: String(item.targetId),
    sharedWeddingOwnerId: String(item.sharedWeddingOwnerId || ''),
    legacyMutual: item.type === 'gold'
  }
}

function splitLegacyRelations(list) {
  const result = {
    gold: [],
    wedding: []
  }

  ;(Array.isArray(list) ? list : []).forEach((item) => {
    const type = normalizeRelationType(item && item.type)
    const scene = type === 'couple' || type === 'kin' ? 'wedding' : 'gold'
    result[scene].push(item)
  })

  return result
}

function loadRawRelations(scene) {
  const normalizedScene = normalizeScene(scene)
  const sceneKey = getSceneRelationKey(normalizedScene)

  try {
    const sceneList = wx.getStorageSync(sceneKey)
    if (Array.isArray(sceneList)) {
      return sceneList
    }

    const legacyList = wx.getStorageSync(LEGACY_SOCIAL_RELATIONS_KEY)
    if (Array.isArray(legacyList)) {
      const split = splitLegacyRelations(legacyList)
      const migrated = split[normalizedScene] || []
      wx.setStorageSync(sceneKey, migrated)
      return migrated
    }

    return []
  } catch (error) {
    console.error('读取关系失败', error)
    return []
  }
}

function getRelations(scene) {
  return loadRawRelations(scene)
    .map((item) => normalizeRelation(item, scene))
    .filter(Boolean)
}

function saveRelations(scene, relations) {
  const next = Array.isArray(relations)
    ? relations.map((item) => ({
      ...item,
      legacyMutual: undefined
    }))
    : []
  wx.setStorageSync(getSceneRelationKey(scene), next)
}

// ---------- 云端关系同步 ----------

const _relationsLastSyncAt = {} // scene -> timestamp (ms)，内存防重复同步
const _relationsSyncPromise = {} // scene -> Promise，防止 onLoad/onShow 并发重复请求
let relationCloudAvailable = true

function isMissingCloudFunctionError(err) {
  const message = String(
    (err && (err.errMsg || err.message)) || err || ''
  )
  return message.includes('FunctionName parameter could not be found') || message.includes('errCode: -501000')
}

function markRelationCloudUnavailable(err) {
  relationCloudAvailable = false
  console.warn('manageRelations 云函数不可用，后续将仅使用本地关系缓存', err)
}

/**
 * fire-and-forget：把单条关系上传到云端。
 * 在本地写入成功后调用，不阻塞主流程。
 */
function upsertRelationToCloud(relation, scene) {
  if (!relationCloudAvailable) return
  if (!(wx && wx.cloud && typeof wx.cloud.callFunction === 'function')) return
  const payload = { ...relation, scene: normalizeScene(scene), legacyMutual: undefined }
  wx.cloud.callFunction({
    name: 'manageRelations',
    data: { action: 'upsert', relation: payload }
  }).catch((err) => {
    if (isMissingCloudFunctionError(err)) {
      markRelationCloudUnavailable(err)
      return
    }
    console.warn('上传关系到云端失败（不影响本地）', err)
  })
}

/**
 * 从云端拉取当前用户在指定场景下的全量关系，合并写入本地缓存。
 * 规则：云端记录 > 本地记录（云端是 source of truth）。
 * 同一场景 30 秒内不重复请求。
 */
async function syncRelationsFromCloud(scene) {
  if (!relationCloudAvailable) return
  if (!(wx && wx.cloud && typeof wx.cloud.callFunction === 'function')) return
  const normalizedScene = normalizeScene(scene)
  const now = Date.now()
  if (_relationsLastSyncAt[normalizedScene] && now - _relationsLastSyncAt[normalizedScene] < 30000) return
  if (_relationsSyncPromise[normalizedScene]) {
    return _relationsSyncPromise[normalizedScene]
  }

  _relationsSyncPromise[normalizedScene] = (async () => {
    try {
      const res = await wx.cloud.callFunction({
        name: 'manageRelations',
        data: { action: 'get', scene: normalizedScene }
      })
      const result = (res && res.result) || {}
      if (!result.success || !Array.isArray(result.data)) return

      _relationsLastSyncAt[normalizedScene] = now

      // 合并：以云端为主，本地独有的记录保留（可能还未上传成功）
      const local = loadRawRelations(normalizedScene)
      const cloudById = {}
      result.data.forEach((item) => {
        if (item && item.id) cloudById[item.id] = item
      })
      // 本地记录中，云端没有的保留（可能是刚创建还未同步的）
      const localOnly = local.filter((item) => item && item.id && !cloudById[item.id])
      const merged = [...result.data, ...localOnly]
      saveRelations(normalizedScene, merged)
    } catch (err) {
      if (isMissingCloudFunctionError(err)) {
        markRelationCloudUnavailable(err)
        return
      }
      console.warn('从云端同步关系失败（将使用本地缓存）', err)
    } finally {
      delete _relationsSyncPromise[normalizedScene]
    }
  })()

  return _relationsSyncPromise[normalizedScene]
}

// ----------------------------------

function resolveRelationContext(relationId, scene) {
  const preferredScene = scene ? normalizeScene(scene) : ''
  const scenes = preferredScene ? [preferredScene] : ['gold', 'wedding']

  for (let index = 0; index < scenes.length; index++) {
    const currentScene = scenes[index]
    const relations = getRelations(currentScene)
    const relationIndex = relations.findIndex((item) => item.id === relationId)
    if (relationIndex >= 0) {
      return {
        scene: currentScene,
        relations,
        index: relationIndex,
        relation: relations[relationIndex]
      }
    }
  }

  return null
}

function findUserById(userId) {
  const uid = String(userId || '').trim()
  if (!uid) return null
  const users = storage.getUsers()
  return users.find((item) => item && String(item.id) === uid) || null
}

function toUserSummary(user) {
  if (!user) {
    return null
  }
  return {
    id: String(user.id || ''),
    nickname: safeText(user.nickname || '用户', 20),
    avatarUrl: safeText(user.avatarUrl || '', 400)
  }
}

function isSamePair(aId, bId, relation) {
  const left = String(aId)
  const right = String(bId)
  const requester = String(relation.requesterId)
  const target = String(relation.targetId)
  return (requester === left && target === right) || (requester === right && target === left)
}

function listInvitableUsers() {
  const currentUserId = getCurrentUserId()
  return (storage.getUsers() || [])
    .filter((item) => item && String(item.id) !== currentUserId)
    .map((item) => toUserSummary(item))
    .filter(Boolean)
}

function isFollowing(followerUserId, targetUserId, options = {}) {
  const followerId = String(followerUserId || '').trim()
  const targetId = String(targetUserId || '').trim()
  const scene = normalizeScene(options.scene || 'gold')
  if (!followerId || !targetId) {
    return false
  }

  return getRelations(scene).some((item) => {
    if (item.type !== 'follow' || item.status !== 'accepted') {
      return false
    }
    if (item.legacyMutual) {
      return isSamePair(followerId, targetId, item)
    }
    return String(item.requesterId) === followerId && String(item.targetId) === targetId
  })
}

function getAcceptedCoupleRelation(userId) {
  const uid = String(userId || '').trim()
  if (!uid) return null

  return getRelations('wedding').find((item) => {
    if (item.type !== 'couple' || item.status !== 'accepted') {
      return false
    }
    return String(item.requesterId) === uid || String(item.targetId) === uid
  }) || null
}

function getWeddingWorkspaceOwnerId(userId) {
  const uid = String(userId || getCurrentUserId())
  const couple = getAcceptedCoupleRelation(uid)
  if (!couple) {
    return uid
  }
  return String(couple.sharedWeddingOwnerId || couple.requesterId || uid)
}

function getWeddingWorkspaceRole(userId) {
  const uid = String(userId || getCurrentUserId())
  return getAcceptedCoupleRelation(uid) ? 'couple' : 'self'
}

function createRelationRequest(type, targetUserId, options = {}) {
  const relationType = safeText(type, 20)
  const scene = normalizeScene(options.scene || inferSceneByType(relationType))
  if (!RELATION_TYPES.includes(relationType) || !getAllowedTypes(scene).includes(relationType)) {
    return { success: false, message: '关系类型无效' }
  }

  const requesterId = getCurrentUserId()
  const targetId = String(targetUserId || '').trim()

  if (!targetId) {
    return { success: false, message: '请输入目标用户ID' }
  }
  if (requesterId === targetId) {
    return { success: false, message: '不能操作自己' }
  }
  if (!findUserById(targetId)) {
    return { success: false, message: '目标用户不存在' }
  }

  const relations = getRelations(scene)

  if (relationType === 'follow') {
    const duplicatedFollow = relations.find((item) => {
      if (item.type !== 'follow' || item.status !== 'accepted') {
        return false
      }
      if (item.legacyMutual) {
        return isSamePair(requesterId, targetId, item)
      }
      return String(item.requesterId) === requesterId && String(item.targetId) === targetId
    })

    if (duplicatedFollow) {
      return { success: false, message: '已关注该用户' }
    }

    const follow = {
      id: makeId(scene === 'gold' ? 'GF' : 'WF'),
      type: 'follow',
      status: 'accepted',
      requesterId,
      targetId,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      sharedWeddingOwnerId: ''
    }

    saveRelations(scene, [follow, ...relations])
    upsertRelationToCloud(follow, scene)
    return { success: true, relation: follow, immediate: true, scene }
  }

  if (relationType === 'couple') {
    const requesterCouple = getAcceptedCoupleRelation(requesterId)
    if (requesterCouple) {
      return { success: false, message: '你已绑定情侣关系，请先解除' }
    }
    const targetCouple = getAcceptedCoupleRelation(targetId)
    if (targetCouple) {
      return { success: false, message: '对方已绑定情侣关系' }
    }
  }

  if (relationType === 'kin' && !isFollowing(targetId, requesterId, { scene: 'wedding' })) {
    return { success: false, message: '对方需先在婚礼笔记关注你，才可添加为亲友' }
  }

  const duplicated = relations.find((item) => {
    if (item.type !== relationType) return false
    if (item.status !== 'pending' && item.status !== 'accepted') return false

    if (relationType === 'couple') {
      return isSamePair(requesterId, targetId, item)
    }

    return String(item.requesterId) === requesterId && String(item.targetId) === targetId
  })

  if (duplicated) {
    return {
      success: false,
      message: duplicated.status === 'accepted' ? '关系已存在' : '已有待处理申请'
    }
  }

  const relation = {
    id: makeId(relationType === 'couple' ? 'CP' : 'WK'),
    type: relationType,
    status: relationType === 'kin' ? 'accepted' : 'pending',
    requesterId,
    targetId,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    sharedWeddingOwnerId: ''
  }

  saveRelations(scene, [relation, ...relations])
  upsertRelationToCloud(relation, scene)
  return { success: true, relation, immediate: relation.status === 'accepted', scene }
}

function acceptRelationRequest(relationId, options = {}) {
  const currentUserId = getCurrentUserId()
  const context = resolveRelationContext(relationId, options.scene)

  if (!context) {
    return { success: false, message: '申请不存在' }
  }

  const { scene, relations, index } = context
  const relation = relations[index]
  if (relation.status !== 'pending') {
    return { success: false, message: '申请状态已变更' }
  }
  if (String(relation.targetId) !== currentUserId) {
    return { success: false, message: '无权处理该申请' }
  }

  if (relation.type === 'couple') {
    const requesterCouple = getAcceptedCoupleRelation(relation.requesterId)
    const targetCouple = getAcceptedCoupleRelation(relation.targetId)
    if (requesterCouple || targetCouple) {
      return { success: false, message: '任一方已有情侣关系' }
    }
    relation.sharedWeddingOwnerId = String(relation.requesterId)
  }

  relation.status = 'accepted'
  relation.updatedAt = nowIso()
  relations[index] = relation
  saveRelations(scene, relations)
  upsertRelationToCloud(relation, scene)
  return { success: true, relation, scene }
}

function rejectRelationRequest(relationId, options = {}) {
  const currentUserId = getCurrentUserId()
  const context = resolveRelationContext(relationId, options.scene)

  if (!context) {
    return { success: false, message: '申请不存在' }
  }

  const { scene, relations, index } = context
  const relation = relations[index]
  if (relation.status !== 'pending') {
    return { success: false, message: '申请状态已变更' }
  }
  if (String(relation.targetId) !== currentUserId) {
    return { success: false, message: '无权处理该申请' }
  }

  relation.status = 'rejected'
  relation.updatedAt = nowIso()
  relations[index] = relation
  saveRelations(scene, relations)
  upsertRelationToCloud(relation, scene)
  return { success: true, scene }
}

function cancelRelationRequest(relationId, options = {}) {
  const currentUserId = getCurrentUserId()
  const context = resolveRelationContext(relationId, options.scene)

  if (!context) {
    return { success: false, message: '申请不存在' }
  }

  const { scene, relations, index } = context
  const relation = relations[index]
  if (relation.status !== 'pending') {
    return { success: false, message: '申请状态已变更' }
  }
  if (String(relation.requesterId) !== currentUserId) {
    return { success: false, message: '无权撤回该申请' }
  }

  relation.status = 'cancelled'
  relation.updatedAt = nowIso()
  relations[index] = relation
  saveRelations(scene, relations)
  upsertRelationToCloud(relation, scene)
  return { success: true, scene }
}

function endRelation(relationId, options = {}) {
  const currentUserId = getCurrentUserId()
  const context = resolveRelationContext(relationId, options.scene)

  if (!context) {
    return { success: false, message: '关系不存在' }
  }

  const { scene, relations, index } = context
  const relation = relations[index]
  if (relation.status !== 'accepted') {
    return { success: false, message: '关系不可解除' }
  }

  const canOperate = relation.type === 'follow'
    ? (relation.legacyMutual
      ? (String(relation.requesterId) === currentUserId || String(relation.targetId) === currentUserId)
      : String(relation.requesterId) === currentUserId)
    : (String(relation.requesterId) === currentUserId || String(relation.targetId) === currentUserId)

  if (!canOperate) {
    return { success: false, message: '无权操作该关系' }
  }

  relation.status = 'ended'
  relation.updatedAt = nowIso()
  relations[index] = relation
  saveRelations(scene, relations)
  upsertRelationToCloud(relation, scene)
  return { success: true, scene }
}

function buildFollowing(uid, relations) {
  const map = {}

  relations
    .filter((item) => item.type === 'follow' && item.status === 'accepted')
    .forEach((item) => {
      let targetId = ''
      if (item.legacyMutual) {
        if (String(item.requesterId) === uid) {
          targetId = String(item.targetId)
        } else if (String(item.targetId) === uid) {
          targetId = String(item.requesterId)
        }
      } else if (String(item.requesterId) === uid) {
        targetId = String(item.targetId)
      }

      const targetUser = toUserSummary(findUserById(targetId))
      if (!targetUser || !targetUser.id) {
        return
      }

      map[targetUser.id] = {
        ...item,
        target: targetUser
      }
    })

  return Object.keys(map).map((key) => map[key])
}

function buildFollowers(uid, relations, followingList, hostedKins) {
  const followingMap = {}
  ;(followingList || []).forEach((item) => {
    if (item && item.target && item.target.id) {
      followingMap[item.target.id] = true
    }
  })

  const hostedKinMap = {}
  ;(hostedKins || []).forEach((item) => {
    if (item && item.guest && item.guest.id) {
      hostedKinMap[item.guest.id] = true
    }
  })

  const map = {}
  relations
    .filter((item) => item.type === 'follow' && item.status === 'accepted')
    .forEach((item) => {
      let followerId = ''
      if (item.legacyMutual) {
        if (String(item.requesterId) === uid) {
          followerId = String(item.targetId)
        } else if (String(item.targetId) === uid) {
          followerId = String(item.requesterId)
        }
      } else if (String(item.targetId) === uid) {
        followerId = String(item.requesterId)
      }

      const followerUser = toUserSummary(findUserById(followerId))
      if (!followerUser || !followerUser.id) {
        return
      }

      map[followerUser.id] = {
        ...item,
        follower: followerUser,
        isFollowingBack: !!followingMap[followerUser.id],
        isKin: !!hostedKinMap[followerUser.id]
      }
    })

  return Object.keys(map).map((key) => map[key])
}

function getRelationOverview(userId, options = {}) {
  const uid = String(userId || getCurrentUserId())
  const scene = normalizeScene(options.scene || 'gold')
  const relations = getRelations(scene)

  const incomingPending = relations
    .filter((item) => item.status === 'pending' && String(item.targetId) === uid)
    .map((item) => ({ ...item, user: toUserSummary(findUserById(item.requesterId)) }))

  const outgoingPending = relations
    .filter((item) => item.status === 'pending' && String(item.requesterId) === uid)
    .map((item) => ({ ...item, user: toUserSummary(findUserById(item.targetId)) }))

  const following = buildFollowing(uid, relations)
  const hostedKins = scene === 'wedding'
    ? relations
      .filter((item) => item.type === 'kin' && item.status === 'accepted' && String(item.requesterId) === uid)
      .map((item) => ({
        ...item,
        guest: toUserSummary(findUserById(item.targetId))
      }))
    : []
  const followers = buildFollowers(uid, relations, following, hostedKins)
  const kinOfHosts = scene === 'wedding'
    ? relations
      .filter((item) => item.type === 'kin' && item.status === 'accepted' && String(item.targetId) === uid)
      .map((item) => ({
        ...item,
        host: toUserSummary(findUserById(item.requesterId))
      }))
    : []
  const couple = scene === 'wedding'
    ? relations
      .filter((item) => item.type === 'couple' && item.status === 'accepted')
      .filter((item) => String(item.requesterId) === uid || String(item.targetId) === uid)
      .map((item) => {
        const partnerId = String(item.requesterId) === uid ? String(item.targetId) : String(item.requesterId)
        return {
          ...item,
          partner: toUserSummary(findUserById(partnerId)),
          sharedWeddingOwnerId: String(item.sharedWeddingOwnerId || item.requesterId)
        }
      })
    : []

  return {
    incomingPending,
    outgoingPending,
    following,
    followers,
    couple,
    hostedKins,
    kinOfHosts,
    goldFriends: following.map((item) => ({ ...item, friend: item.target })),
    invitedGuests: hostedKins,
    guestOfHosts: kinOfHosts
  }
}

function getGoldReadableUsers(userId) {
  const uid = String(userId || getCurrentUserId())
  const currentUser = storage.getCurrentUser()
  const base = currentUser && String(currentUser.id) === uid ? currentUser : findUserById(uid)
  const map = {}
  const selfSummary = toUserSummary(base)
  if (selfSummary) {
    map[selfSummary.id] = selfSummary
  }

  const overview = getRelationOverview(uid, { scene: 'gold' })
  ;(overview.following || []).forEach((item) => {
    if (item.target && item.target.id) {
      map[item.target.id] = item.target
    }
  })

  return Object.keys(map).map((key) => map[key])
}

function getGoldViewStorageKey(userId) {
  return `${GOLD_VIEW_PREFIX}_${userId}`
}

function setGoldViewTarget(targetUserId, userId) {
  const uid = String(userId || getCurrentUserId())
  const targetId = String(targetUserId || '').trim()
  const readableUsers = getGoldReadableUsers(uid)

  if (!targetId || targetId === uid) {
    wx.removeStorageSync(getGoldViewStorageKey(uid))
    return { success: true }
  }

  const canRead = readableUsers.some((item) => String(item.id) === targetId)
  if (!canRead) {
    return { success: false, message: '需先在黄金笔记关注对方，才能查看完整黄金笔记' }
  }

  wx.setStorageSync(getGoldViewStorageKey(uid), targetId)
  return { success: true }
}

function getGoldViewState(userId) {
  const uid = String(userId || getCurrentUserId())
  const readableUsers = getGoldReadableUsers(uid)

  let targetUserId = ''
  try {
    targetUserId = String(wx.getStorageSync(getGoldViewStorageKey(uid)) || '').trim()
  } catch (error) {
    targetUserId = ''
  }

  const canRead = readableUsers.some((item) => String(item.id) === targetUserId)
  if (!canRead) {
    targetUserId = uid
  }

  const targetUser = readableUsers.find((item) => String(item.id) === targetUserId) || null

  return {
    viewerUserId: uid,
    targetUserId,
    targetUser,
    readableUsers,
    readOnly: targetUserId !== uid
  }
}

function getGoldSummarySnapshot(targetUserId, currentPrice) {
  const targetId = String(targetUserId || '').trim()
  const user = findUserById(targetId)
  if (!user) {
    return null
  }

  const holdings = storage.calculateHoldings(storage.getTransactions(targetId) || [])
  const safePrice = Number(currentPrice) || 0
  const unrealizedProfit = safePrice > 0
    ? holdings.currentHolding * (safePrice - holdings.avgCost)
    : 0

  return {
    user: toUserSummary(user),
    currentHolding: Number(holdings.currentHolding) || 0,
    unrealizedProfit,
    totalProfit: Number(holdings.realizedProfit) || 0,
    currentValue: safePrice > 0 ? holdings.currentHolding * safePrice : 0
  }
}

function getGoldFollowerCount(targetUserId) {
  const uid = String(targetUserId || '').trim()
  if (!uid) return 0

  return getRelationOverview(uid, { scene: 'gold' }).followers.length
}

function getGoldFollowingCount(userId) {
  const uid = String(userId || '').trim()
  if (!uid) return 0

  return getRelationOverview(uid, { scene: 'gold' }).following.length
}

function getLatestGoldTransaction(targetUserId) {
  const targetId = String(targetUserId || '').trim()
  if (!targetId) {
    return null
  }

  const transactions = (storage.getTransactions(targetId) || [])
    .slice()
    .sort((a, b) => (String(a.timestamp || '') < String(b.timestamp || '') ? 1 : -1))

  const latest = transactions[0]
  if (!latest) {
    return null
  }

  return {
    id: String(latest.id || ''),
    type: latest.type === 'sell' ? 'sell' : 'buy',
    price: Number(latest.price) || 0,
    weight: Number(latest.weight) || 0,
    date: String(latest.date || ''),
    timestamp: String(latest.timestamp || '')
  }
}

function getGoldVisitorProfile(targetUserId, currentPrice, viewerUserId) {
  const targetId = String(targetUserId || '').trim()
  const viewerId = String(viewerUserId || getCurrentUserId()).trim()
  if (!targetId) {
    return null
  }

  const user = findUserById(targetId)
  if (!user) {
    return null
  }

  const isSelf = targetId === viewerId
  const isFollowingTarget = isSelf || isFollowing(viewerId, targetId, { scene: 'gold' })
  const summary = getGoldSummarySnapshot(targetId, currentPrice) || {
    user: toUserSummary(user),
    currentHolding: 0,
    unrealizedProfit: 0,
    totalProfit: 0,
    currentValue: 0
  }
  const holdings = storage.calculateHoldings(storage.getTransactions(targetId) || [])
  const totalReturnRate = holdings.totalInvestment > 0
    ? (summary.totalProfit / holdings.totalInvestment) * 100
    : 0

  return {
    user: summary.user,
    isSelf,
    isFollowing: isFollowingTarget,
    followerCount: getGoldFollowerCount(targetId),
    followingCount: getGoldFollowingCount(targetId),
    currentHolding: Number(summary.currentHolding) || 0,
    avgCost: Number(holdings.avgCost) || 0,
    unrealizedProfit: Number(summary.unrealizedProfit) || 0,
    totalProfit: Number(summary.totalProfit) || 0,
    totalInvestment: Number(holdings.totalInvestment) || 0,
    currentValue: Number(summary.currentValue) || 0,
    totalReturnRate,
    latestTransaction: getLatestGoldTransaction(targetId)
  }
}

function buildGoldLeaderboardItem(user, currentPrice) {
  const summary = getGoldSummarySnapshot(user.id, currentPrice) || {
    user: toUserSummary(user),
    currentHolding: 0,
    unrealizedProfit: 0,
    totalProfit: 0,
    currentValue: 0
  }
  const latestTransaction = getLatestGoldTransaction(user.id)
  const holdings = storage.calculateHoldings(storage.getTransactions(user.id) || [])

  return {
    user: summary.user,
    followerCount: getGoldFollowerCount(user.id),
    contentCount: (storage.getTransactions(user.id) || []).length,
    currentHolding: Number(summary.currentHolding) || 0,
    totalProfit: Number(summary.totalProfit) || 0,
    currentValue: Number(summary.currentValue) || 0,
    totalInvestment: Number(holdings.totalInvestment) || 0,
    latestTransaction
  }
}

function getGoldLeaderboard(currentPrice) {
  const users = storage.getUsers() || []
  const list = users
    .filter((item) => item && item.id)
    .map((item) => buildGoldLeaderboardItem(item, currentPrice))

  const top10 = (source, compare) => source
    .slice()
    .sort(compare)
    .slice(0, 10)
    .map((item, index) => ({
      ...item,
      rank: index + 1
    }))

  return {
    profit: top10(list, (a, b) => b.totalProfit - a.totalProfit),
    fans: top10(list, (a, b) => b.followerCount - a.followerCount),
    holding: top10(list, (a, b) => b.currentHolding - a.currentHolding)
  }
}

function normalizeLeaderboardItem(item) {
  const source = item || {}
  return {
    user: toUserSummary(source.user) || null,
    followerCount: Number(source.followerCount) || 0,
    contentCount: Number(source.contentCount) || 0,
    currentHolding: Number(source.currentHolding) || 0,
    totalProfit: Number(source.totalProfit) || 0,
    currentValue: Number(source.currentValue) || 0,
    totalInvestment: Number(source.totalInvestment) || 0,
    latestTransaction: source.latestTransaction || null,
    rank: Number(source.rank) || 0
  }
}

function normalizeLeaderboardData(data) {
  const safeData = data || {}
  const normalizeList = (list) => (Array.isArray(list) ? list : []).map(normalizeLeaderboardItem)

  return {
    profit: normalizeList(safeData.profit),
    fans: normalizeList(safeData.fans),
    holding: normalizeList(safeData.holding)
  }
}

function cacheLeaderboardUsers(data) {
  const safeData = data || {}
  const userMap = {}
  ;['profit', 'fans', 'holding'].forEach((key) => {
    const list = Array.isArray(safeData[key]) ? safeData[key] : []
    list.forEach((item) => {
      const uid = String(item && item.user && item.user.id || '').trim()
      if (!uid) {
        return
      }
      const nickname = safeText(item.user.nickname || '用户', 20)
      const avatarUrl = safeText(item.user.avatarUrl || '', 400)
      userMap[uid] = {
        id: uid,
        nickname,
        avatarUrl
      }
    })
  })

  const userIds = Object.keys(userMap)
  if (userIds.length === 0) {
    return
  }

  try {
    const users = storage.getUsers() || []
    const existingById = {}
    users.forEach((user) => {
      if (!user || !user.id) {
        return
      }
      existingById[String(user.id)] = user
    })

    userIds.forEach((uid) => {
      const source = userMap[uid]
      const existed = existingById[uid]
      if (existed) {
        existed.nickname = source.nickname || existed.nickname || '用户'
        existed.avatarUrl = source.avatarUrl || existed.avatarUrl || ''
        return
      }

      users.push({
        id: source.id,
        nickname: source.nickname || '用户',
        avatarUrl: source.avatarUrl || '',
        openId: '',
        isWechatAuth: false,
        createdAt: nowIso(),
        lastLoginAt: ''
      })
    })

    wx.setStorageSync(USER_LIST_KEY, users)
  } catch (error) {
    console.warn('缓存排行榜用户失败', error)
  }
}

async function getGoldLeaderboardAsync(currentPrice) {
  if (!(wx && wx.cloud && typeof wx.cloud.callFunction === 'function')) {
    throw new Error('云能力不可用，无法加载排行榜')
  }

  try {
    const res = await wx.cloud.callFunction({
      name: 'getGoldLeaderboard',
      data: {
        currentPrice: Number(currentPrice) || 0
      }
    })

    const result = (res && res.result) || {}
    if (!result.success || !result.data) {
      throw new Error(result.message || '云端排行榜返回异常')
    }

    const normalized = normalizeLeaderboardData(result.data)
    cacheLeaderboardUsers(normalized)
    return normalized
  } catch (error) {
    throw new Error((error && error.message) || '云端排行榜读取失败')
  }
}

function canViewWeddingDate(ownerUserId, viewerUserId) {
  const ownerId = String(ownerUserId || '').trim()
  const viewerId = String(viewerUserId || getCurrentUserId()).trim()
  if (!ownerId || !viewerId) {
    return false
  }
  if (ownerId === viewerId) {
    return true
  }

  return getRelations('wedding').some((item) => {
    return item.type === 'kin'
      && item.status === 'accepted'
      && String(item.requesterId) === ownerId
      && String(item.targetId) === viewerId
  })
}

function getWeddingBlessingStorageKey(ownerUserId) {
  return `${WEDDING_BLESSINGS_PREFIX}_${ownerUserId}`
}

function getWeddingBlessings(ownerUserId) {
  const ownerId = String(ownerUserId || '').trim()
  if (!ownerId) return []

  try {
    const list = wx.getStorageSync(getWeddingBlessingStorageKey(ownerId))
    if (!Array.isArray(list)) {
      return []
    }

    return list
      .filter((item) => item && item.id && item.content)
      .map((item) => ({
        id: String(item.id),
        authorId: String(item.authorId || ''),
        authorName: safeText(item.authorName || '匿名访客', 30),
        content: safeText(item.content, 120),
        createdAt: String(item.createdAt || '')
      }))
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
  } catch (error) {
    console.error('读取祝福失败', error)
    return []
  }
}

function addWeddingBlessing(ownerUserId, content, guestUserId) {
  const ownerId = String(ownerUserId || '').trim()
  const writerId = String(guestUserId || getCurrentUserId()).trim()
  const safeContent = safeText(content, 120)

  if (!ownerId) {
    return { success: false, message: '目标婚礼无效' }
  }
  if (!safeContent) {
    return { success: false, message: '祝福内容不能为空' }
  }
  if (!findUserById(ownerId)) {
    return { success: false, message: '目标用户不存在' }
  }

  const writerUser = findUserById(writerId) || storage.getCurrentUser()
  const blessing = {
    id: makeId('WB'),
    authorId: writerId,
    authorName: safeText((writerUser && writerUser.nickname) || '匿名访客', 30),
    content: safeContent,
    createdAt: nowIso()
  }

  const list = getWeddingBlessings(ownerId)
  wx.setStorageSync(getWeddingBlessingStorageKey(ownerId), [blessing, ...list])
  return { success: true, blessing }
}

function getWeddingGuestViewByOwner(ownerUserId, guestUserId) {
  const ownerId = String(ownerUserId || '').trim()
  const viewerId = String(guestUserId || getCurrentUserId()).trim()
  if (!ownerId) {
    return null
  }

  const owner = findUserById(ownerId)
  if (!owner) {
    return null
  }

  const profile = storage.getWeddingProfile(ownerId) || {}
  const invite = storage.getWeddingInvite(ownerId) || {}
  const canViewDetails = canViewWeddingDate(ownerId, viewerId)

  return {
    ownerId,
    ownerName: safeText((owner && owner.nickname) || '新人', 20),
    weddingDate: canViewDetails ? safeText(profile.weddingDate || '', 20) : '',
    weddingLocation: canViewDetails ? safeText(profile.location || '', 40) : '',
    inviteMessage: safeText(invite.message || '诚邀您见证我们的婚礼。', 120),
    blessings: getWeddingBlessings(ownerId),
    canViewDetails
  }
}

function getWeddingGuestViewByOwnerAsync(ownerUserId, guestUserId) {
  return Promise.resolve(getWeddingGuestViewByOwner(ownerUserId, guestUserId))
}

module.exports = {
  RELATION_TYPES,
  normalizeScene,
  syncRelationsFromCloud,
  createRelationRequest,
  acceptRelationRequest,
  rejectRelationRequest,
  cancelRelationRequest,
  endRelation,
  listInvitableUsers,
  isFollowing,
  getRelationOverview,
  getAcceptedCoupleRelation,
  getWeddingWorkspaceOwnerId,
  getWeddingWorkspaceRole,
  getGoldReadableUsers,
  setGoldViewTarget,
  getGoldViewState,
  getGoldSummarySnapshot,
  getGoldFollowerCount,
  getGoldVisitorProfile,
  getGoldLeaderboard,
  getGoldLeaderboardAsync,
  canViewWeddingDate,
  getWeddingBlessings,
  addWeddingBlessing,
  getWeddingGuestViewByOwner,
  getWeddingGuestViewByOwnerAsync
}
