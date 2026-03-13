const auth = require('../../utils/auth')
const storage = require('../../utils/storage')

Page({
  data: {
    loginLoading: false,
    nickname: '',
    authorizedUserInfo: null,
    needNicknameConfirm: false
  },

  onShow() {
    const user = storage.getCurrentUser()
    if (user && user.isWechatAuth) {
      wx.redirectTo({ url: '/pages/portal/portal' })
      return
    }

    // 清理旧的访客会话，统一走微信授权登录。
    if (user && !user.isWechatAuth) {
      storage.logout()
    }

    this.setData({
      nickname: '',
      authorizedUserInfo: null,
      needNicknameConfirm: false,
      loginLoading: false
    })
  },

  onNicknameInput(e) {
    this.setData({
      nickname: e.detail.value
    })
  },

  /**
   * 第一步：微信授权
   */
  onWechatLogin() {
    if (this.data.loginLoading) {
      return
    }

    this.setData({ loginLoading: true })

    auth.requestWechatProfile()
      .then(userInfo => {
        if (!userInfo) {
          throw new Error('未获取到微信用户信息')
        }

        return auth.autoLoginWithWechatProfile(userInfo).then(({ user, isNewUser }) => {
          if (!user) {
            throw new Error('微信登录失败，请重试')
          }

          if (!isNewUser) {
            const app = getApp()
            app.refreshGlobalState()
            wx.redirectTo({ url: '/pages/portal/portal' })
            return
          }

          this.setData({
            authorizedUserInfo: userInfo,
            nickname: user.nickName || user.nickname || userInfo.nickName || '',
            needNicknameConfirm: true
          })
        })
      })
      .catch(error => {
        console.error('微信登录失败', error)
        
        if (error.errMsg && error.errMsg.includes('cancel')) {
          // 用户取消授权
          wx.showToast({
            title: '已取消授权登录',
            icon: 'none'
          })
        } else {
          wx.showToast({
            title: error.message || '微信登录失败，请重试',
            icon: 'none'
          })
        }
      })
      .finally(() => {
        this.setData({ loginLoading: false })
      })
  },

  /**
   * 第二步：确认昵称并完成登录
   */
  onConfirmWechatLogin() {
    if (this.data.loginLoading) {
      return
    }

    const userInfo = this.data.authorizedUserInfo
    const nickname = String(this.data.nickname || '').trim()
    if (!userInfo) {
      wx.showToast({
        title: '请先完成微信授权',
        icon: 'none'
      })
      return
    }

    if (!nickname) {
      wx.showToast({
        title: '请输入昵称',
        icon: 'none'
      })
      return
    }

    this.setData({ loginLoading: true })

    auth.loginWithWechatProfile(userInfo, nickname)
      .then((user) => {
        if (!user) {
          throw new Error('微信登录失败，请重试')
        }

        const app = getApp()
        app.refreshGlobalState()

        wx.showToast({
          title: `欢迎你，${user.nickname}`,
          icon: 'none'
        })

        wx.redirectTo({ url: '/pages/portal/portal' })
      })
      .catch((error) => {
        console.error('确认登录失败', error)
        wx.showToast({
          title: error.message || '微信登录失败，请重试',
          icon: 'none'
        })
      })
      .finally(() => {
        this.setData({ loginLoading: false })
      })
  }
})
