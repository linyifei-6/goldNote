const storage = require('../../utils/storage')
const auth = require('../../utils/auth')

const INVITEE_STATUS = ['未确认', '已确认']
const TASK_TYPES = ['婚纱摄影', '婚宴酒店', '婚礼策划', '婚礼服务', '婚礼节点', '婚品物料', '婚房装修', '其他']
const TASK_STATUS_FILTERS = ['全部', '未完成', '已完成', '已逾期', '今日截止', '3天内截止']
const TASK_SORT_OPTIONS = ['自定义排序', '截止日期', '任务类型', '创建时间', '优先级']
const TENCENT_MAP_KEY = '请替换为你的腾讯地图Key'
const TENCENT_GEOCODER_URL = 'https://apis.map.qq.com/ws/geocoder/v1/'

function getTencentMapKey() {
  try {
    const key = wx.getStorageSync('tencentMapKey')
    if (key && typeof key === 'string' && key.trim()) {
      return key.trim()
    }
  } catch (error) {
    console.warn('读取腾讯地图Key失败', error)
  }

  return (TENCENT_MAP_KEY || '').trim()
}

function normalizeCityName(city) {
  const text = String(city || '').trim()
  if (!text) {
    return ''
  }

  if (/市$/.test(text)) {
    return text
  }

  return `${text}市`
}

