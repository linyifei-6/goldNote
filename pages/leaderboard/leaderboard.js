const auth = require('../../utils/auth')
const social = require('../../utils/social')
const storage = require('../../utils/storage')
const goldPrice = require('../../utils/goldPrice')
const chat = require('../../utils/chat')

Page({
  data: {
    user: null,
    currentPrice: '',
    goldPreviewUserId: '',
    leaderboardTabs: [
      { key: 'profit', label: '赚钱最多' },
      { key: 'fans', label: '人气最多' },
      { key: 'holding', label: '持仓大佬' }
    ],
    leaderboardActiveKey: 'profit',
    leaderboardData: {
      profit: [],
      fans: [],
      holding: []
    },
    leaderboardList: [],
    visitorModalVisible: false,
    visitorProfile: null,
    brokenAvatarUserMap: {},
    visitorAvatarBroken: false,
    unreadMessageCount: 0
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
    // 仅好友图标走该入口，消息图标必须绑定 onOpenMessageCenter。
    wx.navigateTo({ url: '/pages/social/social?scene=gold' })
  },

  async refreshPage() {
    const user = auth.ensureLogin('/pages/login/login')
    if (!user) return

    // 先同步黄金关系，确保粉丝/关注状态与访客可见范围是最新的
    await social.syncRelationsFromCloud('gold')

    // 解析当前用户头像中的 cloud:// URL
    const resolvedUsers = await auth.resolveUsersAvatarUrls([user])
    const resolvedUser = resolvedUsers[0] || user
    const messageCenter = this.buildPendingMessageCenter(resolvedUser.id)
    const chatUnreadCount = await chat.getUnreadCount('gold')
    this.setData({
      user: resolvedUser,
      unreadMessageCount: messageCenter.count + chatUnreadCount
    })
    await this.loadLeaderboard(resolvedUser.id)
  },

  buildPendingMessageCenter(userId) {
    const uid = String(userId || '')
    if (!uid) {
      return { count: 0 }
    }

    const overview = social.getRelationOverview(uid, { scene: 'gold' })
    return { count: (overview.incomingPending || []).length }
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

  async ensurePreviewPrice() {
    const sharedPrice = Number(storage.getGoldPreviewPrice())
    if (sharedPrice > 0) {
      this.setData({ currentPrice: sharedPrice.toFixed(2) })
      return sharedPrice
    }

    const existingPrice = Number(this.data.currentPrice)
    if (existingPrice > 0) {
      return existingPrice
    }

    try {
      const result = await goldPrice.getCurrentGoldPrice(false, 'simulator')
      const price = Number(result && result.price)
      if (price > 0) {
        this.setData({ currentPrice: price.toFixed(2) })
        return price
      }
    } catch (error) {
      // 忽略异常，后续按0处理
    }

    return 0
  },

  withLatestTradeText(list) {
    return (Array.isArray(list) ? list : []).map((item) => ({
      ...item,
      latestTradeText: this.formatLatestTradeText(item.latestTransaction)
    }))
  },

  async loadLeaderboard(viewerUserId) {
    let rawData
    try {
      rawData = await social.getGoldLeaderboardAsync(this.data.currentPrice)
    } catch (error) {
      const emptyData = {
        profit: [],
        fans: [],
        holding: []
      }
      this.setData({
        leaderboardData: emptyData,
        leaderboardList: [],
        brokenAvatarUserMap: {},
        visitorModalVisible: false,
        visitorProfile: null
      })

      const now = Date.now()
      if (!this._lastLeaderboardErrorToastAt || (now - this._lastLeaderboardErrorToastAt) > 3000) {
        this._lastLeaderboardErrorToastAt = now
        wx.showToast({ title: '排行榜加载失败，请检查云函数', icon: 'none' })
      }
      console.warn('排行榜加载失败:', error)
      return
    }

    let leaderboardData = {
      profit: this.withLatestTradeText(rawData.profit),
      fans: this.withLatestTradeText(rawData.fans),
      holding: this.withLatestTradeText(rawData.holding)
    }

    // 将所有 cloud:// 头像 URL 解析为临时 HTTPS URL，避免渲染层 500 错误
    const allKeys = ['profit', 'fans', 'holding']
    const allItems = allKeys.reduce((acc, k) => acc.concat(leaderboardData[k] || []), [])
    const allUsers = allItems.map((item) => item.user).filter(Boolean)
    const resolvedUsers = await auth.resolveUsersAvatarUrls(allUsers)
    const resolvedMap = {}
    resolvedUsers.forEach((u) => { if (u && u.id) resolvedMap[u.id] = u })
    allKeys.forEach((k) => {
      leaderboardData[k] = (leaderboardData[k] || []).map((item) => {
        if (!item || !item.user || !item.user.id) return item
        const resolved = resolvedMap[item.user.id]
        return resolved ? { ...item, user: resolved } : item
      })
    })

    const activeKey = this.data.leaderboardActiveKey || 'profit'
    this.setData({
      leaderboardData,
      leaderboardList: leaderboardData[activeKey] || [],
      brokenAvatarUserMap: {}
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

  async openVisitorProfileById(targetUserId) {
    const user = this.data.user
    const targetId = String(targetUserId || '').trim()
    if (!user || !user.id || !targetId) {
      wx.showToast({ title: '用户ID无效', icon: 'none' })
      return
    }

    // 访客页打开前再次同步关系，避免刚进入页面时关注状态滞后
    await social.syncRelationsFromCloud('gold')
    const previewPrice = await this.ensurePreviewPrice()

    // 先检查用户是否存在（本地缓存中）
    const existingProfile = social.getGoldVisitorProfile(targetId, previewPrice, user.id)
    if (!existingProfile) {
      wx.showToast({ title: '用户不存在', icon: 'none' })
      return
    }

    // 原先强制跳转可能导致页面未展示，改为统一弹窗展示；如需查看历史，可在弹层内点击“查看历史记录”

    // 先展示已有数据（即使是 0）让弹窗立即打开
    existingProfile.latestTradeText = this.formatLatestTradeText(existingProfile.latestTransaction)
    this.setData({
      goldPreviewUserId: targetId,
      visitorModalVisible: true,
      visitorProfile: existingProfile,
      visitorAvatarBroken: false
    })

    // 异步拉取目标用户最新交易数据（自己的数据不需要同步）
    if (targetId !== user.id) {
      const storage = require('../../utils/storage')
      await storage.syncTransactionsFromCloud(targetId)
    }

    // 重新计算并更新弹窗数据
    const freshProfile = social.getGoldVisitorProfile(targetId, previewPrice, user.id)
    if (freshProfile && this.data.visitorModalVisible) {
      freshProfile.latestTradeText = this.formatLatestTradeText(freshProfile.latestTransaction)
      const resolved = await auth.resolveUsersAvatarUrls([freshProfile.user])
      this.setData({
        visitorProfile: { ...freshProfile, user: resolved[0] || freshProfile.user },
        visitorAvatarBroken: false
      })
    }
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

  async openVisitorHistoryById(targetUserId) {
    const user = this.data.user || {}
    const uid = user && user.id ? String(user.id) : ''
    const targetId = String(targetUserId || '').trim()
    if (!uid) {
      wx.showToast({ title: '请先登录', icon: 'none' })
      return
    }
    if (!targetId) {
      wx.showToast({ title: '用户ID无效', icon: 'none' })
      return
    }

    const result = social.setGoldViewTarget(targetId === uid ? '' : targetId, uid)
    if (!result || !result.success) {
      wx.showToast({ title: result && result.message ? result.message : '无法查看该用户', icon: 'none' })
      return
    }

    this.setData({ visitorModalVisible: false, visitorProfile: null, visitorAvatarBroken: false })
    await storage.syncTransactionsFromCloud(targetId === uid ? uid : targetId)
    wx.switchTab({ url: '/pages/history/history' })
  },

  onCloseVisitorModal() {
    this.setData({ visitorModalVisible: false, visitorProfile: null, visitorAvatarBroken: false })
  },

  onOpenMessageCenter() {
    wx.navigateTo({ url: '/pages/messages/messages?scene=gold' })
  },

  noop() {},

  onLeaderboardAvatarError(e) {
    const userId = String((e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.userId) || '').trim()
    if (!userId) {
      return
    }

    const key = `brokenAvatarUserMap.${userId}`
    this.setData({ [key]: true })
  },

  onVisitorAvatarError() {
    this.setData({ visitorAvatarBroken: true })
  },

  onViewVisitorHistory() {
    const user = this.data.user || {}
    const visitor = this.data.visitorProfile || {}
    const targetUserId = visitor && visitor.user && visitor.user.id
    if (!user || !user.id || !targetUserId) return

    const result = social.setGoldViewTarget(targetUserId, user && user.id)
    if (!result || !result.success) {
      wx.showToast({ title: result && result.message ? result.message : '无法查看历史', icon: 'none' })
      return
    }

    this.setData({ visitorModalVisible: false, visitorProfile: null, visitorAvatarBroken: false })
    wx.switchTab({ url: '/pages/history/history' })
  },

  onReturnToMyHome() {
    const user = this.data.user || {}
    if (!user || !user.id) return
    // 清除 gold view target（返回自己视图）
    social.setGoldViewTarget('', user.id)
    this.setData({ visitorModalVisible: false, visitorProfile: null, visitorAvatarBroken: false })
    wx.switchTab({ url: '/pages/history/history' })
  },

  async onFollowVisitor() {
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
    await this.loadLeaderboard(user.id)
    this.openVisitorProfileById(targetUserId)
  },

  onOpenProfileModal() {
    const user = this.data.user || {}
    this.setData({
      profileModalVisible: true,
      profileNicknameDraft: user.nickname || ''
    })
  },

  onCloseProfileModal() {
    if (this.data.profileSaving) return
    this.setData({ profileModalVisible: false })
  },

  onProfileNicknameInput(e) {
    this.setData({ profileNicknameDraft: e.detail.value })
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

  onChangeAvatar() {
    const user = this.data.user || {}
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
        const cloudPath = `avatars/${user.id || 'user'}/${Date.now()}_${Math.floor(Math.random() * 1000)}.jpg`
        wx.cloud.uploadFile({ cloudPath, filePath })
          .then((uploadRes) => {
            const fileID = uploadRes && uploadRes.fileID
            if (!fileID) throw new Error('头像上传失败')
            return auth.updateWechatProfile({ nickname: user.nickname, avatarUrl: fileID })
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
          .finally(() => { wx.hideLoading() })
      }
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

  onClearData() {
    wx.showModal({
      title: '警示',
      content: '确定要清除当前账号的所有交易数据吗？此操作不可恢复。',
      success: async (res) => {
        if (!res.confirm) return
        const result = await storage.clearTransactionsAsync()
        if (!result.success) {
          wx.showToast({ title: result.message || '清空失败，请重试', icon: 'none' })
          return
        }
        wx.showToast({ title: '数据已清除', icon: 'success' })
      }
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
