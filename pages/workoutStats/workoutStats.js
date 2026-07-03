const workoutStore = require('../../utils/workoutStore')
const workoutBiz = require('../../utils/workout')
const storage = require('../../utils/storage')
const social = require('../../utils/social')
const chat = require('../../utils/chat')
const noteNav = require('../workout/noteNav')

Page({
  data: {
    currentSubTab: 'stats',
    workoutSubTabs: noteNav.WORKOUT_SUB_TABS,
    user: null,
    unreadMessageCount: 0,
    cloudStatusText: '本地缓存可用',
    workspaceRoleText: '个人模式',
    coupleSummary: {
      hasCouple: false,
      partnerName: ''
    },
    coupleModalVisible: false,
    coupleTargetUserId: '',
    coupleInviteUsers: [],
    coupleIncomingPending: [],
    coupleOutgoingPending: [],
    range: '30d',
    rangeOptions: [
      { key: '7d', label: '7天' },
      { key: '30d', label: '30天' },
      { key: 'all', label: '全部' }
    ],
    overview: {
      count: 0,
      totalMinutes: 0,
      totalCalories: 0,
      latestWeight: 0,
      weightDelta: 0,
      weeklyRate: 0
    },
    sessionsSummary: {
      count: 0,
      totalMinutes: 0,
      totalCalories: 0,
      topTypes: []
    },
    weightSummary: {
      count: 0,
      latestWeight: 0,
      delta: 0
    },
    chartHint: {
      line: '',
      bar: ''
    }
  },

  async onShow() {
    await this.refreshTopCard()
    await this.loadStats()
  },

  async refreshTopCard() {
    const user = storage.getCurrentUser()
    if (!user) {
      this.setData({
        user: null,
        unreadMessageCount: 0,
        workspaceRoleText: '个人模式',
        coupleSummary: {
          hasCouple: false,
          partnerName: ''
        }
      })
      return
    }

    let relationUnread = 0
    let chatUnread = 0
    let workspaceRoleText = '个人模式'
    let coupleSummary = {
      hasCouple: false,
      partnerName: ''
    }

    try {
      await social.syncRelationsFromCloud('wedding')
      const overview = social.getRelationOverview(user.id, { scene: 'wedding' })
      relationUnread = Array.isArray(overview.incomingPending) ? overview.incomingPending.length : 0
      const couple = (overview.couple || [])[0]
      if (couple && couple.partner && couple.partner.nickname) {
        workspaceRoleText = `情侣共管（${couple.partner.nickname}）`
        coupleSummary = {
          hasCouple: true,
          partnerName: String(couple.partner.nickname || '')
        }
      }
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
      unreadMessageCount: relationUnread + chatUnread,
      workspaceRoleText,
      coupleSummary
    })
  },

  async loadStats() {
    try {
      const local = workoutStore.getWorkoutBootstrap()
      this.applyByData(local, '本地缓存可用')

      const cloud = await workoutStore.syncFromCloud().catch(() => null)
      if (cloud) {
        this.applyByData(cloud, '云端同步成功')
      } else {
        this.setData({ cloudStatusText: '云端不可用，已使用本地缓存' })
      }
    } catch (error) {
      wx.showToast({ title: (error && error.message) || '读取失败', icon: 'none' })
    }
  },

  applyByData(data, cloudStatusText) {
    const range = this.data.range
    const sessions = this.filterByRange(data.sessions || [], 'workoutDate', range)
    const weights = this.filterByRange(data.weights || [], 'recordDate', range)
    const sessionsSummary = workoutBiz.summarizeSessions(sessions)
    const weightSummary = workoutBiz.summarizeWeights(weights)
    const activePlan = (Array.isArray(data.plans) && data.plans[0]) || {}
    const weekly = workoutBiz.calculateWeeklyCompletion(data.sessions || [], activePlan)

    this.setData({
      cloudStatusText,
      overview: {
        count: sessionsSummary.count,
        totalMinutes: sessionsSummary.totalMinutes,
        totalCalories: sessionsSummary.totalCalories,
        latestWeight: weightSummary.latestWeight,
        weightDelta: weightSummary.delta,
        weeklyRate: weekly.completionRate
      },
      sessionsSummary,
      weightSummary
    })

    this.drawCharts(weights, sessions)
  },

  buildWeightLineData(weights) {
    const list = (weights || [])
      .filter((item) => Number(item.weight) > 0)
      .sort((a, b) => String(a.recordDate || '').localeCompare(String(b.recordDate || '')))

    const maxPoints = 10
    if (list.length <= maxPoints) {
      return list.map((item) => ({
        label: String(item.recordDate || '').slice(5),
        value: Number(item.weight)
      }))
    }

    const step = Math.ceil(list.length / maxPoints)
    const sampled = []
    for (let index = 0; index < list.length; index += step) {
      sampled.push(list[index])
    }
    const last = list[list.length - 1]
    if (sampled[sampled.length - 1] !== last) {
      sampled.push(last)
    }

    return sampled.map((item) => ({
      label: String(item.recordDate || '').slice(5),
      value: Number(item.weight)
    }))
  },

  buildSessionBarData(sessions) {
    const byDate = {}
    ;(sessions || []).forEach((item) => {
      const date = String(item.workoutDate || '').trim()
      if (!date) return
      byDate[date] = (byDate[date] || 0) + (Number(item.durationMin) || 0)
    })

    const dates = Object.keys(byDate).sort()
    const recent = dates.slice(-7)
    return recent.map((date) => ({
      label: date.slice(5),
      value: byDate[date]
    }))
  },

  drawCharts(weights, sessions) {
    const lineData = this.buildWeightLineData(weights)
    const barData = this.buildSessionBarData(sessions)

    this.setData({
      chartHint: {
        line: lineData.length < 2 ? '体重记录不足，至少需要2条记录生成折线图' : '',
        bar: barData.length < 1 ? '暂无运动时长数据，无法生成柱状图' : ''
      }
    })

    wx.nextTick(() => {
      this.drawLineChart(lineData)
      this.drawBarChart(barData)
    })
  },

  drawLineChart(data) {
    const ctx = wx.createCanvasContext('weightTrendCanvas', this)
    const width = 660
    const height = 300
    const paddingLeft = 50
    const paddingRight = 20
    const paddingTop = 24
    const paddingBottom = 42

    ctx.clearRect(0, 0, width, height)
    ctx.setFillStyle('#ffffff')
    ctx.fillRect(0, 0, width, height)

    ctx.setStrokeStyle('#e2e8f0')
    ctx.setLineWidth(1)
    ctx.beginPath()
    ctx.moveTo(paddingLeft, height - paddingBottom)
    ctx.lineTo(width - paddingRight, height - paddingBottom)
    ctx.stroke()

    if (!data.length) {
      ctx.setFillStyle('#94a3b8')
      ctx.setFontSize(20)
      ctx.fillText('暂无数据', width / 2 - 36, height / 2)
      ctx.draw()
      return
    }

    const values = data.map((item) => item.value)
    const minValue = Math.min.apply(null, values)
    const maxValue = Math.max.apply(null, values)
    const span = Math.max(1, maxValue - minValue)
    const chartWidth = width - paddingLeft - paddingRight
    const chartHeight = height - paddingTop - paddingBottom

    ctx.setStrokeStyle('#10b981')
    ctx.setLineWidth(3)
    ctx.beginPath()

    data.forEach((point, index) => {
      const x = paddingLeft + (chartWidth * (data.length === 1 ? 0.5 : index / (data.length - 1)))
      const y = paddingTop + ((maxValue - point.value) / span) * chartHeight
      if (index === 0) {
        ctx.moveTo(x, y)
      } else {
        ctx.lineTo(x, y)
      }
    })
    ctx.stroke()

    data.forEach((point, index) => {
      const x = paddingLeft + (chartWidth * (data.length === 1 ? 0.5 : index / (data.length - 1)))
      const y = paddingTop + ((maxValue - point.value) / span) * chartHeight
      ctx.setFillStyle('#059669')
      ctx.beginPath()
      ctx.arc(x, y, 4, 0, Math.PI * 2)
      ctx.fill()

      ctx.setFillStyle('#64748b')
      ctx.setFontSize(16)
      ctx.fillText(point.label, x - 20, height - 16)
    })

    ctx.setFillStyle('#64748b')
    ctx.setFontSize(16)
    ctx.fillText(`min ${minValue.toFixed(1)}`, 6, height - paddingBottom)
    ctx.fillText(`max ${maxValue.toFixed(1)}`, 6, paddingTop + 8)
    ctx.draw()
  },

  drawBarChart(data) {
    const ctx = wx.createCanvasContext('sessionDurationCanvas', this)
    const width = 660
    const height = 300
    const paddingLeft = 42
    const paddingRight = 16
    const paddingTop = 24
    const paddingBottom = 44

    ctx.clearRect(0, 0, width, height)
    ctx.setFillStyle('#ffffff')
    ctx.fillRect(0, 0, width, height)

    ctx.setStrokeStyle('#e2e8f0')
    ctx.setLineWidth(1)
    ctx.beginPath()
    ctx.moveTo(paddingLeft, height - paddingBottom)
    ctx.lineTo(width - paddingRight, height - paddingBottom)
    ctx.stroke()

    if (!data.length) {
      ctx.setFillStyle('#94a3b8')
      ctx.setFontSize(20)
      ctx.fillText('暂无数据', width / 2 - 36, height / 2)
      ctx.draw()
      return
    }

    const maxValue = Math.max.apply(null, data.map((item) => Number(item.value) || 0)) || 1
    const chartWidth = width - paddingLeft - paddingRight
    const chartHeight = height - paddingTop - paddingBottom
    const gap = 14
    const barWidth = Math.max(16, (chartWidth - gap * (data.length + 1)) / data.length)

    data.forEach((item, index) => {
      const value = Number(item.value) || 0
      const h = (value / maxValue) * chartHeight
      const x = paddingLeft + gap + index * (barWidth + gap)
      const y = height - paddingBottom - h

      ctx.setFillStyle('#60a5fa')
      ctx.fillRect(x, y, barWidth, h)

      ctx.setFillStyle('#64748b')
      ctx.setFontSize(16)
      ctx.fillText(item.label, x, height - 16)
    })

    ctx.setFillStyle('#64748b')
    ctx.setFontSize(16)
    ctx.fillText(`max ${maxValue} min`, 6, paddingTop + 8)
    ctx.draw()
  },

  filterByRange(list, field, range) {
    if (range === 'all') return list

    const windowDays = range === '7d' ? 7 : 30
    const today = workoutStore.toBeijingDate()
    const base = new Date(`${today}T00:00:00Z`)
    base.setUTCDate(base.getUTCDate() - (windowDays - 1))
    const start = `${base.getUTCFullYear()}-${String(base.getUTCMonth() + 1).padStart(2, '0')}-${String(base.getUTCDate()).padStart(2, '0')}`

    return (list || []).filter((item) => {
      const date = String((item && item[field]) || '')
      return date && date >= start && date <= today
    })
  },

  onChangeRange(e) {
    const range = String(e.currentTarget.dataset.key || '')
    if (!range || range === this.data.range) return
    this.setData({ range }, () => {
      this.loadStats()
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

  onOpenCoupleManager() {
    const user = this.data.user
    if (!user) {
      wx.showToast({ title: '请先登录', icon: 'none' })
      return
    }

    const overview = social.getRelationOverview(user.id, { scene: 'wedding' })
    const following = overview.following || []
    const followers = overview.followers || []
    const existingIds = new Set()
    const inviteUsers = []
    following.forEach(f => {
      if (f.target && f.target.id && !existingIds.has(f.target.id)) {
        existingIds.add(f.target.id)
        inviteUsers.push({ id: f.target.id, nickname: f.target.nickname })
      }
    })
    followers.forEach(f => {
      if (f.follower && f.follower.id && !existingIds.has(f.follower.id)) {
        existingIds.add(f.follower.id)
        inviteUsers.push({ id: f.follower.id, nickname: f.follower.nickname })
      }
    })

    this.setData({
      coupleModalVisible: true,
      coupleTargetUserId: '',
      coupleInviteUsers: inviteUsers.slice(0, 5),
      coupleIncomingPending: (overview.incomingPending || []).filter((p) => p.type === 'couple'),
      coupleOutgoingPending: (overview.outgoingPending || []).filter((p) => p.type === 'couple')
    })
  },

  onCloseCoupleModal() {
    this.setData({ coupleModalVisible: false })
  },

  onCoupleTargetInput(e) {
    this.setData({ coupleTargetUserId: e.detail.value })
  },

  onPickCoupleTarget(e) {
    this.setData({ coupleTargetUserId: e.currentTarget.dataset.userId })
  },

  onInviteCouple() {
    const targetUserId = String(this.data.coupleTargetUserId || '').trim()
    if (!targetUserId) {
      wx.showToast({ title: '请输入对方的用户ID', icon: 'none' })
      return
    }

    const result = social.createRelationRequest('couple', targetUserId, { scene: 'wedding' })
    if (result.success) {
      wx.showToast({ title: '申请已发送', icon: 'success' })
      this.onOpenCoupleManager() // Refresh modal state
    } else {
      wx.showToast({ title: result.message || '操作失败', icon: 'none' })
    }
  },

  onCancelCoupleRequest(e) {
    const relationId = e.currentTarget.dataset.id
    const result = social.cancelRelationRequest(relationId, { scene: 'wedding' })
    if (result.success) {
      wx.showToast({ title: '已撤回申请', icon: 'success' })
      this.onOpenCoupleManager()
    } else {
      wx.showToast({ title: result.message || '操作失败', icon: 'none' })
    }
  },

  onAcceptCoupleRequest(e) {
    const relationId = e.currentTarget.dataset.id
    const result = social.acceptRelationRequest(relationId, { scene: 'wedding' })
    if (result.success) {
      wx.showToast({ title: '已绑定情侣关系', icon: 'success' })
      this.setData({ coupleModalVisible: false })
      this.refreshTopCard()
    } else {
      wx.showToast({ title: result.message || '操作失败', icon: 'none' })
    }
  },

  onRejectCoupleRequest(e) {
    const relationId = e.currentTarget.dataset.id
    const result = social.rejectRelationRequest(relationId, { scene: 'wedding' })
    if (result.success) {
      wx.showToast({ title: '已拒绝', icon: 'success' })
      this.onOpenCoupleManager()
    } else {
      wx.showToast({ title: result.message || '操作失败', icon: 'none' })
    }
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
