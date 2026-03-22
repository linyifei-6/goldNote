const storage = require('./storage')

function ensureLogin(redirectPath = '/pages/login/login') {
  const user = storage.getCurrentUser()
  if (user && (user.isWechatAuth || user.isGuest)) {
    return user
  }

  wx.redirectTo({
    url: redirectPath
  })
  return null
}

function logout() {
  storage.logout()
}

function normalizeCloudUser(cloudUser, fallbackProfile) {
  if (!cloudUser || typeof cloudUser !== 'object') {
    return null
  }

  const openId = String(cloudUser.openId || '').trim()
  const stableId = openId || String(cloudUser.id || cloudUser._id || '').trim()
  if (!stableId) {
    return null
  }

  const fallbackAvatar = String(
    (fallbackProfile && (fallbackProfile.avatarUrl || fallbackProfile.avatar || fallbackProfile.avatar_url)) || ''
  ).trim()
  const cloudAvatar = String(
    cloudUser.avatarUrl || cloudUser.avatar || cloudUser.avatar_url || ''
  ).trim()

  return {
    id: stableId,
    openId,
    nickname: String(cloudUser.nickname || (fallbackProfile && fallbackProfile.nickName) || '微信用户').slice(0, 20),
    avatarUrl: cloudAvatar || fallbackAvatar || '',
    gender: cloudUser.gender || (fallbackProfile && fallbackProfile.gender) || 0,
    province: cloudUser.province || (fallbackProfile && fallbackProfile.province) || '',
    country: cloudUser.country || (fallbackProfile && fallbackProfile.country) || '',
    isWechatAuth: true,
    createdAt: cloudUser.createdAt || new Date().toISOString(),
    lastLoginAt: cloudUser.lastLoginAt || new Date().toISOString()
  }
}

/**
 * 请求微信授权信息
 * @returns {Promise<Object>} userInfo
 */
function requestWechatProfile() {
  return new Promise((resolve, reject) => {
    wx.getUserProfile({
      desc: '用于显示你的头像和昵称',
      success: (userRes) => {
        resolve(userRes && userRes.userInfo ? userRes.userInfo : null)
      },
      fail: (error) => {
        reject(error)
      }
    })
  })
}

function requestWechatProfileWithFallback() {
  return requestWechatProfile().catch((error) => {
    const errMsg = String((error && error.errMsg) || '')
    if (errMsg.includes('cancel')) {
      throw error
    }

    return new Promise((resolve, reject) => {
      if (!(wx && typeof wx.getUserInfo === 'function')) {
        reject(error)
        return
      }

      wx.getUserInfo({
        success: (res) => {
          const userInfo = res && res.userInfo ? res.userInfo : null
          if (!userInfo) {
            reject(error)
            return
          }
          resolve(userInfo)
        },
        fail: () => reject(error)
      })
    })
  })
}

/**
 * 使用授权信息完成微信登录（支持自定义昵称）
 * @param {Object} userInfo 微信授权返回的 userInfo
 * @param {string} customNickname 用户输入昵称
 * @returns {Object|null}
 */
function loginWithWechatProfile(userInfo, customNickname = '') {
  if (!userInfo || typeof userInfo !== 'object') {
    return Promise.resolve(null)
  }

  if (!(wx && wx.cloud && typeof wx.cloud.callFunction === 'function')) {
    return Promise.reject(new Error('云能力不可用，无法完成微信身份登录'))
  }

  const nickname = String(customNickname || '').trim().slice(0, 20)

  return wx.cloud.callFunction({
    name: 'login',
    data: {
      userInfo: {
        nickname: nickname || userInfo.nickName || '微信用户',
        avatarUrl: userInfo.avatarUrl || '',
        gender: userInfo.gender || 0,
        province: userInfo.province || '',
        country: userInfo.country || ''
      }
    }
  }).then((res) => {
    const result = (res && res.result) || {}
    if (!result.success || !result.user) {
      throw new Error(result.message || '微信登录失败')
    }

    const normalizedUser = normalizeCloudUser(result.user, userInfo)
    if (!normalizedUser) {
      throw new Error('登录返回的用户数据无效')
    }

    return storage.loginByWechat(normalizedUser)
  })
}

