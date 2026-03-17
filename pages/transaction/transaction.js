const storage = require('../../utils/storage')
const auth = require('../../utils/auth')
const social = require('../../utils/social')

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
    recentTransactions: [],
    goldViewUsers: [],
    goldViewIndex: 0,
    goldViewUserId: '',
    goldViewTargetName: '',
    isGoldReadOnly: false,
    profileModalVisible: false,
    profileNicknameDraft: '',
    profileSaving: false
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
      isGoldReadOnly: !!viewState.readOnly
    })

    await storage.syncTransactionsFromCloud(targetUserId)
    this.loadCurrentHolding()
    this.loadRecentTransactions()
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

  getSelectedPlatformName() {
    return this.data.platforms[this.data.platformIndex]
  },

  getPlatformOptions(transactions) {
    return [...storage.PLATFORMS]
  },

  loadCurrentHolding() {
    const viewUserId = this.data.goldViewUserId || (this.data.user && this.data.user.id)
    const transactions = storage.getTransactions(viewUserId)
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
    const viewUserId = this.data.goldViewUserId || (this.data.user && this.data.user.id)
    const transactions = storage.getTransactions(viewUserId)
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
    if (this.data.isGoldReadOnly) {
      wx.showToast({ title: '好友视图不可操作', icon: 'none' })
      return
    }

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
  },

  onGoSocial() {
    wx.navigateTo({ url: '/pages/social/social?scene=gold' })
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
  }
})
