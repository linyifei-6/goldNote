const auth = require('../../utils/auth')
const storage = require('../../utils/storage')

Page({
  data: {
    nickname: '',
    loginLoading: false
  },

  onShow() {
    const user = storage.getCurrentUser()
    if (user && (user.isWechatAuth || user.isGuest)) {
      wx.redirectTo({ url: '/pages/portal/portal' })
      return
    }

    this.setData({ loginLoading: false })
  },

  onNicknameInput(e) {
    this.setData({
      nickname: e.detail.value
    })
  },

  /**
   * ?????????????? OPENID ????
   * ?? wx.getUserProfile?? API ???????
   */
  onWechatLogin() {
    if (this.data.loginLoading) {
      return
    }

    this.setData({ loginLoading: true })

    const nickname = String(this.data.nickname || '').trim()

    auth.cloudLoginDirect(nickname)
      .then((user) => {
        if (!user) {
          throw new Error('??????????')
        }

        const app = getApp()
        if (app && typeof app.refreshGlobalState === 'function') {
          app.refreshGlobalState()
        }

        wx.showToast({ title: '登录成功', icon: 'success' })
        wx.redirectTo({ url: '/pages/portal/portal' })
      })
      .catch(error => {
        console.error('微信登录失败', error)
        wx.showToast({
          title: error.message || '微信登录失败，请检查网络后重试',
          icon: 'none'
        })
      })
      .finally(() => {
        this.setData({ loginLoading: false })
      })
  },

  /**
   * 游客登录：无需微信授权
   */
  onGuestLogin() {
    if (this.data.loginLoading) return
    this.setData({ loginLoading: true })

    const nickname = String(this.data.nickname || '').trim()
    const guestUser = storage.loginAsGuest(nickname)

    if (guestUser) {
      const app = getApp()
      if (app && typeof app.refreshGlobalState === 'function') {
        app.refreshGlobalState()
      }
      wx.showToast({ title: '已进入游客模式', icon: 'none' })
      wx.redirectTo({ url: '/pages/portal/portal' })
    } else {
      wx.showToast({ title: '创建游客会话失败', icon: 'none' })
    }

    this.setData({ loginLoading: false })
  }
})
