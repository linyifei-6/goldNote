// 云函数：manageRelations - 管理社交关系（关注、情侣、亲友）
// 存储集合：social_relations
// 原则：cloud 端是数据主库；客户端以此作为 source of truth 同步到本地缓存

const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const _ = db.command

const ALLOWED_TYPES = ['follow', 'couple', 'kin']
const ALLOWED_STATUSES = ['pending', 'accepted', 'rejected', 'cancelled', 'ended']
const ALLOWED_SCENES = ['gold', 'wedding']

function sanitizeText(value, max) {
  return String(value || '').trim().slice(0, max)
}

function normalizeScene(scene) {
  return scene === 'wedding' ? 'wedding' : 'gold'
}

/**
 * 查询当前用户在某场景下参与的所有关系（以 requester 或 target 身份）。
 * 不过滤已终止的关系，让客户端决定如何使用。
 */
async function handleGet(openId, event) {
  const scene = normalizeScene(event.scene)

  const result = await db.collection('social_relations')
    .where(
      _.or([
        { requesterId: openId, scene },
        { targetId: openId, scene }
      ])
    )
    .limit(500)
    .get()

  return { success: true, data: result.data || [], scene }
}

/**
 * 新建或覆盖更新一条关系记录。
 * 安全规则：
 *   - 创建时 requesterId 必须等于当前调用者的 openId。
 *   - 更新时调用者必须是 requesterId 或 targetId 之一。
 */
async function handleUpsert(openId, event) {
  const relation = event.relation || {}
  const id = sanitizeText(relation.id, 60)
  const type = sanitizeText(relation.type, 20)
  const status = sanitizeText(relation.status, 20)
  const requesterId = sanitizeText(relation.requesterId, 80)
  const targetId = sanitizeText(relation.targetId, 80)
  const scene = normalizeScene(relation.scene)

  if (!id || !ALLOWED_TYPES.includes(type) || !ALLOWED_STATUSES.includes(status)) {
    return { success: false, message: '关系数据格式错误' }
  }
  if (!requesterId || !targetId || requesterId === targetId) {
    return { success: false, message: '参与者 ID 无效' }
  }

  // 检查调用者身份
  if (requesterId !== openId && targetId !== openId) {
    return { success: false, message: '无权操作：调用者不是关系参与方' }
  }

  // 若是创建新关系，调用者必须是 requester
  const existing = await db.collection('social_relations')
    .where({ id })
    .limit(1)
    .get()

  if (existing.data && existing.data.length === 0) {
    // 新记录
    if (requesterId !== openId) {
      return { success: false, message: '无权创建非本人发起的关系' }
    }
    await db.collection('social_relations').add({
      data: {
        id,
        type,
        status,
        scene,
        requesterId,
        targetId,
        sharedWeddingOwnerId: sanitizeText(relation.sharedWeddingOwnerId, 80),
        createdAt: relation.createdAt || new Date(),
        updatedAt: new Date()
      }
    })
  } else {
    // 更新已有记录：只允许更新 status / sharedWeddingOwnerId
    await db.collection('social_relations')
      .where({ id })
      .update({
        data: {
          status,
          sharedWeddingOwnerId: sanitizeText(relation.sharedWeddingOwnerId, 80),
          updatedAt: new Date()
        }
      })
  }

  return { success: true }
}

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  const openId = wxContext.OPENID

  if (!openId) {
    return { success: false, message: '未登录' }
  }

  try {
    const action = String(event.action || '').trim()
    if (action === 'get') {
      return await handleGet(openId, event)
    }
    if (action === 'upsert') {
      return await handleUpsert(openId, event)
    }
    return { success: false, message: '未知操作' }
  } catch (error) {
    console.error('manageRelations 执行失败', error)
    return { success: false, message: '云端操作失败', error: error.message }
  }
}
