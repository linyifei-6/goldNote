const storage = require('../../utils/storage')
const auth = require('../../utils/auth')
const social = require('../../utils/social')

Page({
  data: {
    notFound: false,
    ownerId: '',
    inviteCode: '',
    ownerName: '',
    weddingDate: '',
    weddingLocation: '',
    canViewDetails: false,
    inviteMessage: '',
    countdownText: '',
    blessingInput: '',
    blessings: []
  },

  async onLoad(options) {
    const ownerId = options && options.ownerId ? String(options.ownerId) : ''
    const code = options && options.code ? String(options.code) : ''

    if (!ownerId && !code) {
      this.setData({ notFound: true })
      return
    }

    if (ownerId) {
      await this.loadByOwnerId(ownerId)
      return
    }

    await this.loadByInviteCode(code)
  },

  async loadByOwnerId(ownerId) {
    const user = auth.ensureLogin('/pages/login/login')
    if (!user) return

    const viewData = await social.getWeddingGuestViewByOwnerAsync(ownerId, user.id)
    if (!viewData) {
      this.setData({ notFound: true })
      return
    }

    this.setData({
      notFound: false,
      ownerId: viewData.ownerId,
      inviteCode: viewData.inviteCode,
      ownerName: viewData.ownerName,
      weddingDate: viewData.weddingDate,
      weddingLocation: viewData.weddingLocation,
      canViewDetails: !!viewData.canViewDetails,
      inviteMessage: viewData.inviteMessage,
      countdownText: this.buildCountdownText(viewData.weddingDate),
      blessings: Array.isArray(viewData.blessings) ? viewData.blessings : []
    })
  },

  async loadByInviteCode(code) {
    const viewData = await storage.getWeddingGuestViewByCodeAsync(code)
    if (!viewData) {
      this.setData({ notFound: true })
      return
    }

    this.setData({
      notFound: false,
      ownerId: viewData.ownerId || '',
      inviteCode: viewData.inviteCode,
      ownerName: viewData.ownerName,
      weddingDate: viewData.weddingDate,
      weddingLocation: viewData.weddingLocation,
      canViewDetails: !!viewData.canViewDetails,
      inviteMessage: viewData.inviteMessage,
      countdownText: this.buildCountdownText(viewData.weddingDate),
      blessings: []
    })
  },

  onBlessingInput(e) {
    this.setData({ blessingInput: e.detail.value })
  },

  async onSubmitBlessing() {
    const ownerId = this.data.ownerId
    if (!ownerId) {
      wx.showToast({ title: '该页面不支持留言', icon: 'none' })
      return
    }

    const user = auth.ensureLogin('/pages/login/login')
    if (!user) return

    const result = social.addWeddingBlessing(ownerId, this.data.blessingInput, user.id)
    if (!result.success) {
      wx.showToast({ title: result.message || '留言失败', icon: 'none' })
      return
    }

    wx.showToast({ title: '祝福已发送', icon: 'success' })
    this.setData({ blessingInput: '' })
    this.loadByOwnerId(ownerId)
  },

  buildCountdownText(weddingDate) {
    if (!weddingDate) {
      return '婚期暂未公布'
    }

    const nowDate = new Date()
    const today = `${nowDate.getFullYear()}-${String(nowDate.getMonth() + 1).padStart(2, '0')}-${String(nowDate.getDate()).padStart(2, '0')}`
    const target = new Date(`${weddingDate}T00:00:00`)
    const now = new Date(`${today}T00:00:00`)
    const days = Math.floor((target.getTime() - now.getTime()) / 86400000)

    if (Number.isNaN(days)) {
      return '婚期信息异常'
    }
    if (days > 0) {
      return `距离婚礼还有 ${days} 天`
    }
    if (days === 0) {
      return '今天是婚礼日，欢迎见证幸福时刻'
    }
    return `婚礼已圆满结束 ${Math.abs(days)} 天`
  }
})
