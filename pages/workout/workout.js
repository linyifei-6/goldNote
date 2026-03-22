const workoutStore = require('../../utils/workoutStore')
const workoutBiz = require('../../utils/workout')

Page({
  data: {
    summary: {
      count: 0,
      totalMinutes: 0,
      totalCalories: 0,
      latestWeight: 0,
      weightDelta: 0,
      weeklyRate: 0
    },
    loading: false,
    cloudStatusText: '本地缓存可用'
  },

  onShow() {
    this.loadData()
  },

  async loadData() {
    this.setData({ loading: true })
    try {
      const local = workoutStore.getWorkoutBootstrap()
      this.applySummary(local)

      const cloud = await workoutStore.syncFromCloud().catch(() => null)
      if (cloud) {
        this.applySummary(cloud)
        this.setData({ cloudStatusText: '云端同步成功' })
      } else {
        this.setData({ cloudStatusText: '云端不可用，已使用本地缓存' })
      }
    } catch (error) {
      wx.showToast({ title: (error && error.message) || '读取失败', icon: 'none' })
    } finally {
      this.setData({ loading: false })
    }
  },

  applySummary(data) {
    const sessionsSummary = workoutBiz.summarizeSessions(data.sessions)
    const weightSummary = workoutBiz.summarizeWeights(data.weights)
    const activePlan = (Array.isArray(data.plans) && data.plans[0]) || {}
    const weekly = workoutBiz.calculateWeeklyCompletion(data.sessions, activePlan)

    this.setData({
      summary: {
        count: sessionsSummary.count,
        totalMinutes: sessionsSummary.totalMinutes,
        totalCalories: sessionsSummary.totalCalories,
        latestWeight: weightSummary.latestWeight,
        weightDelta: weightSummary.delta,
        weeklyRate: weekly.completionRate
      }
    })
  },

  onGoLog() {
    wx.navigateTo({ url: '/pages/workoutLog/workoutLog' })
  },

  onGoPlan() {
    wx.navigateTo({ url: '/pages/workoutPlan/workoutPlan' })
  },

  onGoStats() {
    wx.navigateTo({ url: '/pages/workoutStats/workoutStats' })
  },

  onGoWeight() {
    wx.navigateTo({ url: '/pages/workoutWeight/workoutWeight' })
  }
})
