const auth = require('../../utils/auth')
const social = require('../../utils/social')

Page({
  data: {
    user: null,
    currentPrice: '',
    goldPreviewUserId: '',
    leaderboardTabs: [
      { key: 'profit', label: '赚钱最多' },
      { key: 'fans', label: '人气最多' },
      { key: 'holding', label: '买金最多' },
      { key: 'value', label: '持仓大佬' }
    ],
    leaderboardActiveKey: 'profit',
    leaderboardData: {
      profit: [],
      fans: [],
      holding: [],
      value: []
    },
    leaderboardList: [],
    visitorModalVisible: false,
    visitorProfile: null
  },

  onLoad(options) {
    const currentPrice = String((options && options.price) || '').trim()
    this.setData({ currentPrice })
    this.refreshPage()
  },

  onShow() {
    this.refreshPage()
  },

  onGoWedding() {
    wx.navigateTo({ url: '/pages/wedding/wedding' })
  },

  onGoSelector() {
    wx.navigateTo({ url: '/pages/portal/portal' })
  },

  onGoSocial() {
    wx.navigateTo({ url: '/pages/social/social?scene=gold' })
  },

  refreshPage() {
    const user = auth.ensureLogin('/pages/login/login')
    if (!user) return

    this.setData({ user })
    this.loadLeaderboard(user.id)
  },

  safeNumber(value) {
    const num = Number(value)
    return Number.isFinite(num) ? num : 0
  },

  formatLatestTradeText(transaction) {
    if (!transaction) {
      return '暂无交易记录'
    }

    const date = String(transaction.date || '').trim() || '最近'
    const typeText = transaction.type === 'sell' ? '卖出' : '买入'
    const weight = this.safeNumber(transaction.weight).toFixed(2)
    const price = this.safeNumber(transaction.price).toFixed(2)
    return `${date} ${typeText}${weight}g（${price}元/g）`
  },

  withLatestTradeText(list) {
    return (Array.isArray(list) ? list : []).map((item) => ({
      ...item,
      latestTradeText: this.formatLatestTradeText(item.latestTransaction)
    }))
  },

  loadLeaderboard(viewerUserId) {
    const rawData = social.getGoldLeaderboard(this.data.currentPrice)
    const leaderboardData = {
      profit: this.withLatestTradeText(rawData.profit),
      fans: this.withLatestTradeText(rawData.fans),
      holding: this.withLatestTradeText(rawData.holding),
      value: this.withLatestTradeText(rawData.value)
    }

    const activeKey = this.data.leaderboardActiveKey || 'profit'
    this.setData({
      leaderboardData,
      leaderboardList: leaderboardData[activeKey] || []
    })

    const visitorProfile = this.data.visitorProfile
    if (visitorProfile && visitorProfile.user && visitorProfile.user.id) {
      const nextVisitor = social.getGoldVisitorProfile(visitorProfile.user.id, this.data.currentPrice, viewerUserId)
      if (nextVisitor) {
        nextVisitor.latestTradeText = this.formatLatestTradeText(nextVisitor.latestTransaction)
      }
      this.setData({ visitorProfile: nextVisitor })
    }
  },

  onLeaderboardTabTap(e) {
    const key = String(e.currentTarget.dataset.key || '').trim()
    if (!key || key === this.data.leaderboardActiveKey) {
      return
    }

    const leaderboardData = this.data.leaderboardData || {}
    this.setData({
      leaderboardActiveKey: key,
      leaderboardList: leaderboardData[key] || []
    })
  },

  onGoldPreviewInput(e) {
    this.setData({ goldPreviewUserId: e.detail.value })
  },

  openVisitorProfileById(targetUserId) {
    const user = this.data.user
    const targetId = String(targetUserId || '').trim()
    if (!user || !user.id || !targetId) {
      wx.showToast({ title: '用户ID无效', icon: 'none' })
      return
    }

    const visitorProfile = social.getGoldVisitorProfile(targetId, this.data.currentPrice, user.id)
    if (!visitorProfile) {
      wx.showToast({ title: '用户不存在', icon: 'none' })
      return
    }

    visitorProfile.latestTradeText = this.formatLatestTradeText(visitorProfile.latestTransaction)
    this.setData({
      goldPreviewUserId: targetId,
      visitorModalVisible: true,
      visitorProfile
    })
  },

  onCheckGoldPreview() {
    const targetUserId = String(this.data.goldPreviewUserId || '').trim()
    if (!targetUserId) {
      wx.showToast({ title: '请输入用户ID', icon: 'none' })
      return
    }

    this.openVisitorProfileById(targetUserId)
  },

  onOpenVisitorFromLeaderboard(e) {
    const userId = e.currentTarget.dataset.userId
    if (!userId) return
    this.openVisitorProfileById(userId)
  },

  onCloseVisitorModal() {
    this.setData({ visitorModalVisible: false, visitorProfile: null })
  },

  onFollowVisitor() {
    const user = this.data.user
    const visitor = this.data.visitorProfile
    const targetUserId = visitor && visitor.user && visitor.user.id
    if (!user || !user.id || !targetUserId) {
      return
    }

    if (visitor.isSelf || visitor.isFollowing) {
      return
    }

    const result = social.createRelationRequest('follow', targetUserId, { scene: 'gold' })
    if (!result.success) {
      wx.showToast({ title: result.message || '关注失败', icon: 'none' })
      return
    }

    wx.showToast({ title: '已关注', icon: 'success' })
    this.loadLeaderboard(user.id)
    this.openVisitorProfileById(targetUserId)
  }
})
