const storage = require('./utils/storage')

App({
  onLaunch() {
    if (wx.cloud) {
      wx.cloud.init({
        env: 'goldnote-7gvcgw84da48b20a',
        traceUser: true
      })
    } else {
      console.warn('当前基础库不支持云能力')
    }

    const currentUser = storage.getCurrentUser()
    if (currentUser && !currentUser.isWechatAuth) {
      storage.logout()
    }

    this.globalData = {
      user: storage.getCurrentUser(),
      currentHolding: 0,
      avgCost: 0,
      realizedProfit: 0,
      totalInvestment: 0
    }

    this.refreshGlobalState()
  },

  refreshGlobalState() {
    const user = storage.getCurrentUser()
    this.globalData.user = user

    if (!user) {
      this.globalData.currentHolding = 0
      this.globalData.avgCost = 0
      this.globalData.realizedProfit = 0
      this.globalData.totalInvestment = 0
      return
    }

    const transactions = storage.getTransactions(user.id)
    const holdings = storage.calculateHoldings(transactions)

    this.globalData.currentHolding = holdings.currentHolding
    this.globalData.avgCost = holdings.avgCost
    this.globalData.realizedProfit = holdings.realizedProfit
    this.globalData.totalInvestment = holdings.totalInvestment
  },

  globalData: {}
})
