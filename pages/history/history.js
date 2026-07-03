const storage = require('../../utils/storage')
const auth = require('../../utils/auth')
const social = require('../../utils/social')
const chat = require('../../utils/chat')

Page({
  data: {
    user: null,
    quickQueryKey: 'today',
    quickTimeOptions: [
      { key: 'today', label: '今日' },
      { key: 'yesterday', label: '昨日' },
      { key: 'thisWeek', label: '本周' },
      { key: 'lastWeek', label: '上周' },
      { key: 'thisMonth', label: '本月' },
      { key: 'customRange', label: '时段' }
    ],
    quickTradeOptions: [
      { key: 'last10Buy', label: '最近10次买入' },
      { key: 'last10Tx', label: '最近10次交易' }
    ],
    today: '',
    startDate: '',
    endDate: '',
    showStats: false,
    buyStats: null,
    sellStats: null,
    queryResultTransactions: [],
    querySummary: '',
    querySelectedTxIds: [],
    querySelectedCount: 0,
    queryCustomStats: null,
    allTransactions: [],
    transactions: [],
    selectedTxIds: [],
    selectedCount: 0,
    customStats: null,
    platforms: storage.PLATFORMS,
    platformFilters: ['全部', ...storage.PLATFORMS],
    platformFilterIndex: 0,
    typeFilters: ['全部', '买入', '卖出'],
    typeFilterIndex: 0,
    editVisible: false,
    editForm: {
      id: '',
      type: 'buy',
      price: '',
      weight: '',
      date: '',
      platformIndex: 0,
      platformName: '',
      platformFeeRate: ''
    },
    showEditPlatformNameInput: false,
    showEditPlatformFeeInput: false,
    goldViewUsers: [],
    goldViewIndex: 0,
    goldViewUserId: '',
    goldViewTargetName: '',
    goldViewDisplayUser: null,
    isGoldReadOnly: false,
    profileModalVisible: false,
    profileNicknameDraft: '',
    profileSaving: false,
    unreadMessageCount: 0
  },

  onLoad() {
    const today = storage.getBeijingDateString()
    this.setData({
      today,
      startDate: today,
      endDate: today
    })
    this.refreshPage()
  },

  onShow() {
    this.refreshPage()
  },

  async refreshPage() {
    const user = auth.ensureLogin()
    if (!user) return

    if (user.isGuest) {
      this.setData({
        user,
        unreadMessageCount: 0
      })
      this.loadTransactions()
      return
    }

    // 同步云端关系后再读取视图状态，保证关注列表是最新的
    await social.syncRelationsFromCloud('gold')

    const viewState = social.getGoldViewState(user.id)
    const targetUserId = viewState.targetUserId || user.id

    this.setData({
      user,
      goldViewUsers: viewState.readableUsers || [],
      goldViewIndex: Math.max(0, (viewState.readableUsers || []).findIndex((item) => item && item.id === targetUserId)),
      goldViewUserId: targetUserId,
      goldViewTargetName: (viewState.targetUser && viewState.targetUser.nickname) || user.nickname,
      goldViewDisplayUser: viewState.targetUser || user,
      isGoldReadOnly: !!viewState.readOnly
    })

    const messageCenter = this.buildPendingMessageCenter(user.id)
    const chatUnreadCount = await chat.getUnreadCount('gold')
    this.setData({
      unreadMessageCount: messageCenter.count + chatUnreadCount
    })

    await storage.syncTransactionsFromCloud(targetUserId)
    this.loadTransactions()
  },

  onReturnToMyHome() {
    const user = this.data.user
    if (!user || !user.id) return
    social.setGoldViewTarget('', user.id)
    this.refreshPage()
  },

  onGoldViewChange(e) {
    const index = parseInt(e.detail.value, 10)
    const users = this.data.goldViewUsers || []
    const target = users[index]
    const targetUserId = target && target.id ? target.id : ''

    const result = social.setGoldViewTarget(targetUserId, this.data.user && this.data.user.id)
    if (!result.success) {
      wx.showToast({ title: result.message || '切换失败', icon: 'none' })
      return
    }

    this.refreshPage()
  },

  loadTransactions() {
    const viewUserId = this.data.goldViewUserId || (this.data.user && this.data.user.id)
    const allTransactions = storage.getTransactions(viewUserId)
      .sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1))
      .map((tx, index) => ({
        ...tx,
        displayTime: tx.timestamp || `${tx.date} 00:00:00`,
        displayNo: index + 1
      }))

    const platformOptions = this.getPlatformOptions(allTransactions)
    const platformFilters = ['全部', ...platformOptions]
    let platformFilterIndex = this.data.platformFilterIndex
    if (platformFilterIndex >= platformFilters.length) {
      platformFilterIndex = 0
    }

    this.setData({
      allTransactions,
      platforms: platformOptions,
      platformFilters,
      platformFilterIndex,
      selectedTxIds: [],
      selectedCount: 0,
      customStats: null
    })
    this.applyRecordFilters()
  },

  refreshQueryStats() {
    if (this.data.quickQueryKey === 'customRange') {
      this.calculateRangeStats()
      return
    }
    this.calculateTodayStats()
  },

  getPlatformOptions(transactions) {
    return storage.getPlatformOptions(this.data.goldViewUserId)
  },

  applyRecordFilters() {
    const {
      allTransactions,
      platformFilters,
      platformFilterIndex,
      typeFilters,
      typeFilterIndex
    } = this.data

    const selectedSet = new Set(this.data.selectedTxIds || [])
    const selectedPlatform = platformFilters[platformFilterIndex]
    const selectedType = typeFilters[typeFilterIndex]

    const transactions = (allTransactions || [])
      .filter(tx => {
        if (selectedPlatform === '全部') return true
        if (selectedPlatform === '自定义') {
          // 显示为“自定义”的项对应存储中的 '其他'（或空值）
          return String(tx.platform || '') === '其他' || !(String(tx.platform || '').trim())
        }
        return tx.platform === selectedPlatform
      })
      .filter(tx => selectedType === '全部' || (selectedType === '买入' ? tx.type === 'buy' : tx.type === 'sell'))
      .map(tx => ({
        ...tx,
        selected: selectedSet.has(tx.id)
      }))

    const selectedTxIds = transactions
      .filter(tx => tx.selected)
      .map(tx => tx.id)

    this.setData({
      transactions,
      selectedTxIds,
      selectedCount: selectedTxIds.length,
      customStats: null
    })

    this.refreshQueryStats()
  },

  onQuickQueryTap(e) {
    const quickQueryKey = String(e.currentTarget.dataset.key || '')
    if (!quickQueryKey) return
    this.setData({ quickQueryKey })
    if (quickQueryKey === 'customRange') {
      this.calculateRangeStats()
      return
    }
    this.calculateTodayStats()
  },

  onStartDateChange(e) {
    this.setData({
      startDate: e.detail.value,
      quickQueryKey: 'customRange'
    })
    this.calculateRangeStats()
  },

  onEndDateChange(e) {
    this.setData({
      endDate: e.detail.value,
      quickQueryKey: 'customRange'
    })
    this.calculateRangeStats()
  },

  calculateTodayStats() {
    const key = this.data.quickQueryKey || 'today'
    const source = Array.isArray(this.data.transactions) ? this.data.transactions : []
    let filteredTransactions = []
    let querySummary = ''

    if (key === 'last10Buy') {
      filteredTransactions = source.filter(tx => tx.type === 'buy').slice(0, 10)
      querySummary = '快速查询：最近10次买入'
    } else if (key === 'last10Tx') {
      filteredTransactions = source.slice(0, 10)
      querySummary = '快速查询：最近10次交易'
    } else if (key === 'customRange') {
      this.calculateRangeStats()
      return
    } else {
      const range = this.getQuickDateRange(key)
      filteredTransactions = storage.filterByDateRange(source, range.startDate, range.endDate)
      querySummary = `快速查询：${range.label}（${range.startDate} ~ ${range.endDate}）`
    }

    this.applyStatsResult(filteredTransactions, querySummary)
  },

  calculateRangeStats() {
    const { startDate, endDate, transactions } = this.data
    if (!startDate || !endDate) return

    const filteredTransactions = storage.filterByDateRange(transactions, startDate, endDate)
    const querySummary = `时段统计：${startDate} ~ ${endDate}`
    this.applyStatsResult(filteredTransactions, querySummary)
  },

  applyStatsResult(filteredTransactions, querySummary) {
    const list = Array.isArray(filteredTransactions) ? filteredTransactions : []
    const buyStats = storage.calculateAveragePrice(list, 'buy')
    const sellStats = storage.calculateAveragePrice(list, 'sell')

    // 计算本次统计的操作收益：有效交易克数 * 卖出均价 - 手续费
    const buyWeight = (buyStats && buyStats.totalWeight) || 0
    const sellWeight = (sellStats && sellStats.totalWeight) || 0
    const effectiveTradeWeight = Math.min(buyWeight, sellWeight)
    const sellAvgPrice = (sellStats && sellStats.avgPrice) || 0
    const buyAvgPrice = (buyStats && buyStats.avgPrice) || 0
    const sellFee = (sellStats && sellStats.totalFee) || 0
    const operationProfit = effectiveTradeWeight * (sellAvgPrice - buyAvgPrice) - sellFee

    // 将计算结果注入到 buyStats，便于模板渲染
    const buyStatsWithOp = Object.assign({}, buyStats, {
      effectiveTradeWeight,
      operationProfit
    })

    this.setData({
      showStats: true,
      buyStats: buyStatsWithOp,
      sellStats,
      queryResultTransactions: list.map(tx => ({
        ...tx,
        selected: false
      })),
      querySummary: querySummary || '',
      querySelectedTxIds: [],
      querySelectedCount: 0,
      queryCustomStats: null
    })
  },

  buildStatsByTransactions(transactions) {
    const list = Array.isArray(transactions) ? transactions : []
    const buy = storage.calculateAveragePrice(list, 'buy')
    const sell = storage.calculateAveragePrice(list, 'sell')

    const buyWeight = (buy && buy.totalWeight) || 0
    const sellWeight = (sell && sell.totalWeight) || 0
    const effectiveTradeWeight = Math.min(buyWeight, sellWeight)
    const sellAvgPrice = (sell && sell.avgPrice) || 0
    const buyAvgPrice = (buy && buy.avgPrice) || 0
    const sellFee = (sell && sell.totalFee) || 0
    const operationProfit = effectiveTradeWeight * (sellAvgPrice - buyAvgPrice) - sellFee

    const buyWithOp = Object.assign({}, buy, {
      effectiveTradeWeight,
      operationProfit
    })

    return {
      buy: buyWithOp,
      sell
    }
  },

  getQuickDateRange(key) {
    const now = new Date()
    const today = this.formatDate(now)

    if (key === 'yesterday') {
      const d = new Date(now)
      d.setDate(d.getDate() - 1)
      const day = this.formatDate(d)
      return { label: '昨日', startDate: day, endDate: day }
    }

    if (key === 'thisWeek') {
      const start = this.getWeekStart(now)
      return { label: '本周', startDate: this.formatDate(start), endDate: today }
    }

    if (key === 'lastWeek') {
      const thisWeekStart = this.getWeekStart(now)
      const lastWeekStart = new Date(thisWeekStart)
      lastWeekStart.setDate(lastWeekStart.getDate() - 7)
      const lastWeekEnd = new Date(thisWeekStart)
      lastWeekEnd.setDate(lastWeekEnd.getDate() - 1)
      return {
        label: '上周',
        startDate: this.formatDate(lastWeekStart),
        endDate: this.formatDate(lastWeekEnd)
      }
    }

    if (key === 'thisMonth') {
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
      return { label: '本月', startDate: this.formatDate(monthStart), endDate: today }
    }

    return { label: '今日', startDate: today, endDate: today }
  },

  getWeekStart(dateObj) {
    const date = new Date(dateObj)
    const day = date.getDay()
    const diff = day === 0 ? -6 : (1 - day)
    date.setDate(date.getDate() + diff)
    date.setHours(0, 0, 0, 0)
    return date
  },

  formatDate(dateObj) {
    const year = dateObj.getFullYear()
    const month = String(dateObj.getMonth() + 1).padStart(2, '0')
    const day = String(dateObj.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
  },

  onPlatformFilterChange(e) {
    this.setData({
      platformFilterIndex: parseInt(e.detail.value, 10)
    })
    this.applyRecordFilters()
  },

  onTypeFilterChange(e) {
    this.setData({
      typeFilterIndex: parseInt(e.detail.value, 10)
    })
    this.applyRecordFilters()
  },

  onPlatformFilterTap(e) {
    const platformFilterIndex = parseInt(e.currentTarget.dataset.index, 10)
    if (Number.isNaN(platformFilterIndex)) return
    this.setData({ platformFilterIndex })
    this.applyRecordFilters()
  },

  onTypeFilterTap(e) {
    const typeFilterIndex = parseInt(e.currentTarget.dataset.index, 10)
    if (Number.isNaN(typeFilterIndex)) return
    this.setData({ typeFilterIndex })
    this.applyRecordFilters()
  },

  toggleSelection(e) {
    if (this.data.isGoldReadOnly) {
      return
    }
    const targetId = e.currentTarget.dataset.id
    const transactions = this.data.transactions.map(tx => {
      if (tx.id !== targetId) {
        return tx
      }
      return {
        ...tx,
        selected: !tx.selected
      }
    })

    const selectedTxIds = transactions
      .filter(tx => tx.selected)
      .map(tx => tx.id)

    this.setData({
      transactions,
      selectedTxIds,
      selectedCount: selectedTxIds.length,
      customStats: null
    })
  },

  clearSelection() {
    const transactions = this.data.transactions.map(tx => ({ ...tx, selected: false }))
    this.setData({
      transactions,
      selectedTxIds: [],
      selectedCount: 0,
      customStats: null
    })
  },

  toggleQuerySelection(e) {
    if (this.data.isGoldReadOnly) {
      return
    }
    const targetId = e.currentTarget.dataset.id
    const queryResultTransactions = this.data.queryResultTransactions.map(tx => {
      if (tx.id !== targetId) {
        return tx
      }
      return {
        ...tx,
        selected: !tx.selected
      }
    })

    const querySelectedTxIds = queryResultTransactions
      .filter(tx => tx.selected)
      .map(tx => tx.id)

    this.setData({
      queryResultTransactions,
      querySelectedTxIds,
      querySelectedCount: querySelectedTxIds.length,
      queryCustomStats: null
    })
  },

  clearQuerySelection() {
    const queryResultTransactions = this.data.queryResultTransactions.map(tx => ({ ...tx, selected: false }))
    this.setData({
      queryResultTransactions,
      querySelectedTxIds: [],
      querySelectedCount: 0,
      queryCustomStats: null
    })
  },

  calculateCustom() {
    if (this.data.isGoldReadOnly) {
      wx.showToast({ title: '好友视图不可操作', icon: 'none' })
      return
    }
    const { allTransactions, selectedTxIds } = this.data

    if (selectedTxIds.length === 0) {
      wx.showToast({ title: '请选择至少一条记录', icon: 'none' })
      return
    }

    const selectedSet = new Set(selectedTxIds)
    const selectedTransactions = allTransactions.filter(tx => selectedSet.has(tx.id))

    this.setData({
      customStats: this.buildStatsByTransactions(selectedTransactions)
    })
  },

  calculateQueryCustom() {
    if (this.data.isGoldReadOnly) {
      wx.showToast({ title: '好友视图不可操作', icon: 'none' })
      return
    }
    const { queryResultTransactions, querySelectedTxIds } = this.data

    if (querySelectedTxIds.length === 0) {
      wx.showToast({ title: '请选择至少一条记录', icon: 'none' })
      return
    }

    const selectedSet = new Set(querySelectedTxIds)
    const selectedTransactions = queryResultTransactions.filter(tx => selectedSet.has(tx.id))

    this.setData({
      queryCustomStats: this.buildStatsByTransactions(selectedTransactions)
    })
  },

  async deleteSelected() {
    if (this.data.isGoldReadOnly) {
      wx.showToast({ title: '好友视图不可删除', icon: 'none' })
      return
    }

    const { allTransactions, selectedTxIds } = this.data
    if (!Array.isArray(selectedTxIds) || selectedTxIds.length === 0) {
      wx.showToast({ title: '请选择至少一条记录', icon: 'none' })
      return
    }

    const confirmed = await new Promise((resolve) => {
      wx.showModal({
        title: '删除确认',
        content: `删除后不可恢复，确定删除所选 ${selectedTxIds.length} 条记录吗？`,
        success: (res) => resolve(!!res.confirm)
      })
    })

    if (!confirmed) return

    wx.showLoading({ title: '删除中...' })
    try {
      // 按时间降序删除，减少因时间序列导致的校验失败概率
      const map = {}
      ;(allTransactions || []).forEach(tx => { map[tx.id] = tx })

      const parseTs = (t) => {
        if (!t) return 0
        const s = String(t).trim().replace(' ', 'T')
        const v = new Date(s).getTime()
        return Number.isFinite(v) ? v : 0
      }

      const ids = [...selectedTxIds].sort((a, b) => {
        return (parseTs(map[b] && (map[b].timestamp || map[b].date)) || 0) - (parseTs(map[a] && (map[a].timestamp || map[a].date)) || 0)
      })

      for (let i = 0; i < ids.length; i++) {
        const txId = ids[i]
        // 使用异步删除以兼容云端与本地
        // storage.deleteTransactionAsync 会在云端环境下调用云函数
        // 并在本地环境下执行校验性删除
        // 若失败则抛出错误并中断操作
        // eslint-disable-next-line no-await-in-loop
        const res = await storage.deleteTransactionAsync(txId)
        if (!res || !res.success) {
          throw new Error((res && res.message) || '删除失败')
        }
      }

      wx.showToast({ title: '删除成功', icon: 'success' })
      this.setData({ selectedTxIds: [], selectedCount: 0 })
      this.refreshPage()
    } catch (error) {
      wx.showToast({ title: (error && error.message) || '删除失败', icon: 'none' })
    } finally {
      wx.hideLoading()
    }
  },

  async deleteQuerySelected() {
    if (this.data.isGoldReadOnly) {
      wx.showToast({ title: '好友视图不可删除', icon: 'none' })
      return
    }

    const { queryResultTransactions, querySelectedTxIds } = this.data
    if (!Array.isArray(querySelectedTxIds) || querySelectedTxIds.length === 0) {
      wx.showToast({ title: '请选择至少一条记录', icon: 'none' })
      return
    }

    const confirmed = await new Promise((resolve) => {
      wx.showModal({
        title: '删除确认',
        content: `删除后不可恢复，确定删除所选 ${querySelectedTxIds.length} 条记录吗？`,
        success: (res) => resolve(!!res.confirm)
      })
    })

    if (!confirmed) return

    wx.showLoading({ title: '删除中...' })
    try {
      const map = {}
      ;(queryResultTransactions || []).forEach(tx => { map[tx.id] = tx })

      const parseTs = (t) => {
        if (!t) return 0
        const s = String(t).trim().replace(' ', 'T')
        const v = new Date(s).getTime()
        return Number.isFinite(v) ? v : 0
      }

      const ids = [...querySelectedTxIds].sort((a, b) => {
        return (parseTs(map[b] && (map[b].timestamp || map[b].date)) || 0) - (parseTs(map[a] && (map[a].timestamp || map[a].date)) || 0)
      })

      for (let i = 0; i < ids.length; i++) {
        const txId = ids[i]
        // eslint-disable-next-line no-await-in-loop
        const res = await storage.deleteTransactionAsync(txId)
        if (!res || !res.success) {
          throw new Error((res && res.message) || '删除失败')
        }
      }

      wx.showToast({ title: '删除成功', icon: 'success' })
      this.setData({ queryResultTransactions: (queryResultTransactions || []).map(tx => ({ ...tx, selected: false })), querySelectedTxIds: [], querySelectedCount: 0, queryCustomStats: null })
      this.loadTransactions()
    } catch (error) {
      wx.showToast({ title: (error && error.message) || '删除失败', icon: 'none' })
    } finally {
      wx.hideLoading()
    }
  },

  editTransaction(e) {
    if (this.data.isGoldReadOnly) {
      wx.showToast({ title: '好友视图不可修改', icon: 'none' })
      return
    }
    const txId = e.currentTarget.dataset.id
    const tx = this.data.allTransactions.find(item => item.id === txId)
    if (!tx) {
      return
    }
    // 页面显示中 '其他' 显示为 '自定义'，需要映射
    const targetDisplay = tx.platform === '其他' ? '自定义' : tx.platform
    const platformIndex = this.data.platforms.findIndex(item => item === targetDisplay)

    // 决定平台名称与手续费的初始展示（自定义平台默认手续费为 0）
    let platformNameValue = ''
    let platformFeeRateValue = 0
    let showNameInput = false
    let showFeeInput = false

    if (targetDisplay === '自定义') {
      platformNameValue = ''
      platformFeeRateValue = (tx.fee_rate !== undefined && tx.fee_rate !== null) ? String(tx.fee_rate) : '0'
      showNameInput = true
      showFeeInput = true
    } else if (!storage.PLATFORMS.includes(targetDisplay)) {
      // 已存在的自定义命名平台
      platformNameValue = targetDisplay
      platformFeeRateValue = (tx.fee_rate !== undefined && tx.fee_rate !== null) ? String(tx.fee_rate) : '0'
      showNameInput = false
      showFeeInput = true
    } else {
      platformNameValue = targetDisplay
      platformFeeRateValue = targetDisplay === '招商' ? '0' : '0.004'
      showNameInput = false
      showFeeInput = false
    }

    this.setData({
      editVisible: true,
      editForm: {
        id: tx.id,
        type: tx.type,
        price: String(tx.price),
        weight: String(tx.weight),
        date: tx.date,
        platformIndex: platformIndex >= 0 ? platformIndex : 0,
        platformName: platformNameValue,
        platformFeeRate: platformFeeRateValue
      },
      showEditPlatformNameInput: showNameInput,
      showEditPlatformFeeInput: showFeeInput
    })
  },

  closeEdit() {
    this.setData({
      editVisible: false
    })
  },

  onEditPriceInput(e) {
    this.setData({
      'editForm.price': e.detail.value
    })
  },

  onEditWeightInput(e) {
    this.setData({
      'editForm.weight': e.detail.value
    })
  },

  onEditDateChange(e) {
    this.setData({
      'editForm.date': e.detail.value
    })
  },

  onEditPlatformChange(e) {
    const platformIndex = parseInt(e.detail.value, 10)
    if (Number.isNaN(platformIndex)) return
    const platformOptions = this.data.platforms || []
    const selectedPlatform = platformOptions[platformIndex]

    let platformName = ''
    let platformFeeRate = ''
    let showNameInput = false
    let showFeeInput = false

    if (selectedPlatform === '自定义') {
      platformName = ''
      platformFeeRate = '0'
      showNameInput = true
      showFeeInput = true
    } else if (!storage.PLATFORMS.includes(selectedPlatform)) {
      platformName = selectedPlatform
      platformFeeRate = '0'
      showNameInput = false
      showFeeInput = true
    } else {
      platformName = selectedPlatform
      platformFeeRate = selectedPlatform === '招商' ? '0' : '0.004'
      showNameInput = false
      showFeeInput = false
    }

    this.setData({
      'editForm.platformIndex': platformIndex,
      'editForm.platformName': platformName,
      'editForm.platformFeeRate': platformFeeRate,
      showEditPlatformNameInput: showNameInput,
      showEditPlatformFeeInput: showFeeInput
    })
  },

  onEditPlatformNameInput(e) {
    this.setData({
      'editForm.platformName': String(e.detail.value || '').trim().slice(0, 20)
    })
  },

  onEditPlatformFeeRateInput(e) {
    const raw = String(e.detail.value || '').trim()
    this.setData({ 'editForm.platformFeeRate': raw })
  },

  async submitEdit() {
    const form = this.data.editForm

    const chosen = this.data.platforms[form.platformIndex]
    let platformToSave = ''
    if (chosen === '自定义') {
      const nameInput = String(form.platformName || '').trim()
      platformToSave = nameInput || '其他'
    } else {
      platformToSave = chosen
    }

    const rawFee = String(form.platformFeeRate || '')
    const feeRateRaw = rawFee !== '' ? Number(rawFee) : NaN
    const feeRateValid = rawFee !== '' && Number.isFinite(feeRateRaw) && feeRateRaw >= 0

    const payload = {
      type: form.type,
      price: parseFloat(form.price),
      weight: parseFloat(form.weight),
      date: form.date,
      platform: platformToSave
    }
    if (feeRateValid) payload.fee_rate = feeRateRaw

    const result = await storage.updateTransactionAsync(form.id, payload)

    if (!result.success) {
      wx.showToast({
        title: result.message || '修改失败',
        icon: 'none'
      })
      return
    }

    wx.showToast({ title: '修改成功', icon: 'success' })
    this.setData({ editVisible: false })
    this.refreshPage()
  },

  deleteTransaction(e) {
    if (this.data.isGoldReadOnly) {
      wx.showToast({ title: '好友视图不可删除', icon: 'none' })
      return
    }
    const transactionId = e.currentTarget.dataset.id

    wx.showModal({
      title: '删除确认',
      content: '删除后不可恢复，确定删除该记录吗？',
      success: res => {
        if (!res.confirm) return

        storage.deleteTransactionAsync(transactionId).then((result) => {
          if (!result.success) {
            wx.showToast({
              title: result.message || '删除失败',
              icon: 'none'
            })
            return
          }

          wx.showToast({ title: '删除成功', icon: 'success' })
          this.refreshPage()
        }).catch(() => {
          wx.showToast({
            title: '删除失败，请重试',
            icon: 'none'
          })
        })
      }
    })
  },

  onOpenProfileModal() {
    const user = this.data.user || {}
    this.setData({
      profileModalVisible: true,
      profileNicknameDraft: user.nickname || ''
    })
  },

  onCloseProfileModal() {
    if (this.data.profileSaving) return
    this.setData({ profileModalVisible: false })
  },

  onProfileNicknameInput(e) {
    this.setData({ profileNicknameDraft: e.detail.value })
  },

  onSaveProfileNickname() {
    if (this.data.profileSaving) return

    const nickname = String(this.data.profileNicknameDraft || '').trim()
    if (!nickname) {
      wx.showToast({ title: '昵称不能为空', icon: 'none' })
      return
    }

    this.setData({ profileSaving: true })
    auth.updateNickname(nickname)
      .then((user) => {
        const app = getApp()
        if (app && typeof app.refreshGlobalState === 'function') {
          app.refreshGlobalState()
        }
        this.setData({ user, profileNicknameDraft: user.nickname || '' })
        wx.showToast({ title: '昵称已更新', icon: 'success' })
      })
      .catch((error) => {
        wx.showToast({ title: (error && error.message) || '昵称更新失败', icon: 'none' })
      })
      .finally(() => {
        this.setData({ profileSaving: false })
      })
  },

  onChangeAvatar() {
    const user = this.data.user || {}
    wx.chooseImage({
      count: 1,
      sizeType: ['compressed'],
      sourceType: ['album', 'camera'],
      success: (res) => {
        const filePath = res && res.tempFilePaths && res.tempFilePaths[0]
        if (!filePath) return

        if (!(wx && wx.cloud && typeof wx.cloud.uploadFile === 'function')) {
          wx.showToast({ title: '当前环境不支持头像上传', icon: 'none' })
          return
        }

        wx.showLoading({ title: '上传头像中' })
        const cloudPath = `avatars/${user.id || 'user'}/${Date.now()}_${Math.floor(Math.random() * 1000)}.jpg`
        wx.cloud.uploadFile({ cloudPath, filePath })
          .then((uploadRes) => {
            const fileID = uploadRes && uploadRes.fileID
            if (!fileID) {
              throw new Error('头像上传失败')
            }
            return auth.updateWechatProfile({
              nickname: user.nickname,
              avatarUrl: fileID
            })
          })
          .then((nextUser) => {
            const app = getApp()
            if (app && typeof app.refreshGlobalState === 'function') {
              app.refreshGlobalState()
            }
            this.setData({ user: nextUser })
            wx.showToast({ title: '头像已更新', icon: 'success' })
          })
          .catch((error) => {
            wx.showToast({ title: (error && error.message) || '头像更新失败', icon: 'none' })
          })
          .finally(() => {
            wx.hideLoading()
          })
      }
    })
  },

  onCopyUserId() {
    const user = this.data.user || {}
    const userId = String(user.id || '')
    if (!userId) {
      wx.showToast({ title: '用户ID为空', icon: 'none' })
      return
    }

    wx.setClipboardData({
      data: userId,
      success: () => wx.showToast({ title: '用户ID已复制', icon: 'success' })
    })
  },

  onClearData() {
    wx.showModal({
      title: '警示',
      content: '确定要清除当前账号的所有交易数据吗？此操作不可恢复。',
      success: async (res) => {
        if (!res.confirm) {
          return
        }
        const result = await storage.clearTransactionsAsync()
        if (!result.success) {
          wx.showToast({ title: result.message || '清空失败，请重试', icon: 'none' })
          return
        }
        this.refreshPage()
        wx.showToast({ title: '数据已清除', icon: 'success' })
      }
    })
  },

  onLogout() {
    wx.showModal({
      title: '退出登录',
      content: '确定要退出当前账号吗？',
      success: (res) => {
        if (!res.confirm) return
        auth.logout()
        wx.reLaunch({ url: '/pages/login/login' })
      }
    })
  },

  onGoWedding() {
    wx.navigateTo({ url: '/pages/wedding/wedding' })
  },

  onGoSelector() {
    wx.navigateTo({ url: '/pages/portal/portal' })
  },

  onGoSocial() {
    // 仅好友图标走该入口，消息图标必须绑定 onOpenMessageCenter。
    wx.navigateTo({ url: '/pages/social/social?scene=gold' })
  },

  buildPendingMessageCenter(userId) {
    const uid = String(userId || '')
    if (!uid) {
      return { count: 0 }
    }

    const overview = social.getRelationOverview(uid, { scene: 'gold' })
    return { count: (overview.incomingPending || []).length }
  },

  onOpenMessageCenter() {
    wx.navigateTo({ url: '/pages/messages/messages?scene=gold' })
  },
})
