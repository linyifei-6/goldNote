// 云函数：saveWeddingData - 保存婚礼相关数据
const cloud = require('wx-server-sdk')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const db = cloud.database()

const PROFILE_MAIN_ID = 'PROFILE_MAIN'
const INVITE_MAIN_ID = 'INVITE_MAIN'

// 辅助函数： sanitize 输入
function sanitizeText(value, maxLen = 300) {
  return String(value || '').trim().slice(0, maxLen)
}

function sanitizeDate(date) {
  const text = String(date || '').trim()
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : ''
}

function generateId(prefix) {
  const random = Math.floor(Math.random() * 1000).toString().padStart(3, '0')
  return `${prefix}${Date.now()}${random}`
}

function normalizeBizId(dataType, inputId) {
  if (dataType === 'profile') return PROFILE_MAIN_ID
  if (dataType === 'invites') return sanitizeText(inputId || INVITE_MAIN_ID, 40)
  return sanitizeText(inputId || '', 40)
}

function normalizeByDataType(dataType, data, targetUserId) {
  const now = new Date()
  const next = {
    ...data,
    userId: targetUserId,
    updatedAt: now
  }

  if (dataType === 'profile') {
    next.id = PROFILE_MAIN_ID
    next.weddingDate = sanitizeDate(data.weddingDate)
    next.location = sanitizeText(data.location, 100)
    next.totalBudget = parseFloat(data.totalBudget) || 0
    next.hasSaved = true
    return next
  }

  if (dataType === 'tasks') {
    next.id = normalizeBizId(dataType, data.id || generateId('WT'))
    next.title = sanitizeText(data.title, 100)
    next.type = sanitizeText(data.type, 30) || '其他'
    next.dueDate = sanitizeDate(data.dueDate)
    next.checked = !!data.checked
    next.priority = Math.min(5, Math.max(1, parseInt(data.priority, 10) || 3))
    next.budgetAmount = Math.max(0, parseFloat(data.budgetAmount) || 0)
    next.actualAmount = Math.max(0, parseFloat(data.actualAmount) || 0)
    next.note = sanitizeText(data.note, 300)
    next.sortOrder = parseInt(data.sortOrder, 10) || 0
    next.createdAt = data.createdAt || now
    return next
  }

  if (dataType === 'expenses') {
    next.id = normalizeBizId(dataType, data.id || generateId('WE'))
    next.category = sanitizeText(data.category, 30)
    next.amount = Math.max(0, parseFloat(data.amount) || 0)
    next.date = sanitizeDate(data.date)
    next.createdAt = data.createdAt || now
    return next
  }

  if (dataType === 'notes') {
    next.id = normalizeBizId(dataType, data.id || generateId('WN'))
    next.title = sanitizeText(data.title, 100)
    next.content = sanitizeText(data.content, 2000)
    next.module = sanitizeText(data.module, 30)
    next.stage = sanitizeText(data.stage, 30)
    next.dueDate = sanitizeDate(data.dueDate)
    next.createdAt = data.createdAt || now
    return next
  }

  if (dataType === 'invites') {
    next.id = normalizeBizId(dataType, data.id)
    next.linkCode = sanitizeText(data.linkCode, 20) || generateId('WI')
    next.message = sanitizeText(data.message, 200)
    next.ownerName = sanitizeText(data.ownerName, 30) || '新人'
    next.invitees = Array.isArray(data.invitees) ? data.invitees : []
    next.createdAt = data.createdAt || now
    return next
  }

  return next
}

async function findDocByBizId(collection, targetUserId, dataType, data) {
  if (data && data._id) {
    return { _id: data._id }
  }

  const bizId = normalizeBizId(dataType, data && data.id)
  if (!bizId) {
    return null
  }

  const result = await collection
    .where({ userId: targetUserId, id: bizId })
    .limit(1)
    .get()

  return (result.data && result.data[0]) || null
}

async function confirmAttendanceByCode(code, guestName) {
  const inviteCode = sanitizeText(code, 20)
  const name = sanitizeText(guestName, 30)

  if (!inviteCode || !name) {
    return { success: false, message: '邀请码或姓名无效' }
  }

  const inviteCollection = db.collection('wedding_invites')
  const inviteRes = await inviteCollection.where({ linkCode: inviteCode }).limit(1).get()
  const invite = inviteRes.data && inviteRes.data[0]

  if (!invite) {
    return { success: false, message: '邀请码不存在' }
  }

  const invitees = Array.isArray(invite.invitees) ? [...invite.invitees] : []
  const foundIndex = invitees.findIndex(item => String(item.name || '') === name)

  if (foundIndex >= 0) {
    invitees[foundIndex] = {
      ...invitees[foundIndex],
      status: '已确认'
    }
  } else {
    invitees.push({
      id: generateId('WG'),
      name,
      status: '已确认'
    })
  }

  await inviteCollection.doc(invite._id).update({
    data: {
      invitees,
      updatedAt: new Date()
    }
  })

  return { success: true, message: '确认成功' }
}

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  const { action, dataType, data = {}, userId, code, guestName } = event

  try {
    if (dataType === 'guestAttendanceByCode' && action === 'confirm') {
      return await confirmAttendanceByCode(code, guestName)
    }

    const targetUserId = userId || wxContext.OPENID
    const collectionMap = {
      profile: 'wedding_profiles',
      tasks: 'wedding_tasks',
      expenses: 'wedding_expenses',
      notes: 'wedding_notes',
      invites: 'wedding_invites'
    }

    const collectionName = collectionMap[dataType]
    if (!collectionName) {
      return { success: false, message: '未知的数据类型' }
    }

    const collection = db.collection(collectionName)
    const now = new Date()

    if (action === 'create' || action === 'upsert') {
      const newData = normalizeByDataType(dataType, data, targetUserId)
      const existed = await findDocByBizId(collection, targetUserId, dataType, data)

      if (existed && existed._id) {
        await collection.doc(existed._id).update({
          data: {
            ...newData,
            updatedAt: now
          }
        })
        return { success: true, message: '更新成功', _id: existed._id, id: newData.id }
      }

      newData.createdAt = newData.createdAt || now
      const result = await collection.add({ data: newData })
      return { success: true, message: '创建成功', _id: result._id, id: newData.id }

    } else if (action === 'update') {
      const existed = await findDocByBizId(collection, targetUserId, dataType, data)
      if (!existed || !existed._id) {
        return { success: false, message: '记录不存在' }
      }

      const updateData = {
        ...normalizeByDataType(dataType, data, targetUserId),
        updatedAt: now
      }
      delete updateData._id
      delete updateData.userId
      delete updateData.createdAt

      await collection.doc(existed._id).update({
        data: updateData
      })

      return { success: true, message: '更新成功', _id: existed._id }

    } else if (action === 'delete') {
      const existed = await findDocByBizId(collection, targetUserId, dataType, data)
      if (!existed || !existed._id) {
        return { success: false, message: '记录不存在' }
      }

      await collection.doc(existed._id).remove()
      return { success: true, message: '删除成功' }

    } else {
      return { success: false, message: '未知的操作类型' }
    }

  } catch (error) {
    console.error('保存婚礼数据失败:', error)
    return {
      success: false,
      message: '保存失败，请稍后重试',
      error: error.message
    }
  }
}
