const storage = require('../../utils/storage')
const auth = require('../../utils/auth')

Page({
  data: {
    user: null,
    transactionType: 'buy',
    price: '',
    weight: '',
    platforms: [...storage.PLATFORMS],
    platformIndex: 0,
    feeRateText: '0.4%',
    date: '',
    today: '',
    currentHolding: 0,
    platformHolding: 0,
    feeAmount: 0,
    netAmount: 0,
    transactionAmount: 0,
    displayAmount: 0,
    recentTransactions: []
  },

  onLoad() {
    const today = new Date().toISOString().split('T')[0]
    this.setData({
      today,
      date: today
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
    this.loadCurrentHolding()
    this.loadRecentTransactions()
  },

  getSelectedPlatformName() {
    return this.data.platforms[this.data.platformIndex]
  },

  getPlatformOptions(transactions) {
    return [...storage.PLATFORMS]
  },

  loadCurrentHolding() {
    const transactions = storage.getTransactions()
    const platformOptions = this.getPlatformOptions(transactions)
    let platformIndex = this.data.platformIndex
    if (platformIndex >= platformOptions.length) {
      platformIndex = 0
    }

    const platformName = platformOptions[platformIndex]

    const holdings = storage.calculateHoldings(transactions)
    const platformTransactions = transactions.filter(item => item.platform === platformName)
    const platformHoldings = storage.calculateHoldings(platformTransactions)

    this.setData({
      platforms: platformOptions,
      platformIndex,
      currentHolding: holdings.currentHolding,
      platformHolding: platformHoldings.currentHolding
    })
  },

  loadRecentTransactions() {
    const transactions = storage.getTransactions()
      .sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1))
      .slice(0, 8)
      .map(item => ({
        ...item,
        price: Number(item.price) || 0,
        weight: Number(item.weight) || 0,
        net_amount: Number(item.net_amount) || 0,
        fee_amount: Number(item.fee_amount) || 0,
        displayTime: item.timestamp || `${item.date} 00:00:00`
      }))

    this.setData({
      recentTransactions: transactions
    })
  },

  selectBuy() {
    this.setData({
      transactionType: 'buy'
    })
    this.calculateFees()
  },

  selectSell() {
    this.setData({
      transactionType: 'sell'
    })
    this.calculateFees()
  },

  onPriceInput(e) {
    this.setData({
      price: e.detail.value
    })
    this.calculateFees()
  },

  onWeightInput(e) {
    this.setData({
      weight: e.detail.value
    })
    this.calculateFees()
  },

  onPlatformChange(e) {
    this.setData({
      platformIndex: parseInt(e.detail.value, 10)
    })
    this.loadCurrentHolding()
    this.calculateFees()
  },

  onPlatformTap(e) {
    const platformIndex = parseInt(e.currentTarget.dataset.index, 10)
    if (Number.isNaN(platformIndex)) return
    this.setData({ platformIndex })
    this.loadCurrentHolding()
    this.calculateFees()
  },

  onDateChange(e) {
    this.setData({
      date: e.detail.value
    })
  },

  calculateFees() {
    const { price, weight, transactionType, platforms, platformIndex } = this.data
    const priceNum = parseFloat(price) || 0
    const weightNum = parseFloat(weight) || 0
    const amount = priceNum * weightNum
    const selectedPlatform = platforms[platformIndex]
    const feeRate = selectedPlatform === '招商' ? 0 : 0.004

    if (transactionType === 'sell') {
      const feeAmount = amount * feeRate
      const netAmount = amount - feeAmount
      this.setData({
        feeAmount,
        netAmount,
        feeRateText: feeRate === 0 ? '0%' : '0.4%',
        transactionAmount: 0,
        displayAmount: amount
      })
    } else {
      this.setData({
        feeAmount: 0,
        netAmount: -amount,
        feeRateText: feeRate === 0 ? '0%' : '0.4%',
        transactionAmount: amount,
        displayAmount: amount
      })
    }
  },

  async submitTransaction() {
    const {
      transactionType,
      price,
      weight,
      platformIndex,
      platforms,
      date,
      today,
      currentHolding,
      platformHolding
    } = this.data

    const priceNum = parseFloat(price)
    const weightNum = parseFloat(weight)

    if (!(priceNum > 0)) {
      wx.showToast({ title: '请输入有效的成交价格', icon: 'none' })
      return
    }

    if (!(weightNum > 0)) {
      wx.showToast({ title: '请输入有效的交易克数', icon: 'none' })
      return
    }

    const platformName = platforms[platformIndex]

    if (transactionType === 'sell' && weightNum > platformHolding + 1e-8) {
      wx.showModal({
        title: '持仓不足',
        content: `当前平台可卖出 ${platformHolding.toFixed(2)} 克，无法卖出 ${weightNum.toFixed(2)} 克`,
        showCancel: false
      })
      return
    }

    const selectedDate = date || today
    const result = await storage.saveTransactionAsync({
      type: transactionType,
      price: priceNum,
      weight: weightNum,
      platform: platformName,
      date: selectedDate
    })

    if (!result.success) {
      wx.showToast({
        title: result.message || '保存失败，请重试',
        icon: 'none'
      })
      return
    }

    wx.showToast({
      title: transactionType === 'buy' ? '买入成功' : '卖出成功',
      icon: 'success'
    })

    this.setData({
      price: '',
      weight: '',
      feeAmount: 0,
      netAmount: 0,
      transactionAmount: 0,
      displayAmount: 0,
      date: today
    })

    this.loadCurrentHolding()
    this.loadRecentTransactions()
  },

  onGoWedding() {
    wx.navigateTo({ url: '/pages/wedding/wedding' })
  },

  onGoSelector() {
    wx.navigateTo({ url: '/pages/portal/portal' })
  }
})
