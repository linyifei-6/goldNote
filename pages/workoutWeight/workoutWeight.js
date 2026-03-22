const workoutStore = require('../../utils/workoutStore')
const storage = require('../../utils/storage')
const social = require('../../utils/social')
const chat = require('../../utils/chat')
const noteNav = require('../../utils/noteNav')

Page({
  data: {
    currentSubTab: 'weight',
    workoutSubTabs: noteNav.WORKOUT_SUB_TABS,
    user: null,
    unreadMessageCount: 0,
    target: {
      targetWeight: 0,
      targetEndDate: ''
    },
    form: {
      recordDate: workoutStore.toBeijingDate(),
      weight: '',
      bodyFat: ''
    },
    records: []
  },

  async onShow() {
    await this.refreshTopCard()
    await workoutStore.syncFromCloud().catch(() => null)
    this.loadData()
  },

  async refreshTopCard() {
    const user = storage.getCurrentUser()
    if (!user) {
      this.setData({ user: null, unreadMessageCount: 0 })
      return
    }

    let relationUnread = 0
    let chatUnread = 0
    try {
      await social.syncRelationsFromCloud('wedding')
      const overview = social.getRelationOverview(user.id, { scene: 'wedding' })
      relationUnread = Array.isArray(overview.incomingPending) ? overview.incomingPending.length : 0
    } catch (error) {
      // ignore relation sync issues, page still works with local state
    }

    try {
      chatUnread = await chat.getUnreadCount('wedding')
    } catch (error) {
      chatUnread = 0
    }

    this.setData({
      user,
      unreadMessageCount: relationUnread + chatUnread
    })
  },

  loadData() {
    try {
      const data = workoutStore.getWorkoutBootstrap()
      const latest = (data.weights || [])[0] || {}
      this.setData({
        target: {
          targetWeight: latest.targetWeight || 0,
          targetEndDate: latest.targetEndDate || ''
        },
        records: (data.weights || []).slice(0, 30)
      })
    } catch (error) {
      wx.showToast({ title: (error && error.message) || '读取失败', icon: 'none' })
    }
  },

  onInput(e) {
    const field = e.currentTarget.dataset.field
    const value = e.detail.value
    if (field === 'targetWeight' || field === 'targetEndDate') {
      this.setData({ [`target.${field}`]: value })
      return
    }
    this.setData({ [`form.${field}`]: value })
  },

  onRecordDateChange(e) {
    this.setData({
      'form.recordDate': e.detail.value
    })
  },

  onTargetDateChange(e) {
    this.setData({
      'target.targetEndDate': e.detail.value
    })
  },

  async onSubmit() {
    const payload = {
      ...this.data.form,
      targetWeight: this.data.target.targetWeight,
      targetEndDate: this.data.target.targetEndDate
    }
    if (!(Number(payload.weight) > 0)) {
      wx.showToast({ title: '请输入体重', icon: 'none' })
      return
    }

    await workoutStore.saveWeight(payload)
    wx.showToast({ title: '体重记录已保存', icon: 'success' })
    this.setData({
      'form.weight': '',
      'form.bodyFat': ''
    })
    this.loadData()
  },

  async onDeleteRecord(e) {
    const id = String(e.currentTarget.dataset.id || '')
    if (!id) {
      wx.showToast({ title: '记录ID无效', icon: 'none' })
      return
    }

    wx.showModal({
      title: '删除记录',
      content: '确定删除这条体重记录吗？',
      success: async (res) => {
        if (!res.confirm) return
        const result = await workoutStore.deleteWeight(id)
        if (!result.success) {
          wx.showToast({ title: result.message || '删除失败', icon: 'none' })
          return
        }
        wx.showToast({ title: '已删除', icon: 'success' })
        this.loadData()
      }
    })
  },

  onGoSelector() {
    wx.navigateBack({
      fail: () => {
        wx.redirectTo({ url: '/pages/portal/portal' })
      }
    })
  },

  onGoSocial() {
    wx.navigateTo({ url: '/pages/social/social?scene=wedding' })
  },

  onOpenMessageCenter() {
    const user = this.data.user
    if (!user || user.isGuest) {
      wx.showToast({ title: '请先微信登录后使用聊天', icon: 'none' })
      return
    }
    wx.navigateTo({ url: '/pages/messages/messages?scene=wedding' })
  },

  onSwitchSubTab(e) {
    const tab = String((e && e.detail && e.detail.key) || (e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.tab) || '')
    const routeMap = {
      log: '/pages/workoutLog/workoutLog',
      plan: '/pages/workoutPlan/workoutPlan',
      stats: '/pages/workoutStats/workoutStats',
      weight: '/pages/workoutWeight/workoutWeight'
    }
    const target = routeMap[tab]
    if (!target || tab === this.data.currentSubTab) {
      return
    }
    wx.redirectTo({ url: target })
  }
})
