const storage = require('../../utils/storage')

Page({
  data: {
    notFound: false,
    inviteCode: '',
    ownerName: '',
    weddingDate: '',
    weddingLocation: '',
    inviteMessage: '',
    taskProgressText: '已完成 0/0 项',
    taskProgressPercent: 0,
    countdownText: '',
    guestName: ''
  },

  async onLoad(options) {
    const code = options && options.code ? String(options.code) : ''
    if (!code) {
      this.setData({ notFound: true })
      return
    }

    const viewData = await storage.getWeddingGuestViewByCodeAsync(code)
    if (!viewData) {
      this.setData({ notFound: true })
      return
    }

    const total = Number(viewData.totalTasks) || 0
    const completed = Number(viewData.completedTasks) || 0
    const percent = total > 0 ? Math.round((completed / total) * 100) : 0

    this.setData({
      notFound: false,
      inviteCode: viewData.inviteCode,
      ownerName: viewData.ownerName,
      weddingDate: viewData.weddingDate,
      weddingLocation: viewData.weddingLocation,
      inviteMessage: viewData.inviteMessage,
      taskProgressText: `备婚进度 ${completed}/${total}`,
      taskProgressPercent: percent,
      countdownText: this.buildCountdownText(viewData.weddingDate)
    })
  },

  onGuestNameInput(e) {
    this.setData({ guestName: e.detail.value })
  },

  async onConfirmAttendance() {
    const result = await storage.confirmWeddingGuestAttendanceByCodeAsync(this.data.inviteCode, this.data.guestName)
    if (!result.success) {
      wx.showToast({ title: result.message || '提交失败', icon: 'none' })
      return
    }

    wx.showToast({ title: '已确认出席', icon: 'success' })
    this.setData({ guestName: '' })
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
