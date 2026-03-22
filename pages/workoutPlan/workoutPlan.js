const workoutStore = require('../../utils/workoutStore')
const workoutBiz = require('../../utils/workout')
const storage = require('../../utils/storage')
const social = require('../../utils/social')
const chat = require('../../utils/chat')
const noteNav = require('../../utils/noteNav')

Page({
  data: {
    currentSubTab: 'plan',
    workoutSubTabs: noteNav.WORKOUT_SUB_TABS,
    user: null,
    unreadMessageCount: 0,
    weeklyTargetOptions: [2, 3, 4, 5, 6],
    weekdayOptions: [
      { key: 'mon', label: '周一' },
      { key: 'tue', label: '周二' },
      { key: 'wed', label: '周三' },
      { key: 'thu', label: '周四' },
      { key: 'fri', label: '周五' },
      { key: 'sat', label: '周六' },
      { key: 'sun', label: '周日' }
    ],
    templateTypeOptions: ['力量', '跑步', 'HIIT', '骑行', '瑜伽', '游泳', '其他'],
    draftTemplateWeekday: 'mon',
    draftTemplateType: '力量',
    plan: {
      id: 'PLAN_MAIN',
      weekStartDate: workoutStore.toBeijingDate(),
      weeklyTargetDays: 3,
      items: [],
      note: ''
    },
    progress: {
      targetDays: 0,
      actualDays: 0,
      completionRate: 0
    },
    templateProgress: {
      total: 0,
      done: 0,
      completionRate: 0
    }
  },

  async onShow() {
    await this.refreshTopCard()
    await workoutStore.syncFromCloud().catch(() => null)
    this.loadPlan()
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

  loadPlan() {
    try {
      const data = workoutStore.getWorkoutBootstrap()
      const mainPlan = (data.plans || []).find((item) => item.id === 'PLAN_MAIN')
      const currentPlan = {
        ...this.data.plan,
        ...(mainPlan || {}),
        items: Array.isArray((mainPlan || {}).items) ? mainPlan.items : (this.data.plan.items || [])
      }
      this.setData({
        plan: currentPlan,
        progress: workoutBiz.calculateWeeklyCompletion(data.sessions || [], currentPlan),
        templateProgress: this.calculateTemplateProgress(currentPlan.items)
      })
    } catch (error) {
      wx.showToast({ title: (error && error.message) || '读取失败', icon: 'none' })
    }
  },

  calculateTemplateProgress(items) {
    const list = Array.isArray(items) ? items : []
    const total = list.length
    const done = list.filter((item) => !!(item && item.done)).length
    const completionRate = total > 0 ? Number(((done / total) * 100).toFixed(1)) : 0
    return {
      total,
      done,
      completionRate
    }
  },

  refreshProgressByCurrentPlan() {
    try {
      const data = workoutStore.getWorkoutBootstrap()
      this.setData({
        progress: workoutBiz.calculateWeeklyCompletion(data.sessions || [], this.data.plan),
        templateProgress: this.calculateTemplateProgress(this.data.plan.items)
      })
    } catch (error) {
      // ignore temporary compute errors
    }
  },

  onInput(e) {
    const field = e.currentTarget.dataset.field
    const value = e.detail.value
    this.setData({ [`plan.${field}`]: value })
    this.refreshProgressByCurrentPlan()
  },

  onWeekStartDateChange(e) {
    this.setData({
      'plan.weekStartDate': e.detail.value
    })
    this.refreshProgressByCurrentPlan()
  },

  onTargetQuickSelect(e) {
    const days = Number(e.currentTarget.dataset.days)
    if (!(days > 0)) return
    this.setData({
      'plan.weeklyTargetDays': days
    })
    this.refreshProgressByCurrentPlan()
  },

  onTemplateWeekdaySelect(e) {
    const key = String(e.currentTarget.dataset.key || '')
    if (!key) return
    this.setData({ draftTemplateWeekday: key })
  },

  onTemplateTypeSelect(e) {
    const value = String(e.currentTarget.dataset.value || '')
    if (!value) return
    this.setData({ draftTemplateType: value })
  },

  onAddTemplateItem() {
    const weekdayKey = this.data.draftTemplateWeekday
    const type = this.data.draftTemplateType
    const weekday = (this.data.weekdayOptions || []).find((item) => item.key === weekdayKey)
    if (!weekday || !type) {
      wx.showToast({ title: '请选择模板信息', icon: 'none' })
      return
    }

    const nextItem = {
      id: `PT${Date.now()}${Math.floor(Math.random() * 1000)}`,
      weekdayKey,
      weekdayLabel: weekday.label,
      type,
      done: false
    }

    const items = Array.isArray(this.data.plan.items) ? this.data.plan.items : []
    this.setData({
      'plan.items': [...items, nextItem]
    })
    this.refreshProgressByCurrentPlan()
  },

  onToggleTemplateDone(e) {
    const id = String(e.currentTarget.dataset.id || '')
    if (!id) return
    const items = Array.isArray(this.data.plan.items) ? this.data.plan.items : []
    const nextItems = items.map((item) => {
      if (String(item.id) !== id) return item
      return {
        ...item,
        done: !item.done
      }
    })
    this.setData({
      'plan.items': nextItems
    })
    this.refreshProgressByCurrentPlan()
  },

  onDeleteTemplateItem(e) {
    const id = String(e.currentTarget.dataset.id || '')
    if (!id) return
    const items = Array.isArray(this.data.plan.items) ? this.data.plan.items : []
    const nextItems = items.filter((item) => String(item.id) !== id)
    this.setData({
      'plan.items': nextItems
    })
    this.refreshProgressByCurrentPlan()
  },

  async onSave() {
    await workoutStore.upsertPlan(this.data.plan)
    wx.showToast({ title: '计划已保存', icon: 'success' })
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
