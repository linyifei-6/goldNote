const auth = require('../../utils/auth')
const social = require('../../utils/social')
const chat = require('../../utils/chat')

Page({
  data: {
    user: null,
    scene: 'gold',
    pageTitle: '消息中心',
    activeTab: 'requests',
    pendingList: [],
    conversations: [],
    unreadChatCount: 0,
    loading: false
  },

  onLoad(options) {
    const scene = social.normalizeScene(options && options.scene)
    const pageTitle = scene === 'wedding' ? '婚礼消息中心' : '黄金消息中心'
    this.setData({ scene, pageTitle })
    wx.setNavigationBarTitle({ title: pageTitle })
  },

  onShow() {
    this.refreshPage()
  },

  relationTypeLabel(type) {
    if (type === 'couple') return '情侣关系'
    if (type === 'kin') return '亲友关系'
    return '关注'
  },

  async refreshPage() {
    const user = auth.ensureLogin('/pages/login/login')
    if (!user) return

    this.setData({ user, loading: true })

    if (user.isGuest) {
      this.setData({
        pendingList: [],
        conversations: [],
        unreadChatCount: 0,
        loading: false
      })
      return
    }

    await social.syncRelationsFromCloud(this.data.scene)

    const overview = social.getRelationOverview(user.id, { scene: this.data.scene })
    const pendingList = (overview.incomingPending || []).map((item) => ({
      ...item,
      typeLabel: this.relationTypeLabel(item.type),
      userName: (item.user && item.user.nickname) || '未命名用户',
      userId: (item.user && item.user.id) || ''
    }))

    const convResult = await chat.listConversations(this.data.scene)
    const conversations = convResult.success
      ? (convResult.list || []).map((item) => {
        const peer = item && item.peer ? item.peer : {}
        const nickname = String(peer.nickname || '未命名用户').trim() || '未命名用户'
        return {
          ...item,
          peer: {
            ...peer,
            nickname
          },
          peerInitial: nickname.slice(0, 1)
        }
      })
      : []
    const unreadChatCount = convResult.success ? convResult.unreadTotal : 0

    this.setData({
      pendingList,
      conversations,
      unreadChatCount,
      loading: false
    })

    if (!convResult.success && convResult.message) {
      wx.showToast({ title: convResult.message, icon: 'none' })
    }
  },

  onTabTap(e) {
    const tab = String(e.currentTarget.dataset.tab || '')
    if (!tab || tab === this.data.activeTab) {
      return
    }
    this.setData({ activeTab: tab })
  },

  onAcceptMessage(e) {
    const relationId = e.currentTarget.dataset.id
    const result = social.acceptRelationRequest(relationId, { scene: this.data.scene })
    if (!result.success) {
      wx.showToast({ title: result.message || '处理失败', icon: 'none' })
      return
    }

    wx.showToast({ title: '已同意', icon: 'success' })
    this.refreshPage()
  },

  onRejectMessage(e) {
    const relationId = e.currentTarget.dataset.id
    const result = social.rejectRelationRequest(relationId, { scene: this.data.scene })
    if (!result.success) {
      wx.showToast({ title: result.message || '处理失败', icon: 'none' })
      return
    }

    wx.showToast({ title: '已拒绝', icon: 'none' })
    this.refreshPage()
  },

  openChatByInfo(threadId, targetUserId, targetName) {
    const scene = this.data.scene
    const threadPart = encodeURIComponent(String(threadId || ''))
    const userPart = encodeURIComponent(String(targetUserId || ''))
    const namePart = encodeURIComponent(String(targetName || ''))
    wx.navigateTo({
      url: `/pages/chat/chat?scene=${scene}&threadId=${threadPart}&targetUserId=${userPart}&targetName=${namePart}`
    })
  },

  onOpenConversation(e) {
    const threadId = String(e.currentTarget.dataset.threadId || '')
    const targetUserId = String(e.currentTarget.dataset.userId || '')
    const targetName = String(e.currentTarget.dataset.userName || '聊天')
    if (!threadId && !targetUserId) {
      wx.showToast({ title: '会话信息无效', icon: 'none' })
      return
    }
    this.openChatByInfo(threadId, targetUserId, targetName)
  }
})
