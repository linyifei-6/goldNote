// 云函数：getWeddingData - 获取婚礼相关数据
const cloud = require('wx-server-sdk')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const db = cloud.database()

async function getGuestViewByCode(code) {
  const inviteCode = String(code || '').trim()
  if (!inviteCode) {
    return { success: false, message: '邀请码不能为空' }
  }

  const inviteRes = await db.collection('wedding_invites')
    .where({ linkCode: inviteCode })
    .limit(1)
    .get()

  const invite = inviteRes.data && inviteRes.data[0]
  if (!invite) {
    return { success: false, message: '邀请码不存在' }
  }

  const ownerId = invite.userId
  const profileRes = await db.collection('wedding_profiles')
    .where({ userId: ownerId })
    .limit(1)
    .get()
  const profile = (profileRes.data && profileRes.data[0]) || {}

  const tasksRes = await db.collection('wedding_tasks')
    .where({ userId: ownerId })
    .get()
  const tasks = tasksRes.data || []

  const totalTasks = tasks.length
  const completedTasks = tasks.filter(item => !!item.checked).length

  return {
    success: true,
    dataType: 'guestViewByCode',
    data: {
      inviteCode,
      ownerName: String(invite.ownerName || '新人'),
      weddingDate: String(profile.weddingDate || ''),
      weddingLocation: String(profile.location || ''),
      inviteMessage: String(invite.message || '诚邀您见证我们的婚礼。'),
      totalTasks,
      completedTasks
    }
  }
}

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  const { dataType, userId, code } = event

  try {
    if (dataType === 'guestViewByCode') {
      return await getGuestViewByCode(code)
    }

    const targetUserId = userId || wxContext.OPENID
    const dataTypeMap = {
      profile: 'wedding_profiles',
      tasks: 'wedding_tasks',
      expenses: 'wedding_expenses',
      notes: 'wedding_notes',
      invites: 'wedding_invites'
    }

    const collectionName = dataTypeMap[dataType]
    if (!collectionName) {
      return { success: false, message: '未知的数据类型' }
    }

    const collection = db.collection(collectionName)
    const result = await collection
      .where({ userId: targetUserId })
      .get()

    return {
      success: true,
      data: result.data,
      dataType
    }
  } catch (error) {
    console.error('获取婚礼数据失败:', error)
    return {
      success: false,
      message: '获取数据失败',
      error: error.message
    }
  }
}
