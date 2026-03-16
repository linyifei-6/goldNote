const auth = require('../../utils/auth')
const social = require('../../utils/social')

Page({
  data: {
    user: null,
    scene: 'gold',
    pageTitle: '好友',
    activeTab: 'following',
    searchKeyword: '',
    displayList: [],
    searchResults: [],
    emptyText: '暂无数据',
    followingRelationMap: {},
    visitorModalVisible: false,
    visitorProfile: null,
    socialOverview: {
      incomingPending: [],
      outgoingPending: [],
      following: [],
      followers: [],
      couple: [],
      hostedKins: [],
      kinOfHosts: []
    },
    goldViewState: {
      targetUserId: '',
      readOnly: false,
      targetUser: null
    }
  },

  onLoad(options) {
    const scene = social.normalizeScene(options && options.scene)
    const pageTitle = scene === 'wedding' ? '婚礼好友管理' : '黄金好友管理'
    this.setData({ scene, pageTitle })
    wx.setNavigationBarTitle({ title: pageTitle })
  },

  onShow() {
    const user = auth.ensureLogin()
    if (!user) return

    this.setData({ user })
    this.loadSocialData()
  },

  loadSocialData() {
    const user = this.data.user
    const scene = this.data.scene
    if (!user || !user.id) {
      return
    }

    const overview = social.getRelationOverview(user.id, { scene })
    const goldViewState = scene === 'gold'
      ? social.getGoldViewState(user.id)
      : { targetUserId: '', readOnly: false, targetUser: null }

    const followingRelationMap = {}
    ;(overview.following || []).forEach((item) => {
      const uid = item && item.target && item.target.id ? String(item.target.id) : ''
      if (uid) {
        followingRelationMap[uid] = String(item.id || '')
      }
    })

    this.setData({
      socialOverview: {
        ...overview,
        couple: []
      },
      followingRelationMap,
      goldViewState
    })

    this.rebuildDisplayList()
    if (this.data.searchKeyword) {
      this.buildSearchResults()
    }
  },

  onTabTap(e) {
    const tab = e.currentTarget.dataset.tab
    if (!tab || tab === this.data.activeTab) {
      return
    }
    this.setData({ activeTab: tab })
    this.rebuildDisplayList()
  },

  onSearchInput(e) {
    const keyword = e.detail.value || ''
    this.setData({ searchKeyword: keyword })
    if (keyword.trim()) {
      this.buildSearchResults()
    } else {
      this.setData({ searchResults: [] })
      this.rebuildDisplayList()
    }
  },

  buildSearchResults() {
    const keyword = String(this.data.searchKeyword || '').trim().toLowerCase()
    if (!keyword) {
      this.setData({ searchResults: [] })
      return
    }
    const followingMap = this.data.followingRelationMap || {}
    const allUsers = social.listInvitableUsers() || []
    const results = allUsers
      .filter((u) => {
        const nick = String(u.nickname || '').toLowerCase()
        const uid = String(u.id || '').toLowerCase()
        return nick.includes(keyword) || uid.includes(keyword)
      })
      .map((u) => {
        const userId = String(u.id || '')
        const isFollowing = !!followingMap[userId]
        return {
          userId,
          nickname: u.nickname || '未命名用户',
          avatarUrl: u.avatarUrl || '',
          relationId: followingMap[userId] || '',
          actionType: isFollowing ? 'unfollow' : 'follow',
          actionText: isFollowing ? '已关注' : '关注'
        }
      })
    this.setData({ searchResults: results })
  },

  buildTabBaseList(activeTab) {
    const overview = this.data.socialOverview || {}
    const followingMap = this.data.followingRelationMap || {}

    if (activeTab === 'following') {
      return (overview.following || []).map((item) => {
        const user = item.target || {}
        const userId = String(user.id || '')
        return {
          uid: `following_${userId}`,
          userId,
          relationId: String(item.id || ''),
          nickname: user.nickname || '未命名用户',
          avatarUrl: user.avatarUrl || '',
          desc: `ID: ${userId}`,
          actionType: 'unfollow',
          actionText: '已关注'
        }
      })
    }

    if (activeTab === 'mutual') {
      return (overview.followers || [])
        .filter((item) => !!item.isFollowingBack)
        .map((item) => {
          const user = item.follower || {}
          const userId = String(user.id || '')
          return {
            uid: `mutual_${userId}`,
            userId,
            relationId: String(followingMap[userId] || ''),
            nickname: user.nickname || '未命名用户',
            avatarUrl: user.avatarUrl || '',
            desc: `ID: ${userId}`,
            actionType: 'unfollow',
            actionText: '已关注'
          }
        })
    }

    return (overview.followers || []).map((item) => {
      const user = item.follower || {}
      const userId = String(user.id || '')
      const isFollowingBack = !!item.isFollowingBack
      return {
        uid: `followers_${userId}`,
        userId,
        relationId: String(item.id || ''),
        nickname: user.nickname || '未命名用户',
        avatarUrl: user.avatarUrl || '',
        desc: `ID: ${userId}`,
        actionType: isFollowingBack ? 'none' : 'followBack',
        actionText: isFollowingBack ? '已关注' : '回关'
      }
    })
  },

  rebuildDisplayList() {
    const activeTab = this.data.activeTab
    const keyword = String(this.data.searchKeyword || '').trim().toLowerCase()
    const baseList = this.buildTabBaseList(activeTab)
    const displayList = keyword
      ? baseList.filter((item) => {
        const nick = String(item.nickname || '').toLowerCase()
        const uid = String(item.userId || '').toLowerCase()
        return nick.includes(keyword) || uid.includes(keyword)
      })
      : baseList

    let emptyText = '暂无数据'
    if (activeTab === 'mutual') {
      emptyText = keyword ? '没有匹配的互关用户' : '暂无互关用户'
    } else if (activeTab === 'following') {
      emptyText = keyword ? '没有匹配的关注用户' : '暂无关注用户'
    } else {
      emptyText = keyword ? '没有匹配的粉丝' : '暂无粉丝'
    }

    this.setData({ displayList, emptyText })
  },

  onAvatarTap(e) {
    const userId = e.currentTarget.dataset.userId
    if (!userId) return
    this.openVisitorProfileById(userId)
  },

  safeNumber(value) {
    const num = Number(value)
    return Number.isFinite(num) ? num : 0
  },

  formatLatestTradeText(transaction) {
    if (!transaction) return '暂无交易记录'
    const date = String(transaction.date || '').trim() || '最近'
    const typeText = transaction.type === 'sell' ? '卖出' : '买入'
    const weight = this.safeNumber(transaction.weight).toFixed(2)
    const price = this.safeNumber(transaction.price).toFixed(2)
    return `${date} ${typeText}${weight}g（${price}元/g）`
  },

  openVisitorProfileById(targetUserId) {
    const user = this.data.user
    const targetId = String(targetUserId || '').trim()
    if (!user || !user.id || !targetId) {
      wx.showToast({ title: '用户ID无效', icon: 'none' })
      return
    }
    const visitorProfile = social.getGoldVisitorProfile(targetId, '', user.id)
    if (!visitorProfile) {
      wx.showToast({ title: '用户不存在', icon: 'none' })
      return
    }
    visitorProfile.latestTradeText = this.formatLatestTradeText(visitorProfile.latestTransaction)
    this.setData({ visitorModalVisible: true, visitorProfile })
  },

  onCloseVisitorModal() {
    this.setData({ visitorModalVisible: false, visitorProfile: null })
  },

  onFollowVisitor() {
    const user = this.data.user
    const visitor = this.data.visitorProfile
    const targetUserId = visitor && visitor.user && visitor.user.id
    if (!user || !user.id || !targetUserId || visitor.isSelf) return

    if (visitor.isFollowing) {
      wx.showModal({
        title: '取消关注',
        content: `确定取消关注「${visitor.user.nickname}」？`,
        success: (res) => {
          if (!res.confirm) return
          const followingMap = this.data.followingRelationMap || {}
          const relationId = followingMap[String(targetUserId)]
          if (!relationId) {
            wx.showToast({ title: '找不到关注记录', icon: 'none' })
            return
          }
          const result = social.endRelation(relationId, { scene: this.data.scene })
          if (!result.success) {
            wx.showToast({ title: result.message || '操作失败', icon: 'none' })
            return
          }
          wx.showToast({ title: '已取消关注', icon: 'success' })
          this.setData({ visitorModalVisible: false, visitorProfile: null })
          this.loadSocialData()
        }
      })
      return
    }

    const result = social.createRelationRequest('follow', targetUserId, { scene: this.data.scene })
    if (!result.success) {
      wx.showToast({ title: result.message || '关注失败', icon: 'none' })
      return
    }
    wx.showToast({ title: '已关注', icon: 'success' })
    this.loadSocialData()
    this.openVisitorProfileById(targetUserId)
  },

  onListAction(e) {
    const action = e.currentTarget.dataset.action
    if (!action || action === 'none') {
      return
    }

    if (action === 'unfollow') {
      const relationId = e.currentTarget.dataset.relationId
      const userId = e.currentTarget.dataset.userId || ''
      const target = this.data.displayList.find((i) => i.userId === userId) ||
        this.data.searchResults.find((i) => i.userId === userId) || { nickname: '该用户' }
      wx.showModal({
        title: '取消关注',
        content: `确定取消关注「${target.nickname}」？`,
        success: (res) => {
          if (!res.confirm) return
          if (!relationId) {
            wx.showToast({ title: '找不到关注记录', icon: 'none' })
            return
          }
          const result = social.endRelation(relationId, { scene: this.data.scene })
          if (!result.success) {
            wx.showToast({ title: result.message || '取消失败', icon: 'none' })
            return
          }
          wx.showToast({ title: '已取消关注', icon: 'success' })
          this.loadSocialData()
        }
      })
      return
    }

    if (action === 'follow') {
      const targetUserId = e.currentTarget.dataset.userId
      const result = social.createRelationRequest('follow', targetUserId, { scene: this.data.scene })
      if (!result.success) {
        wx.showToast({ title: result.message || '关注失败', icon: 'none' })
        return
      }
      wx.showToast({ title: '已关注', icon: 'success' })
      this.loadSocialData()
      return
    }

    if (action === 'followBack') {
      const targetUserId = e.currentTarget.dataset.userId
      const result = social.createRelationRequest('follow', targetUserId, { scene: this.data.scene })
      if (!result.success) {
        wx.showToast({ title: result.message || '回关失败', icon: 'none' })
        return
      }
      wx.showToast({ title: '已回关', icon: 'success' })
      this.loadSocialData()
    }
  },

  onSetGoldView(e) {
    if (this.data.scene !== 'gold') {
      return
    }
    const targetUserId = e.currentTarget.dataset.userId || ''
    const user = this.data.user
    const result = social.setGoldViewTarget(targetUserId, user && user.id)
    if (!result.success) {
      wx.showToast({ title: result.message || '切换失败', icon: 'none' })
      return
    }

    wx.showToast({ title: targetUserId ? '已切换查看对象' : '已切回自己', icon: 'success' })
    this.loadSocialData()
  },

  onOpenGuestView() {}
})