Page({
  data: {
    user: null,
    priorityLevels: [1, 2, 3, 4, 5],
    basicInfoDirty: false,
    today: '',
    weddingDate: '',
    weddingLocation: '',
    totalBudgetInput: '',
    countdownText: '未设置婚期',
    showBasicInfoEditor: true,
    activeSection: 'budget',
    sectionTabs: [
      {
        key: 'task',
        label: '备婚任务',
        icon: '/images/倒计时.png',
        activeIcon: '/images/倒计时-active.png'
      },
      {
        key: 'budget',
        label: '预算管理',
        icon: '/images/预算管理.png',
        activeIcon: '/images/预算管理-active.png'
      },
      {
        key: 'friends',
        label: '亲友',
        icon: '/images/亲友圈.png',
        activeIcon: '/images/亲友圈-active.png'
      }
    ],
    taskTypeOptions: TASK_TYPES,
    taskTypeIndex: 0,
    taskPriorityIndex: 2,
    taskCustomType: '',
    taskQuickTypeOptions: ['全部', '婚纱摄影', '婚宴酒店', '婚礼策划', '婚礼服务', '婚礼节点', '婚品物料', '婚房装修'],
    taskQuickTypeActive: '全部',
    taskQuickStatusOptions: ['全部', '未完成', '已逾期', '今日截止'],
    taskQuickStatusActive: '全部',
    taskSortOptions: TASK_SORT_OPTIONS,
    taskSortIndex: 0,
    selectingMode: false,
    selectedTaskIds: [],
    budgetTypeOptions: ['全部', ...TASK_TYPES],
    budgetTypeIndex: 0,
    taskProgressText: '已完成 0/0 项',
    taskProgressPercent: 0,
    taskTitle: '',
    taskDueDate: '',
    taskBudgetInput: '',
    taskActualInput: '',
    tasks: [],
    filteredTasks: [],
    budgetTaskList: [],
    filteredBudgetTaskList: [],
    taskCostTotal: 0,
    taskCostTotalText: '0.00',
    taskBudgetTotal: 0,
    taskBudgetTotalText: '0.00',
    taskEditVisible: false,
    taskEditForm: {
      id: '',
      title: '',
      typeIndex: 4,
      customType: '',
      priorityIndex: 2,
      dueDate: '',
      note: '',
      budgetAmount: '',
      actualAmount: ''
    },
    taskDetailVisible: false,
    taskDetail: null,
    taskDetailNote: '',
    taskDetailBudgetText: '0.00',
    taskDetailActualText: '0.00',
    undoDeleteVisible: false,
    undoDeleteText: '',
    dueSoonModalVisible: false,
    dueSoonList: [],
    dueSoonMoreCount: 0,
    expenseCategory: '',
    expenseAmount: '',
    expenseDate: '',
    expenses: [],
    spentBudget: 0,
    remainingBudget: 0,
    spentBudgetText: '0.00',
    remainingBudgetText: '0.00',
    inviteMessage: '',
    inviteLink: '',
    inviteeName: '',
    inviteeStatusIndex: 0,
    inviteeStatusOptions: INVITEE_STATUS,
    invitees: [],
    inviteStats: {
      confirmed: 0,
      unconfirmed: 0
    }
  },

  onLoad() {
    const today = new Date().toISOString().split('T')[0]
    this.setData({
      today,
      taskDueDate: today,
      expenseDate: today
    })
  },

  async onShow() {
    const user = auth.ensureLogin()
    if (!user) return

    const preserveBasicInfoDraft = this.data.showBasicInfoEditor && this.data.basicInfoDirty

    this.setData({ user })
    await storage.syncWeddingDataFromCloud(user.id)
    this.loadAllData({ preserveBasicInfoDraft })
  },

  onUnload() {
    if (this.undoDeleteTimer) {
      clearTimeout(this.undoDeleteTimer)
      this.undoDeleteTimer = null
    }
  },

  loadAllData(options = {}) {
    this.loadWeddingProfile(!!options.preserveBasicInfoDraft)
    this.loadTasks()
    this.loadExpenses()
    this.loadInviteData()
    this.showDueSoonReminder()
  },

  showDueSoonReminder() {
    const today = this.data.today
    const dueSoon = (this.data.tasks || [])
      .filter(item => !item.checked && item.dueDate)
      .map(item => {
        const diffDays = this.diffDays(today, item.dueDate)
        return {
          ...item,
          diffDays
        }
      })
      .filter(item => item.diffDays >= 0 && item.diffDays <= 10)
      .sort((a, b) => a.diffDays - b.diffDays)

    if (dueSoon.length === 0) {
      return
    }

    const list = dueSoon.slice(0, 6).map((item, index) => ({
      no: index + 1,
      title: item.title,
      dayText: item.diffDays === 0 ? '今天截止' : `${item.diffDays}天后截止`
    }))

    this.setData({
      dueSoonModalVisible: true,
      dueSoonList: list,
      dueSoonMoreCount: Math.max(0, dueSoon.length - list.length)
    })
  },

  onCloseDueSoonModal() {
    this.setData({
      dueSoonModalVisible: false,
      dueSoonList: [],
      dueSoonMoreCount: 0,
      activeSection: 'task'
    })
  },

  loadWeddingProfile(preserveBasicInfoDraft) {
    if (preserveBasicInfoDraft) {
      this.updateCountdown(this.data.weddingDate)
      this.updateBudgetSummary()
      return
    }

    const profile = storage.getWeddingProfile()
    const fallbackSaved = !!(profile.weddingDate || profile.location || (profile.totalBudget > 0))
    const hasSaved = profile.hasSaved || fallbackSaved
    this.setData({
      weddingDate: profile.weddingDate || '',
      weddingLocation: profile.location || '',
      totalBudgetInput: profile.totalBudget > 0 ? String(profile.totalBudget) : '',
      showBasicInfoEditor: !hasSaved,
      basicInfoDirty: false
    })
    this.updateCountdown(profile.weddingDate)
    this.updateBudgetSummary(profile.totalBudget)
  },

  loadTasks() {
    const today = this.data.today
    const tasks = storage.getWeddingTasks().map(item => {
      const statusMeta = this.buildTaskStatus(item, today)
      return {
        ...item,
        ...statusMeta,
        priorityStars: this.toPriorityStars(item.priority)
      }
    })

    const total = tasks.length
    const completed = tasks.filter(item => item.checked).length
    const percent = total > 0 ? Math.round((completed / total) * 100) : 0
    const budgetTaskList = tasks.map(item => ({
      ...item,
      budgetAmountText: (Number(item.budgetAmount) || 0).toFixed(2),
      actualAmountText: (Number(item.actualAmount) || 0).toFixed(2),
      priorityStars: this.toPriorityStars(item.priority)
    }))
    const taskBudgetTotal = budgetTaskList.reduce((sum, item) => sum + (Number(item.budgetAmount) || 0), 0)
    const taskCostTotal = budgetTaskList.reduce((sum, item) => sum + (Number(item.actualAmount) || 0), 0)

    this.setData({
      tasks,
      budgetTaskList,
      taskCostTotal,
      taskCostTotalText: taskCostTotal.toFixed(2),
      taskBudgetTotal,
      taskBudgetTotalText: taskBudgetTotal.toFixed(2)
    })

    this.applyTaskFilters()
    this.applyBudgetTaskFilter()
    this.setData({
      taskProgressText: `已完成 ${completed}/${total} 项`,
      taskProgressPercent: percent
    })
    this.updateBudgetSummary()
  },

  toPriorityStars(priority) {
    const level = Math.max(1, Math.min(5, parseInt(priority, 10) || 3))
    return `${'★'.repeat(level)}${'☆'.repeat(5 - level)}`
  },

  buildTaskStatus(task, today) {
    if (task.checked) {
      return {
        statusTag: '已完成',
        statusClass: 'done'
      }
    }

    if (!task.dueDate) {
      return {
        statusTag: '未设置',
        statusClass: 'normal'
      }
    }

    const diff = this.diffDays(today, task.dueDate)
    if (diff < 0) {
      return {
        statusTag: '已逾期',
        statusClass: 'overdue'
      }
    }
    if (diff === 0) {
      return {
        statusTag: '今日截止',
        statusClass: 'today'
      }
    }
    if (diff <= 3) {
      return {
        statusTag: '3天内截止',
        statusClass: 'soon'
      }
    }

    return {
      statusTag: '进行中',
      statusClass: 'normal'
    }
  },

  diffDays(fromDate, toDate) {
    const from = new Date(`${fromDate}T00:00:00`)
    const to = new Date(`${toDate}T00:00:00`)
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      return 9999
    }
    return Math.floor((to.getTime() - from.getTime()) / 86400000)
  },

  applyTaskFilters() {
    const selectedType = this.data.taskQuickTypeActive
    const selectedStatus = this.data.taskQuickStatusActive
    const selectedIdsSet = new Set(this.data.selectedTaskIds || [])

    let filteredTasks = (this.data.tasks || []).filter(item => {
      const matchType = selectedType === '全部' || item.type === selectedType
      let matchStatus = true

      if (selectedStatus === '未完成') {
        matchStatus = !item.checked
      } else if (selectedStatus === '已完成') {
        matchStatus = item.checked
      } else if (selectedStatus !== '全部') {
        matchStatus = item.statusTag === selectedStatus
      }

      return matchType && matchStatus
    })

    filteredTasks = this.sortTasks(filteredTasks, this.data.taskSortIndex)
      .map(item => ({
        ...item,
        selected: selectedIdsSet.has(item.id)
      }))

    this.setData({ filteredTasks })
  },

  sortTasks(list, sortIndex) {
    const items = [...(list || [])]
    if (sortIndex === 1) {
      return items.sort((a, b) => {
        if (!a.dueDate && !b.dueDate) return 0
        if (!a.dueDate) return 1
        if (!b.dueDate) return -1
        return a.dueDate > b.dueDate ? 1 : -1
      })
    }

    if (sortIndex === 2) {
      return items.sort((a, b) => {
        if (a.type === b.type) {
          return (a.sortOrder || 0) - (b.sortOrder || 0)
        }
        return a.type > b.type ? 1 : -1
      })
    }

    if (sortIndex === 3) {
      return items.sort((a, b) => {
        const left = a.createdAt || ''
        const right = b.createdAt || ''
        if (left === right) return 0
        return left < right ? 1 : -1
      })
    }

    if (sortIndex === 4) {
      return items.sort((a, b) => {
        const left = parseInt(a.priority, 10) || 3
        const right = parseInt(b.priority, 10) || 3
        if (left === right) {
          return (a.sortOrder || 0) - (b.sortOrder || 0)
        }
        return right - left
      })
    }

    return items.sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0))
  },

  onQuickTypeFilterTap(e) {
    const value = e.currentTarget.dataset.value
    if (!value || value === this.data.taskQuickTypeActive) {
      return
    }
    this.setData({ taskQuickTypeActive: value })
    this.applyTaskFilters()
  },

  onQuickStatusFilterTap(e) {
    const value = e.currentTarget.dataset.value
    if (!value || value === this.data.taskQuickStatusActive) {
      return
    }
    this.setData({ taskQuickStatusActive: value })
    this.applyTaskFilters()
  },

  onTaskSortTap(e) {
    const taskSortIndex = parseInt(e.currentTarget.dataset.index, 10)
    if (Number.isNaN(taskSortIndex)) return
    this.setData({ taskSortIndex })
    this.applyTaskFilters()
  },

  onToggleSelectingMode() {
    const next = !this.data.selectingMode
    this.setData({
      selectingMode: next,
      selectedTaskIds: []
    })
    this.applyTaskFilters()
  },

  onToggleTaskSelect(e) {
    const id = e.currentTarget.dataset.id
    const set = new Set(this.data.selectedTaskIds || [])
    if (set.has(id)) {
      set.delete(id)
    } else {
      set.add(id)
    }

    this.setData({ selectedTaskIds: [...set] })
    this.applyTaskFilters()
  },

  onBatchCompleteTasks() {
    const ids = this.data.selectedTaskIds || []
    if (ids.length === 0) {
      wx.showToast({ title: '请先选择任务', icon: 'none' })
      return
    }

    ids.forEach(id => {
      storage.toggleWeddingTask(id, true)
    })

    wx.showToast({ title: `已完成${ids.length}项`, icon: 'success' })
    this.setData({ selectedTaskIds: [] })
    this.loadTasks()
  },

  onBatchDeleteTasks() {
    const ids = this.data.selectedTaskIds || []
    if (ids.length === 0) {
      wx.showToast({ title: '请先选择任务', icon: 'none' })
      return
    }

    wx.showModal({
      title: '批量删除',
      content: `确定删除已选 ${ids.length} 项任务吗？`,
      success: (res) => {
        if (!res.confirm) return
        ids.forEach(id => {
          storage.deleteWeddingTask(id)
        })
        this.setData({ selectedTaskIds: [] })
        this.loadTasks()
        wx.showToast({ title: '批量删除完成', icon: 'success' })
      }
    })
  },

  applyBudgetTaskFilter() {
    const selected = this.data.budgetTypeOptions[this.data.budgetTypeIndex]
    const filteredBudgetTaskList = (this.data.budgetTaskList || []).filter(item => {
      return selected === '全部' || item.type === selected
    })
    this.setData({ filteredBudgetTaskList })
  },

  onBudgetTypeTap(e) {
    const budgetTypeIndex = parseInt(e.currentTarget.dataset.index, 10)
    if (Number.isNaN(budgetTypeIndex)) return
    this.setData({ budgetTypeIndex })
    this.applyBudgetTaskFilter()
  },

  loadExpenses() {
    const expenses = storage.getWeddingExpenses().map(item => ({
      ...item,
      amountText: (Number(item.amount) || 0).toFixed(2)
    }))
    const spentBudget = expenses.reduce((sum, item) => sum + (Number(item.amount) || 0), 0)
    this.setData({
      expenses,
      spentBudget,
      spentBudgetText: spentBudget.toFixed(2)
    })
    this.updateBudgetSummary()
  },

  loadInviteData() {
    const invite = storage.getWeddingInvite()
    const inviteLink = `/pages/weddingGuest/weddingGuest?code=${invite.linkCode}`
    const confirmed = invite.invitees.filter(item => item.status === '已确认').length
    const unconfirmed = invite.invitees.length - confirmed

    this.setData({
      inviteMessage: invite.message,
      inviteLink,
      invitees: invite.invitees,
      inviteStats: {
        confirmed,
        unconfirmed
      }
    })
  },

  updateBudgetSummary(profileBudget) {
    const budget = typeof profileBudget === 'number'
      ? profileBudget
      : parseFloat(this.data.totalBudgetInput) || 0
    const totalSpent = (this.data.spentBudget || 0) + (this.data.taskCostTotal || 0)
    const remainingBudget = budget - totalSpent

    this.setData({
      remainingBudget,
      remainingBudgetText: remainingBudget.toFixed(2)
    })
  },

  updateCountdown(weddingDate) {
    if (!weddingDate) {
      this.setData({ countdownText: '未设置婚期' })
      return
    }

    const target = new Date(`${weddingDate}T00:00:00`)
    const now = new Date(`${this.data.today}T00:00:00`)
    const days = Math.floor((target.getTime() - now.getTime()) / 86400000)

    if (Number.isNaN(days)) {
      this.setData({ countdownText: '婚期格式异常' })
      return
    }
    if (days >= 0) {
      this.setData({ countdownText: `剩余 ${days} 天` })
      return
    }

    this.setData({ countdownText: `已过 ${Math.abs(days)} 天` })
  },

  onWeddingDateChange(e) {
    this.setData({
      weddingDate: e.detail.value,
      basicInfoDirty: true
    })
  },

  onLocationInput(e) {
    this.setData({
      weddingLocation: e.detail.value,
      basicInfoDirty: true
    })
  },

  onUseCurrentLocation() {
    wx.showLoading({ title: '定位中' })

    let locationCache = null
    this.ensureLocationPermission()
      .then(() => this.getCurrentLocation())
      .then((loc) => {
        locationCache = loc
        const latitude = Number(loc.latitude || 0)
        const longitude = Number(loc.longitude || 0)
        return this.reverseGeocodeByTencent(latitude, longitude)
      })
      .catch(() => this.chooseLocationCity(locationCache))
      .then((locationText) => {
        this.setData({
          weddingLocation: locationText,
          basicInfoDirty: true
        })
        wx.showToast({ title: '已获取当前位置', icon: 'success' })
      })
      .catch((error) => {
        const msg = error && error.message ? error.message : '定位失败，请重试'
        wx.showToast({ title: msg, icon: 'none' })
      })
      .finally(() => {
        wx.hideLoading()
      })
  },

  ensureLocationPermission() {
    return new Promise((resolve, reject) => {
      wx.getSetting({
        success: (res) => {
          const state = res.authSetting && res.authSetting['scope.userLocation']

          if (state === true) {
            resolve()
            return
          }

          if (state === undefined) {
            wx.authorize({
              scope: 'scope.userLocation',
              success: () => resolve(),
              fail: () => reject(new Error('未授权定位权限'))
            })
            return
          }

          wx.showModal({
            title: '需要定位权限',
            content: '请开启定位权限以获取当前位置作为婚礼地点',
            success: (modalRes) => {
              if (!modalRes.confirm) {
                reject(new Error('已取消授权'))
                return
              }

              wx.openSetting({
                success: (settingRes) => {
                  const granted = settingRes.authSetting && settingRes.authSetting['scope.userLocation']
                  if (granted) {
                    resolve()
                    return
                  }
                  reject(new Error('未开启定位权限'))
                },
                fail: () => reject(new Error('打开设置失败'))
              })
            },
            fail: () => reject(new Error('授权流程失败'))
          })
        },
        fail: () => reject(new Error('读取授权状态失败'))
      })
    })
  },

  getCurrentLocation() {
    return new Promise((resolve, reject) => {
      wx.getLocation({
        type: 'gcj02',
        success: (res) => resolve(res),
        fail: () => reject(new Error('获取当前位置失败'))
      })
    })
  },

  reverseGeocodeByTencent(latitude, longitude) {
    return new Promise((resolve, reject) => {
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
        reject(new Error('定位坐标异常'))
        return
      }

      const mapKey = getTencentMapKey()
      if (!mapKey || mapKey.includes('请替换')) {
        reject(new Error('请先配置腾讯地图Key'))
        return
      }

      wx.request({
        url: TENCENT_GEOCODER_URL,
        method: 'GET',
        data: {
          location: `${latitude},${longitude}`,
          key: mapKey,
          get_poi: 1
        },
        success: (res) => {
          const payload = res.data || {}
          if (payload.status !== 0) {
            reject(new Error(payload.message || '地址解析失败'))
            return
          }

          const result = payload.result || {}
          const adInfo = result.ad_info || {}
          const city = normalizeCityName(adInfo.city)
          const district = String(adInfo.district || '').trim()
          const locationText = city || district || normalizeCityName(result.address_component && result.address_component.city)

          if (!locationText) {
            reject(new Error('未获取到可读地址'))
            return
          }

          resolve(locationText)
        },
        fail: () => reject(new Error('腾讯地图服务请求失败'))
      })
    })
  },

  chooseLocationCity(loc) {
    return new Promise((resolve, reject) => {
      const latitude = Number(loc && loc.latitude)
      const longitude = Number(loc && loc.longitude)

      wx.chooseLocation({
        latitude: Number.isFinite(latitude) ? latitude : undefined,
        longitude: Number.isFinite(longitude) ? longitude : undefined,
        success: (res) => {
          const rawText = `${res.address || ''}${res.name || ''}`
          const city = this.extractCityFromText(rawText)
          if (city) {
            resolve(city)
            return
          }

          const fallback = String(res.name || res.address || '').trim()
          if (fallback) {
            resolve(fallback)
            return
          }

          reject(new Error('未获取到当前位置'))
        },
        fail: () => {
          reject(new Error('定位失败，请开启腾讯地图Key或手动输入城市'))
        }
      })
    })
  },

  extractCityFromText(text) {
    const raw = String(text || '')
    if (!raw) {
      return ''
    }

    const cityMatch = raw.match(/([\u4e00-\u9fa5]{2,}(?:自治州|地区|盟|市))/)
    if (cityMatch && cityMatch[1]) {
      return cityMatch[1]
    }

    const districtMatch = raw.match(/([\u4e00-\u9fa5]{2,}区)/)
    return districtMatch && districtMatch[1] ? districtMatch[1] : ''
  },

  onTotalBudgetInput(e) {
    this.setData({
      totalBudgetInput: e.detail.value,
      basicInfoDirty: true
    })
  },

  onSaveBasicInfo() {
    const profile = storage.saveWeddingProfile({
      weddingDate: this.data.weddingDate,
      location: this.data.weddingLocation,
      totalBudget: this.data.totalBudgetInput
    })

    this.setData({
      weddingDate: profile.weddingDate,
      weddingLocation: profile.location,
      totalBudgetInput: profile.totalBudget > 0 ? String(profile.totalBudget) : '',
      showBasicInfoEditor: false,
      basicInfoDirty: false
    })
    this.updateCountdown(profile.weddingDate)
    this.updateBudgetSummary(profile.totalBudget)
    wx.showToast({ title: '基础信息已保存', icon: 'success' })
  },

  onToggleBasicInfoEditor() {
    this.setData({
      showBasicInfoEditor: !this.data.showBasicInfoEditor
    })
  },

  onSwitchSection(e) {
    const section = e.currentTarget.dataset.section
    if (!section || section === this.data.activeSection) {
      return
    }
    this.setData({ activeSection: section })
  },

  onUserActions() {
    wx.showActionSheet({
      itemList: ['退出登录', '清除全部备婚数据'],
      success: (res) => {
        if (res.tapIndex === 0) {
          this.onLogout()
          return
        }

        if (res.tapIndex === 1) {
          this.onClearWeddingAllData()
        }
      }
    })
  },

  onClearWeddingAllData() {
    wx.showModal({
      title: '警示',
      content: '确定要清除当前账号的全部备婚数据吗？此操作不可恢复。',
      success: (res) => {
        if (!res.confirm) {
          return
        }

        const result = storage.clearWeddingAllData()
        if (!result.success) {
          wx.showToast({ title: result.message || '清空失败', icon: 'none' })
          return
        }

        this.loadAllData()
        this.setData({
          activeSection: 'task',
          showBasicInfoEditor: true,
          basicInfoDirty: false
        })
        wx.showToast({ title: '备婚数据已清空', icon: 'success' })
      }
    })
  },

  onLogout() {
    wx.showModal({
      title: '退出登录',
      content: '确定要退出当前账号吗？',
      success: (res) => {
        if (res.confirm) {
          auth.logout()
          wx.reLaunch({ url: '/pages/login/login' })
        }
      }
    })
  },

  onTaskTitleInput(e) {
    this.setData({ taskTitle: e.detail.value })
  },

  onTaskDateChange(e) {
    this.setData({ taskDueDate: e.detail.value })
  },

  onTaskTypeTap(e) {
    const taskTypeIndex = parseInt(e.currentTarget.dataset.index, 10)
    if (Number.isNaN(taskTypeIndex)) return
    this.setData({ taskTypeIndex })
  },

  onTaskCustomTypeInput(e) {
    this.setData({ taskCustomType: e.detail.value })
  },

  onTaskPriorityTap(e) {
    const taskPriorityIndex = parseInt(e.currentTarget.dataset.index, 10)
    if (Number.isNaN(taskPriorityIndex)) return
    this.setData({ taskPriorityIndex })
  },

  onTaskBudgetInput(e) {
    this.setData({ taskBudgetInput: e.detail.value })
  },

  onTaskActualInput(e) {
    this.setData({ taskActualInput: e.detail.value })
  },

  resolveCreateTaskType() {
    const picked = this.data.taskTypeOptions[this.data.taskTypeIndex]
    if (picked !== '其他') {
      return picked
    }
    return String(this.data.taskCustomType || '').trim().slice(0, 20) || '其他'
  },

  onAddTask() {
    const result = storage.createWeddingTask({
      title: this.data.taskTitle,
      type: this.resolveCreateTaskType(),
      priority: this.data.taskPriorityIndex + 1,
      dueDate: this.data.taskDueDate,
      budgetAmount: this.data.taskBudgetInput,
      actualAmount: this.data.taskActualInput
    })

    if (!result.success) {
      wx.showToast({ title: result.message || '新增任务失败', icon: 'none' })
      return
    }

    this.setData({
      taskTitle: '',
      taskPriorityIndex: 2,
      taskBudgetInput: '',
      taskActualInput: '',
      taskCustomType: ''
    })
    this.loadTasks()
    wx.showToast({ title: '任务已添加', icon: 'success' })
  },

  onOpenTaskBudgetEdit(e) {
    const id = e.currentTarget.dataset.id
    this.openTaskEditor(id)
  },

  onOpenTaskEdit(e) {
    const id = e.currentTarget.dataset.id
    this.openTaskEditor(id)
  },

  openTaskEditor(id) {
    const target = this.data.tasks.find(item => item.id === id)
    if (!target) return

    const foundTypeIndex = this.data.taskTypeOptions.indexOf(target.type || '其他')
    const customTypeIndex = this.data.taskTypeOptions.indexOf('其他')
    const typeIndex = foundTypeIndex >= 0 ? foundTypeIndex : customTypeIndex
    const customType = foundTypeIndex >= 0 ? '' : (target.type || '')
    const priorityIndex = Math.max(0, Math.min(4, (parseInt(target.priority, 10) || 3) - 1))
    this.setData({
      taskEditVisible: true,
      taskEditForm: {
        id: target.id,
        title: target.title,
        typeIndex,
        customType,
        priorityIndex,
        dueDate: target.dueDate || this.data.today,
        note: target.note || '',
        budgetAmount: (Number(target.budgetAmount) || 0).toFixed(2),
        actualAmount: (Number(target.actualAmount) || 0).toFixed(2)
      }
    })
  },

  onTaskEditTitleInput(e) {
    this.setData({
      'taskEditForm.title': e.detail.value
    })
  },

  onTaskEditTypeTap(e) {
    const typeIndex = parseInt(e.currentTarget.dataset.index, 10)
    if (Number.isNaN(typeIndex)) return
    this.setData({
      'taskEditForm.typeIndex': typeIndex
    })
  },

  onTaskEditCustomTypeInput(e) {
    this.setData({
      'taskEditForm.customType': e.detail.value
    })
  },

  onTaskEditPriorityTap(e) {
    const priorityIndex = parseInt(e.currentTarget.dataset.index, 10)
    if (Number.isNaN(priorityIndex)) return
    this.setData({
      'taskEditForm.priorityIndex': priorityIndex
    })
  },

  onTaskEditAmountInput(e) {
    this.setData({
      'taskEditForm.budgetAmount': e.detail.value
    })
  },

  onTaskEditActualAmountInput(e) {
    this.setData({
      'taskEditForm.actualAmount': e.detail.value
    })
  },

  resolveEditTaskType(form) {
    const picked = this.data.taskTypeOptions[form.typeIndex]
    if (picked !== '其他') {
      return picked
    }
    return String(form.customType || '').trim().slice(0, 20) || '其他'
  },

  onTaskEditNoteInput(e) {
    this.setData({
      'taskEditForm.note': e.detail.value
    })
  },

  onTaskEditDateChange(e) {
    this.setData({
      'taskEditForm.dueDate': e.detail.value
    })
  },

  onCancelTaskEdit() {
    this.setData({ taskEditVisible: false })
  },

  onSaveTaskEdit() {
    const form = this.data.taskEditForm
    const result = storage.updateWeddingTask(form.id, {
      title: form.title,
      type: this.resolveEditTaskType(form),
      priority: form.priorityIndex + 1,
      dueDate: form.dueDate,
      note: form.note,
      budgetAmount: form.budgetAmount,
      actualAmount: form.actualAmount
    })

    if (!result.success) {
      wx.showToast({ title: result.message || '保存失败', icon: 'none' })
      return
    }

    this.setData({ taskEditVisible: false })
    this.loadTasks()
    wx.showToast({ title: '任务已更新', icon: 'success' })
  },

  onToggleTask(e) {
    const { id, checked } = e.currentTarget.dataset
    const result = storage.toggleWeddingTask(id, !checked)
    if (!result.success) {
      wx.showToast({ title: result.message || '更新失败', icon: 'none' })
      return
    }
    this.loadTasks()
  },

  onDeleteTask(e) {
    const id = e.currentTarget.dataset.id
    const deletedTask = this.data.tasks.find(item => item.id === id)
    if (!deletedTask) {
      return
    }

    storage.deleteWeddingTask(id)
    this.loadTasks()

    if (this.undoDeleteTimer) {
      clearTimeout(this.undoDeleteTimer)
    }

    this.recentDeletedTask = deletedTask
    this.setData({
      undoDeleteVisible: true,
      undoDeleteText: `已删除：${deletedTask.title}`
    })

    this.undoDeleteTimer = setTimeout(() => {
      this.recentDeletedTask = null
      this.setData({
        undoDeleteVisible: false,
        undoDeleteText: ''
      })
    }, 3000)
  },

  onUndoDeleteTask() {
    if (!this.recentDeletedTask) {
      return
    }

    const result = storage.restoreWeddingTask(this.recentDeletedTask)
    if (!result.success) {
      wx.showToast({ title: result.message || '撤销失败', icon: 'none' })
      return
    }

    if (this.undoDeleteTimer) {
      clearTimeout(this.undoDeleteTimer)
      this.undoDeleteTimer = null
    }

    this.recentDeletedTask = null
    this.setData({
      undoDeleteVisible: false,
      undoDeleteText: ''
    })
    this.loadTasks()
    wx.showToast({ title: '已撤销删除', icon: 'success' })
  },

  onOpenTaskDetail(e) {
    const id = e.currentTarget.dataset.id
    const target = this.data.tasks.find(item => item.id === id)
    if (!target) {
      return
    }

    this.setData({
      taskDetailVisible: true,
      taskDetail: target,
      taskDetailNote: target.note || '',
      taskDetailBudgetText: (Number(target.budgetAmount) || 0).toFixed(2),
      taskDetailActualText: (Number(target.actualAmount) || 0).toFixed(2)
    })
  },

  onTaskDetailNoteInput(e) {
    this.setData({
      taskDetailNote: e.detail.value
    })
  },

  onSaveTaskDetail() {
    const detail = this.data.taskDetail
    if (!detail || !detail.id) {
      return
    }

    const result = storage.updateWeddingTask(detail.id, {
      title: detail.title,
      type: detail.type,
      priority: detail.priority,
      dueDate: detail.dueDate,
      note: this.data.taskDetailNote,
      budgetAmount: detail.budgetAmount,
      actualAmount: detail.actualAmount
    })

    if (!result.success) {
      wx.showToast({ title: result.message || '保存失败', icon: 'none' })
      return
    }

    this.setData({
      taskDetailVisible: false,
      taskDetail: null,
      taskDetailNote: '',
      taskDetailBudgetText: '0.00',
      taskDetailActualText: '0.00'
    })
    this.loadTasks()
    wx.showToast({ title: '详情已保存', icon: 'success' })
  },

  onCloseTaskDetail() {
    this.setData({
      taskDetailVisible: false,
      taskDetail: null,
      taskDetailNote: '',
      taskDetailBudgetText: '0.00',
      taskDetailActualText: '0.00'
    })
  },

  onExpenseCategoryInput(e) {
    this.setData({ expenseCategory: e.detail.value })
  },

  onExpenseAmountInput(e) {
    this.setData({ expenseAmount: e.detail.value })
  },

  onExpenseDateChange(e) {
    this.setData({ expenseDate: e.detail.value })
  },

  onAddExpense() {
    const result = storage.createWeddingExpense({
      category: this.data.expenseCategory,
      amount: this.data.expenseAmount,
      date: this.data.expenseDate
    })

    if (!result.success) {
      wx.showToast({ title: result.message || '新增支出失败', icon: 'none' })
      return
    }

    this.setData({
      expenseCategory: '',
      expenseAmount: ''
    })
    this.loadExpenses()
    wx.showToast({ title: '支出已记录', icon: 'success' })
  },

  onDeleteExpense(e) {
    const id = e.currentTarget.dataset.id
    storage.deleteWeddingExpense(id)
    this.loadExpenses()
    wx.showToast({ title: '支出已删除', icon: 'success' })
  },

  onInviteMessageInput(e) {
    this.setData({ inviteMessage: e.detail.value })
  },

  onSaveInviteMessage() {
    storage.updateWeddingInviteMessage(this.data.inviteMessage)
    this.loadInviteData()
    wx.showToast({ title: '邀请语已保存', icon: 'success' })
  },

  onRegenerateInviteLink() {
    storage.regenerateWeddingInviteLink()
    this.loadInviteData()
    wx.showToast({ title: '链接已更新', icon: 'success' })
  },

  onCopyInviteLink() {
    wx.setClipboardData({
      data: this.data.inviteLink,
      success: () => {
        wx.showToast({ title: '链接已复制', icon: 'success' })
      }
    })
  },

  onInviteeNameInput(e) {
    this.setData({ inviteeName: e.detail.value })
  },

  onInviteeStatusTap(e) {
    const inviteeStatusIndex = parseInt(e.currentTarget.dataset.index, 10)
    if (Number.isNaN(inviteeStatusIndex)) return
    this.setData({ inviteeStatusIndex })
  },

  onAddInvitee() {
    const result = storage.addWeddingInvitee(this.data.inviteeName)
    if (!result.success) {
      wx.showToast({ title: result.message || '新增失败', icon: 'none' })
      return
    }

    if (this.data.inviteeStatusOptions[this.data.inviteeStatusIndex] === '已确认') {
      storage.updateWeddingInviteeStatus(result.invitee.id, '已确认')
    }

    this.setData({
      inviteeName: '',
      inviteeStatusIndex: 0
    })
    this.loadInviteData()
    wx.showToast({ title: '亲友已添加', icon: 'success' })
  },

  onToggleInviteeStatus(e) {
    const { id, status } = e.currentTarget.dataset
    const nextStatus = status === '已确认' ? '未确认' : '已确认'
    storage.updateWeddingInviteeStatus(id, nextStatus)
    this.loadInviteData()
  },

  onDeleteInvitee(e) {
    const id = e.currentTarget.dataset.id
    storage.deleteWeddingInvitee(id)
    this.loadInviteData()
  },

  onPreviewGuestPage() {
    const code = String(this.data.inviteLink || '').split('code=')[1]
    if (!code) {
      wx.showToast({ title: '请先生成邀请链接', icon: 'none' })
      return
    }
    wx.navigateTo({ url: `/pages/weddingGuest/weddingGuest?code=${code}` })
  },

  onGoSelector() {
    wx.navigateBack({
      fail: () => {
        wx.redirectTo({ url: '/pages/portal/portal' })
      }
    })
  },

  onGoGold() {
    wx.switchTab({ url: '/pages/index/index' })
  }
})
