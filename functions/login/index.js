// 云函数：login - 用户登录
const cloud = require('wx-server-sdk')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const db = cloud.database()
exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  const { nickname, avatarUrl, gender, province, country } = event.userInfo || {}
  const openId = wxContext.OPENID
  const keepNickname = !!event.keepNickname

  try {
    const usersCollection = db.collection('users')
    
    // 通过 OpenID 查找用户
    let user = await usersCollection.where({
      openId: openId
    }).get().then(res => res.data[0])

    if (user) {
      const nextNickname = keepNickname ? user.nickname : (nickname || user.nickname)
      // 更新用户信息（头像、昵称可能有变化）
      await usersCollection.doc(user._id).update({
        data: {
          nickname: nextNickname,
          avatarUrl: avatarUrl || user.avatarUrl,
          gender: gender || user.gender,
          province: province || user.province,
          country: country || user.country,
          lastLoginAt: db.serverDate()
        }
      })
      
      return {
        success: true,
        isNewUser: false,
        user: {
          id: openId,
          ...user,
          openId,
          nickname: nextNickname,
          avatarUrl: avatarUrl || user.avatarUrl
        }
      }
    }

    // 新用户
    const now = new Date()
    const newUser = {
      openId: wxContext.OPENID,
      nickname: nickname || `用户${openId.slice(-6)}`,
      avatarUrl: avatarUrl || '',
      gender: gender || 0,
      province: province || '',
      country: country || '',
      createdAt: now,
      lastLoginAt: now,
      isWechatAuth: true
    }

    const result = await usersCollection.add({
      data: newUser
    })

    return {
      success: true,
      isNewUser: true,
      user: {
        id: openId,
        _id: result._id,
        ...newUser
      }
    }

  } catch (error) {
    console.error('登录失败:', error)
    return {
      success: false,
      message: '登录失败，请稍后重试',
      error: error.message
    }
  }
}
