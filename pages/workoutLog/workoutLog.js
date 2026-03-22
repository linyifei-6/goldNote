const workoutStore = require('../../utils/workoutStore')
const storage = require('../../utils/storage')
const social = require('../../utils/social')
const chat = require('../../utils/chat')
const noteNav = require('../../utils/noteNav')

Page({
  data: {
    currentSubTab: 'log',
    workoutSubTabs: noteNav.WORKOUT_SUB_TABS,
    user: null,
    unreadMessageCount: 0,
    typeOptions: ['跑步', '力量', 'HIIT', '骑行', '瑜伽', '游泳', '其他'],
    intensityOptions: ['低', '中', '高'],
    editingId: '',
    form: {
      workoutDate: workoutStore.toBeijingDate(),
      type: '跑步',
      durationMin: 30,
      intensity: '中',
      calories: 200,
      note: ''
    },
    records: []
  },

  async onShow() {
    await this.refreshTopCard()
    await workoutStore.syncFromCloud().catch(() => null)
    this.loadRecords()
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

  loadRecords() {
    try {
      const data = workoutStore.getWorkoutBootstrap()
      this.setData({ records: data.sessions.slice(0, 20) })
    } catch (error) {
      wx.showToast({ title: (error && error.message) || '读取失败', icon: 'none' })
    }
  },

  resetForm() {
    this.setData({
      editingId: '',
      form: {
        workoutDate: workoutStore.toBeijingDate(),
        type: '跑步',
        durationMin: 30,
        intensity: '中',
        calories: 200,
        note: ''
      }
    })
  },

  onInput(e) {
    const field = e.currentTarget.dataset.field
    const value = e.detail.value
    this.setData({ [`form.${field}`]: value })
  },

  onDateChange(e) {
    this.setData({
      'form.workoutDate': e.detail.value
    })
  },

  onTypeSelect(e) {
    const type = String(e.currentTarget.dataset.value || '')
    if (!type) return
    this.setData({
      'form.type': type
    })
  },

  onIntensitySelect(e) {
    const intensity = String(e.currentTarget.dataset.value || '')
    if (!intensity) return
    this.setData({
      'form.intensity': intensity
    })
  },

  async onSubmit() {
    const form = this.data.form
    if (!Number(form.durationMin)) {
      wx.showToast({ title: '请输入运动时长', icon: 'none' })
      return
    }

    const payload = {
      ...form,
      id: this.data.editingId || undefined
    }

    await workoutStore.saveSession(payload)
    wx.showToast({ title: this.data.editingId ? '运动记录已更新' : '运动记录已保存', icon: 'success' })
    this.resetForm()
    this.loadRecords()
  },

  onStartEdit(e) {
    const id = String(e.currentTarget.dataset.id || '')
    if (!id) {
      wx.showToast({ title: '记录ID无效', icon: 'none' })
      return
    }

    const records = this.data.records || []
    const target = records.find((item) => String(item.id) === id)
    if (!target) {
      wx.showToast({ title: '未找到记录', icon: 'none' })
      return
    }

    this.setData({
      editingId: id,
      form: {
        workoutDate: target.workoutDate || workoutStore.toBeijingDate(),
        type: target.type || '跑步',
        durationMin: target.durationMin || 0,
        intensity: target.intensity || '中',
        calories: target.calories || 0,
        note: target.note || ''
      }
    })

    wx.pageScrollTo({ scrollTop: 0, duration: 300 })
  },

  onCancelEdit() {
    this.resetForm()
  },

  async onDeleteRecord(e) {
    const id = String(e.currentTarget.dataset.id || '')
    if (!id) {
      wx.showToast({ title: '记录ID无效', icon: 'none' })
      return
    }

    wx.showModal({
      title: '删除记录',
      content: '确定删除这条运动记录吗？',
      success: async (res) => {
        if (!res.confirm) return
        const result = await workoutStore.deleteSession(id)
        if (!result.success) {
          wx.showToast({ title: result.message || '删除失败', icon: 'none' })
          return
        }
        if (id === this.data.editingId) {
          this.resetForm()
        }
        wx.showToast({ title: '已删除', icon: 'success' })
        this.loadRecords()
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
