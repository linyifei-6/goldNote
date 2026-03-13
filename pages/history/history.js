const storage = require('../../utils/storage')
const auth = require('../../utils/auth')

Page({
  data: {
    user: null,
    mode: 'today',
    today: '',
    startDate: '',
    endDate: '',
    showStats: false,
    buyStats: null,
    sellStats: null,
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
      platformIndex: 0
    }
  },

  onLoad() {
    const today = new Date().toISOString().split('T')[0]
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

    this.setData({ user })

    await storage.syncTransactionsFromCloud(user.id)
    this.loadTransactions()
    if (this.data.mode === 'today') {
      this.calculateTodayStats()
    } else if (this.data.mode === 'range') {
      this.calculateRangeStats()
    }
  },

  loadTransactions() {
    const allTransactions = storage.getTransactions()
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

  getPlatformOptions(transactions) {
    return [...storage.PLATFORMS]
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
      .filter(tx => selectedPlatform === '全部' || tx.platform === selectedPlatform)
      .filter(tx => selectedType === '全部' || (selectedType === '买入' ? tx.type === 'buy' : tx.type === 'sell'))
      .map(tx => ({
        ...tx,
        selected: selectedSet.has(tx.id)
      }))

    const selectedTxIds = transactions.filter(tx => tx.selected).map(tx => tx.id)

    this.setData({
      transactions,
      selectedTxIds,
      selectedCount: selectedTxIds.length,
      customStats: null
    })
  },

  selectToday() {
    this.setData({
      mode: 'today',
      showStats: true,
      customStats: null
    })
    this.calculateTodayStats()
  },

  selectRange() {
    this.setData({
      mode: 'range',
      showStats: true,
      customStats: null
    })
    this.calculateRangeStats()
  },

  selectCustom() {
    this.setData({
      mode: 'custom',
      showStats: false,
      customStats: null
    })
  },

  onStartDateChange(e) {
    this.setData({ startDate: e.detail.value })
    this.calculateRangeStats()
  },

  onEndDateChange(e) {
    this.setData({ endDate: e.detail.value })
    this.calculateRangeStats()
  },

  calculateTodayStats() {
    const today = new Date().toISOString().split('T')[0]
    const filteredTransactions = storage.filterByDateRange(this.data.transactions, today, today)

    const buyStats = storage.calculateAveragePrice(filteredTransactions, 'buy')
    const sellStats = storage.calculateAveragePrice(filteredTransactions, 'sell')

    this.setData({
      showStats: true,
      buyStats,
      sellStats
    })
  },

  calculateRangeStats() {
    const { startDate, endDate, transactions } = this.data
    if (!startDate || !endDate) return

    const filteredTransactions = storage.filterByDateRange(transactions, startDate, endDate)
    const buyStats = storage.calculateAveragePrice(filteredTransactions, 'buy')
    const sellStats = storage.calculateAveragePrice(filteredTransactions, 'sell')

    this.setData({
      showStats: true,
      buyStats,
      sellStats
    })
  },

  onPlatformFilterChange(e) {
    this.setData({
      platformFilterIndex: parseInt(e.detail.value, 10)
    })
    this.applyRecordFilters()
    if (this.data.mode === 'today') {
      this.calculateTodayStats()
    } else if (this.data.mode === 'range') {
      this.calculateRangeStats()
    }
  },

  onTypeFilterChange(e) {
    this.setData({
      typeFilterIndex: parseInt(e.detail.value, 10)
    })
    this.applyRecordFilters()
    if (this.data.mode === 'today') {
      this.calculateTodayStats()
    } else if (this.data.mode === 'range') {
      this.calculateRangeStats()
    }
  },

  onPlatformFilterTap(e) {
    const platformFilterIndex = parseInt(e.currentTarget.dataset.index, 10)
    if (Number.isNaN(platformFilterIndex)) return
    this.setData({ platformFilterIndex })
    this.applyRecordFilters()
    if (this.data.mode === 'today') {
      this.calculateTodayStats()
    } else if (this.data.mode === 'range') {
      this.calculateRangeStats()
    }
  },

  onTypeFilterTap(e) {
    const typeFilterIndex = parseInt(e.currentTarget.dataset.index, 10)
    if (Number.isNaN(typeFilterIndex)) return
    this.setData({ typeFilterIndex })
    this.applyRecordFilters()
    if (this.data.mode === 'today') {
      this.calculateTodayStats()
    } else if (this.data.mode === 'range') {
      this.calculateRangeStats()
    }
  },

  toggleSelection(e) {
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

  calculateCustom() {
    const { allTransactions, selectedTxIds } = this.data

    if (selectedTxIds.length === 0) {
      wx.showToast({ title: '请选择至少一条记录', icon: 'none' })
      return
    }

    const selectedSet = new Set(selectedTxIds)
    const selectedTransactions = allTransactions.filter(tx => selectedSet.has(tx.id))
    const buyTransactions = selectedTransactions.filter(tx => tx.type === 'buy')
    const sellTransactions = selectedTransactions.filter(tx => tx.type === 'sell')

    let buyStats = null
    let sellStats = null

    if (buyTransactions.length > 0) {
      let totalAmount = 0
      let totalWeight = 0
      buyTransactions.forEach(tx => {
        totalAmount += tx.price * tx.weight
        totalWeight += tx.weight
      })

      buyStats = {
        count: buyTransactions.length,
        avgPrice: totalAmount / totalWeight,
        totalWeight,
        totalAmount
      }
    }

    if (sellTransactions.length > 0) {
      let totalAmount = 0
      let totalWeight = 0
      sellTransactions.forEach(tx => {
        totalAmount += tx.price * tx.weight
        totalWeight += tx.weight
      })

      sellStats = {
        count: sellTransactions.length,
        avgPrice: totalAmount / totalWeight,
        totalWeight,
        totalAmount
      }
    }

    this.setData({
      customStats: {
        buy: buyStats,
        sell: sellStats
      }
    })
  },

  editTransaction(e) {
    const txId = e.currentTarget.dataset.id
    const tx = this.data.allTransactions.find(item => item.id === txId)
    if (!tx) {
      return
    }
    const platformIndex = this.data.platforms.findIndex(item => item === tx.platform)

    this.setData({
      editVisible: true,
      editForm: {
        id: tx.id,
        type: tx.type,
        price: String(tx.price),
        weight: String(tx.weight),
        date: tx.date,
        platformIndex: platformIndex >= 0 ? platformIndex : 0
      }
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
    this.setData({
      'editForm.platformIndex': parseInt(e.detail.value, 10)
    })
  },

  async submitEdit() {
    const form = this.data.editForm

    const result = await storage.updateTransactionAsync(form.id, {
      type: form.type,
      price: parseFloat(form.price),
      weight: parseFloat(form.weight),
      date: form.date,
      platform: this.data.platforms[form.platformIndex]
    })

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

  onGoWedding() {
    wx.navigateTo({ url: '/pages/wedding/wedding' })
  },

  onGoSelector() {
    wx.navigateTo({ url: '/pages/portal/portal' })
  }
})
