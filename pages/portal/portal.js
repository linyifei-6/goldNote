const auth = require('../../utils/auth')
const storage = require('../../utils/storage')

Page({
  data: {
    user: null,
    profileModalVisible: false,
    profileNicknameDraft: '',
    profileSaving: false
  },

  onShow() {
    const user = storage.getCurrentUser()
    this.setData({ user })
  },

  onGoGold() {
    wx.switchTab({ url: '/pages/index/index' })
  },

  onGoWedding() {
    wx.navigateTo({ url: '/pages/wedding/wedding' })
  },

  onGoSocial() {
    wx.navigateTo({ url: '/pages/social/social?scene=gold' })
  },

  noop() {},

  onOpenProfileModal() {
    if (!this.data.user) {
      wx.navigateTo({ url: '/pages/login/login' })
      return
    }
    const user = this.data.user || {}
    this.setData({
      profileModalVisible: true,
      profileNicknameDraft: user.nickname || ''
    })
  },

  onGoLogin() {
    wx.navigateTo({ url: '/pages/login/login' })
  },

  onCloseProfileModal() {
    if (this.data.profileSaving) return
    this.setData({
      profileModalVisible: false
    })
  },

  onProfileNicknameInput(e) {
    this.setData({
      profileNicknameDraft: e.detail.value
    })
  },

  onCopyUserId() {
    const user = this.data.user || {}
    const userId = String(user.id || '')
    if (!userId) {
      wx.showToast({ title: '用户ID为空', icon: 'none' })
      return
    }

    wx.setClipboardData({
      data: userId,
      success: () => wx.showToast({ title: '用户ID已复制', icon: 'success' })
    })
  },

  onChangeAvatar() {
    wx.chooseImage({
      count: 1,
      sizeType: ['compressed'],
      sourceType: ['album', 'camera'],
      success: (res) => {
        const filePath = res && res.tempFilePaths && res.tempFilePaths[0]
        if (!filePath) return

        if (!(wx && wx.cloud && typeof wx.cloud.uploadFile === 'function')) {
          wx.showToast({ title: '当前环境不支持头像上传', icon: 'none' })
          return
        }

        wx.showLoading({ title: '上传头像中' })
        const user = this.data.user || {}
        const cloudPath = `avatars/${user.id || 'user'}/${Date.now()}_${Math.floor(Math.random() * 1000)}.jpg`
        wx.cloud.uploadFile({ cloudPath, filePath })
          .then((uploadRes) => {
            const fileID = uploadRes && uploadRes.fileID
            if (!fileID) {
              throw new Error('头像上传失败')
            }
            return auth.updateWechatProfile({
              nickname: user.nickname,
              avatarUrl: fileID
            })
          })
          .then((nextUser) => {
            const app = getApp()
            if (app && typeof app.refreshGlobalState === 'function') {
              app.refreshGlobalState()
            }
            this.setData({ user: nextUser })
            wx.showToast({ title: '头像已更新', icon: 'success' })
          })
          .catch((error) => {
            wx.showToast({ title: (error && error.message) || '头像更新失败', icon: 'none' })
          })
          .finally(() => {
            wx.hideLoading()
          })
      }
    })
  },

  onSaveProfileNickname() {
    if (this.data.profileSaving) return

    const nickname = String(this.data.profileNicknameDraft || '').trim()
    if (!nickname) {
      wx.showToast({ title: '昵称不能为空', icon: 'none' })
      return
    }

    this.setData({ profileSaving: true })

    auth.updateNickname(nickname)
      .then((user) => {
        const app = getApp()
        if (app && typeof app.refreshGlobalState === 'function') {
          app.refreshGlobalState()
        }
        this.setData({ user, profileNicknameDraft: user.nickname || '' })
        wx.showToast({ title: '昵称已更新', icon: 'success' })
      })
      .catch((error) => {
        wx.showToast({ title: (error && error.message) || '昵称更新失败', icon: 'none' })
      })
      .finally(() => {
        this.setData({ profileSaving: false })
      })
  },

  onClearGoldData() {
    wx.showModal({
      title: '警示',
      content: '确定要清除当前账号的黄金笔记数据吗？此操作不可恢复。',
      success: async (res) => {
        if (!res.confirm) {
          return
        }
        const result = await storage.clearTransactionsAsync()
        if (!result.success) {
          wx.showToast({ title: result.message || '清空失败，请重试', icon: 'none' })
          return
        }
        wx.showToast({ title: '黄金笔记数据已清除', icon: 'success' })
      }
    })
  },

  onClearWeddingData() {
    wx.showModal({
      title: '警示',
      content: '确定要清除当前账号的婚礼笔记数据吗？此操作不可恢复。',
      success: (res) => {
        if (!res.confirm) {
          return
        }

        const result = storage.clearWeddingAllData()
        if (!result || !result.success) {
          wx.showToast({ title: (result && result.message) || '清空失败，请重试', icon: 'none' })
          return
        }

        wx.showToast({ title: '婚礼笔记数据已清除', icon: 'success' })
      }
    })
  },

  onClearData() {
    this.onClearGoldData()
  },

  onLogout() {
    wx.showModal({
      title: '退出登录',
      content: '确定要退出当前账号吗？',
      success: (res) => {
        if (!res.confirm) return
        auth.logout()
        wx.reLaunch({ url: '/pages/login/login' })
      }
    })
  }
})