/**
 * 微信授权后自动登录：老用户直接登录，新用户用于后续昵称确认
 * @param {Object} userInfo 微信授权返回的 userInfo
 * @returns {Promise<{user: Object, isNewUser: boolean}>}
 */
function autoLoginWithWechatProfile(userInfo) {
  if (!userInfo || typeof userInfo !== 'object') {
    return Promise.resolve({ user: null, isNewUser: false })
  }

  if (!(wx && wx.cloud && typeof wx.cloud.callFunction === 'function')) {
    return Promise.reject(new Error('云能力不可用，无法完成微信身份登录'))
  }

  return wx.cloud.callFunction({
    name: 'login',
    data: {
      keepNickname: true,
      userInfo: {
        nickname: userInfo.nickName || '微信用户',
        avatarUrl: userInfo.avatarUrl || '',
        gender: userInfo.gender || 0,
        province: userInfo.province || '',
        country: userInfo.country || ''
      }
    }
  }).then((res) => {
    const result = (res && res.result) || {}
    if (!result.success || !result.user) {
      throw new Error(result.message || '微信登录失败')
    }

    const normalizedUser = normalizeCloudUser(result.user, userInfo)
    if (!normalizedUser) {
      throw new Error('登录返回的用户数据无效')
    }

    const savedUser = storage.loginByWechat(normalizedUser)
    return {
      user: savedUser,
      isNewUser: !!result.isNewUser
    }
  })
}

/**
 * 兼容旧调用：一步式微信登录
 */
function wechatLogin(customNickname = '') {
  return requestWechatProfile().then((userInfo) => {
    return loginWithWechatProfile(userInfo, customNickname)
  })
}

function updateWechatProfile(patch = {}) {
  const user = storage.getCurrentUser()
  if (!user || !user.isWechatAuth) {
    return Promise.reject(new Error('当前未登录微信账号'))
  }

  if (!(wx && wx.cloud && typeof wx.cloud.callFunction === 'function')) {
    return Promise.reject(new Error('云能力不可用，无法更新资料'))
  }

  const nickname = String(patch.nickname || user.nickname || '').trim().slice(0, 20)
  if (!nickname) {
    return Promise.reject(new Error('昵称不能为空'))
  }

  const payload = {
    nickname,
    avatarUrl: patch.avatarUrl || user.avatarUrl || '',
    gender: typeof patch.gender === 'number' ? patch.gender : (user.gender || 0),
    province: patch.province || user.province || '',
    country: patch.country || user.country || ''
  }

  return wx.cloud.callFunction({
    name: 'login',
    data: {
      userInfo: payload
    }
  }).then((res) => {
    const result = (res && res.result) || {}
    if (!result.success || !result.user) {
      throw new Error(result.message || '资料更新失败')
    }

    const normalizedUser = normalizeCloudUser(result.user)
    if (!normalizedUser) {
      throw new Error('资料更新返回数据无效')
    }

    if (!String(normalizedUser.avatarUrl || '').trim() && String(payload.avatarUrl || '').trim()) {
      normalizedUser.avatarUrl = String(payload.avatarUrl).trim()
    }

    return storage.loginByWechat(normalizedUser)
  })
}

/**
 * 修改当前账号昵称（身份仍由 openId 识别）
 * @param {string} nickname 新昵称
 * @returns {Promise<Object>}
 */
function updateNickname(nickname) {
  const safeNickname = String(nickname || '').trim().slice(0, 20)
  if (!safeNickname) {
    return Promise.reject(new Error('昵称不能为空'))
  }

  const currentUser = storage.getCurrentUser()
  if (currentUser && currentUser.isGuest && !currentUser.isWechatAuth) {
    const updatedGuest = storage.updateGuestNickname(safeNickname)
    if (!updatedGuest) {
      return Promise.reject(new Error('访客昵称更新失败'))
    }
    return Promise.resolve(updatedGuest)
  }

  return updateWechatProfile({ nickname: safeNickname })
}

