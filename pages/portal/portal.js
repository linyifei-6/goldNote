const auth = require('../../utils/auth')
const RECENT_NICKNAMES_KEY = 'gold_recent_nicknames'
const MAX_RECENT_NICKNAMES = 5

Page({
  data: {
    user: null,
    showNicknameEditor: false,
    nicknameDraft: '',
    nicknameSaving: false,
    recentNicknames: []
  },

  onShow() {
    const user = auth.ensureLogin()
    if (!user) return

    this.setData({ user })
  },

  onGoGold() {
    wx.switchTab({ url: '/pages/index/index' })
  },

  onGoWedding() {
    wx.navigateTo({ url: '/pages/wedding/wedding' })
  },

  onOpenNicknameEditor() {
    const user = this.data.user || {}
    this.setData({
      showNicknameEditor: true,
      nicknameDraft: user.nickname || '',
      recentNicknames: this.getRecentNicknames(user.nickname)
    })
  },

  onCloseNicknameEditor() {
    if (this.data.nicknameSaving) {
      return
    }

    this.setData({
      showNicknameEditor: false
    })
  },

  onNicknameInput(e) {
    this.setData({
      nicknameDraft: e.detail.value
    })
  },

  onPickRecentNickname(e) {
    const nickname = e.currentTarget.dataset.nickname
    if (!nickname) {
      return
    }
    this.setData({ nicknameDraft: nickname })
  },

  getRecentNicknames(currentNickname) {
    try {
      const list = wx.getStorageSync(RECENT_NICKNAMES_KEY)
      const safeCurrent = String(currentNickname || '').trim()
      if (!Array.isArray(list)) {
        return []
      }

      return list
        .map(item => String(item || '').trim())
        .filter(item => item && item !== safeCurrent)
        .slice(0, MAX_RECENT_NICKNAMES)
    } catch (error) {
      console.error('读取常用昵称失败', error)
      return []
    }
  },

  saveRecentNickname(nickname) {
    try {
      const safeNickname = String(nickname || '').trim().slice(0, 20)
      if (!safeNickname) {
        return
      }

      const list = wx.getStorageSync(RECENT_NICKNAMES_KEY)
      const oldList = Array.isArray(list) ? list.map(item => String(item || '').trim()).filter(Boolean) : []
      const next = [safeNickname, ...oldList.filter(item => item !== safeNickname)].slice(0, MAX_RECENT_NICKNAMES)
      wx.setStorageSync(RECENT_NICKNAMES_KEY, next)
      this.setData({ recentNicknames: next.filter(item => item !== safeNickname) })
    } catch (error) {
      console.error('保存常用昵称失败', error)
    }
  },

  onAvatarTap() {
    this.onPickLocalAvatar()
  },

  onPickLocalAvatar() {
    wx.chooseImage({
      count: 1,
      sizeType: ['compressed'],
      sourceType: ['album', 'camera'],
      success: (res) => {
        const filePath = res && res.tempFilePaths && res.tempFilePaths[0]
        if (!filePath) {
          return
        }

        this.uploadAndSaveAvatar(filePath)
      },
      fail: (error) => {
        console.error('选择头像失败', error)
      }
    })
  },

  uploadAndSaveAvatar(localFilePath) {
    const user = this.data.user || {}
    if (!(wx && wx.cloud && typeof wx.cloud.uploadFile === 'function')) {
      wx.showToast({ title: '当前环境不支持头像上传', icon: 'none' })
      return
    }

    wx.showLoading({ title: '上传头像中' })
    const cloudPath = `avatars/${user.id || 'user'}/${Date.now()}_${Math.floor(Math.random() * 1000)}.jpg`

    wx.cloud.uploadFile({
      cloudPath,
      filePath: localFilePath
    }).then((uploadRes) => {
      const fileID = uploadRes && uploadRes.fileID
      if (!fileID) {
        throw new Error('头像上传失败')
      }

      return auth.updateWechatProfile({
        nickname: user.nickname,
        avatarUrl: fileID
      })
    }).then((nextUser) => {
      const app = getApp()
      app.refreshGlobalState()
      this.setData({ user: nextUser })
      wx.showToast({ title: '头像已更新', icon: 'success' })
    }).catch((error) => {
      console.error('更新头像失败', error)
      wx.showToast({ title: error.message || '头像更新失败', icon: 'none' })
    }).finally(() => {
      wx.hideLoading()
    })
  },

  onSaveNickname() {
    if (this.data.nicknameSaving) {
      return
    }

    const nickname = String(this.data.nicknameDraft || '').trim()
    if (!nickname) {
      wx.showToast({ title: '昵称不能为空', icon: 'none' })
      return
    }

    this.setData({ nicknameSaving: true })

    auth.updateNickname(nickname)
      .then((user) => {
        const app = getApp()
        app.refreshGlobalState()
        this.saveRecentNickname(nickname)
        this.setData({
          user,
          showNicknameEditor: false
        })
        wx.showToast({ title: '昵称已更新', icon: 'success' })
      })
      .catch((error) => {
        console.error('修改昵称失败', error)
        wx.showToast({ title: error.message || '修改昵称失败', icon: 'none' })
      })
      .finally(() => {
        this.setData({ nicknameSaving: false })
      })
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
