const storage = require('../../utils/storage')
const auth = require('../../utils/auth')

Page({
  data: {
    today: '',
    taskTitle: '',
    taskDueDate: '',
    tasks: [],
    draggingId: '',
    draggingHint: ''
  },

  onLoad() {
    const today = new Date().toISOString().split('T')[0]
    this.setData({
      today,
      taskDueDate: today
    })
  },

  async onShow() {
    const user = auth.ensureLogin()
    if (!user) return

    await storage.syncWeddingDataFromCloud(user.id)
    this.loadTasks()
  },

  loadTasks() {
    const tasks = storage.getWeddingTasks()
    this.setData({ tasks })
  },

  onTaskTitleInput(e) {
    this.setData({ taskTitle: e.detail.value })
  },

  onTaskDateChange(e) {
    this.setData({ taskDueDate: e.detail.value })
  },

  onAddTask() {
    const result = storage.createWeddingTask({
      title: this.data.taskTitle,
      dueDate: this.data.taskDueDate
    })

    if (!result.success) {
      wx.showToast({ title: result.message || '新增任务失败', icon: 'none' })
      return
    }

    this.setData({ taskTitle: '' })
    this.loadTasks()
    wx.showToast({ title: '任务已添加', icon: 'success' })
  },

  onToggleTask(e) {
    const { id, checked } = e.currentTarget.dataset
    if (this.data.draggingId) {
      return
    }
    const result = storage.toggleWeddingTask(id, !checked)
    if (!result.success) {
      wx.showToast({ title: result.message || '更新失败', icon: 'none' })
      return
    }
    this.loadTasks()
  },

  onDeleteTask(e) {
    const id = e.currentTarget.dataset.id
    storage.deleteWeddingTask(id)
    this.loadTasks()
    wx.showToast({ title: '任务已删除', icon: 'success' })
  },

  onStartDrag(e) {
    const id = e.currentTarget.dataset.id
    const item = this.data.tasks.find(task => task.id === id)
    if (!item) return

    this.setData({
      draggingId: id,
      draggingHint: `拖动中：${item.title}，点击目标任务完成排序`
    })
    wx.showToast({ title: '已进入拖动模式', icon: 'none' })
  },

  onDropToHere(e) {
    const targetId = e.currentTarget.dataset.id
    const draggingId = this.data.draggingId

    if (!draggingId || draggingId === targetId) {
      return
    }

    const list = [...this.data.tasks]
    const from = list.findIndex(item => item.id === draggingId)
    const to = list.findIndex(item => item.id === targetId)
    if (from < 0 || to < 0) {
      return
    }

    const [moved] = list.splice(from, 1)
    list.splice(to, 0, moved)

    const result = storage.reorderWeddingTasks(list.map(item => item.id))
    if (!result.success) {
      wx.showToast({ title: result.message || '排序失败', icon: 'none' })
      return
    }

    this.setData({
      draggingId: '',
      draggingHint: ''
    })
    this.loadTasks()
    wx.showToast({ title: '排序已更新', icon: 'success' })
  },

  onCancelDrag() {
    if (!this.data.draggingId) {
      return
    }

    this.setData({
      draggingId: '',
      draggingHint: ''
    })
  }
})