/**
 * 获取用户头像URL
 * @param {Object} user 用户对象
 * @returns {string} 头像URL
 */
function getUserAvatarUrl(user) {
  if (!user) return ''
  return user.avatarUrl || ''
}

/**
 * 是否为微信认证用户
 * @param {Object} user 用户对象
 * @returns {boolean} 是否为微信认证
 */
function isWechatAuthUser(user) {
  return user && user.isWechatAuth === true
}

// 内存缓存：cloud:// fileID → 临时 HTTPS URL
const _cloudUrlCache = {}

/**
 * 将单个 cloud:// 文件 ID 解析为临时 HTTPS URL，非 cloud:// 链接原样返回
 */
function resolveCloudUrl(fileId) {
  const url = String(fileId || '').trim()
  if (!url.startsWith('cloud://')) return Promise.resolve(url)
  if (_cloudUrlCache[url]) return Promise.resolve(_cloudUrlCache[url])
  if (!(wx && wx.cloud && typeof wx.cloud.getTempFileURL === 'function')) return Promise.resolve('')
  return wx.cloud.getTempFileURL({ fileList: [url] })
    .then((res) => {
      const item = res && res.fileList && res.fileList[0]
      const tempUrl = item && item.tempFileURL
      if (tempUrl && !String(item.errMsg || '').includes('fail')) {
        _cloudUrlCache[url] = tempUrl
        return tempUrl
      }
      return ''
    })
    .catch(() => '')
}

/**
 * 批量解析用户对象数组中的 cloud:// 头像 URL
 * @param {Array} users 用户对象数组，每个含 avatarUrl 字段（或通过 getUrl 取得）
 * @param {Function} [getUrl] 从用户对象取 avatarUrl 的函数，默认 u => u.avatarUrl
 * @param {Function} [setUrl] 将解析后的 URL 写回新对象，默认 (u, url) => ({...u, avatarUrl: url})
 * @returns {Promise<Array>}
 */
async function resolveUsersAvatarUrls(users, getUrl, setUrl) {
  if (!Array.isArray(users) || users.length === 0) return users
  const getU = typeof getUrl === 'function' ? getUrl : (u) => (u && u.avatarUrl) || ''
  const setU = typeof setUrl === 'function' ? setUrl : (u, url) => ({ ...u, avatarUrl: url })

  const needResolve = users
    .map((u, idx) => ({ idx, url: String(getU(u) || '') }))
    .filter(({ url }) => url.startsWith('cloud://') && !_cloudUrlCache[url])

  if (needResolve.length > 0 && wx && wx.cloud && typeof wx.cloud.getTempFileURL === 'function') {
    // 每次最多 50 个
    const chunks = []
    for (let i = 0; i < needResolve.length; i += 50) {
      chunks.push(needResolve.slice(i, i + 50))
    }
    await Promise.all(chunks.map(async (chunk) => {
      try {
        const res = await wx.cloud.getTempFileURL({ fileList: chunk.map((c) => c.url) })
        ;(res && res.fileList || []).forEach((item) => {
          if (item && item.fileID && item.tempFileURL && !String(item.errMsg || '').includes('fail')) {
            _cloudUrlCache[item.fileID] = item.tempFileURL
          }
        })
      } catch (e) { /* 解析失败时 fallback 到原始 URL */ }
    }))
  }

  return users.map((u) => {
    if (!u) return u
    const url = String(getU(u) || '')
    if (!url.startsWith('cloud://')) {
      return u
    }
    const resolved = _cloudUrlCache[url] || ''
    return setU(u, resolved)
  })
}

module.exports = {
  ensureLogin,
  logout,
  requestWechatProfile,
  requestWechatProfileWithFallback,
  autoLoginWithWechatProfile,
  loginWithWechatProfile,
  wechatLogin,
  updateWechatProfile,
  updateNickname,
  getUserAvatarUrl,
  isWechatAuthUser,
  resolveCloudUrl,
  resolveUsersAvatarUrls
}
