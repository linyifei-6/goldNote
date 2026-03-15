const storage = require('../../utils/storage')
const auth = require('../../utils/auth')
const goldPrice = require('../../utils/goldPrice')

Page({
  data: {
    currentPrice: '',
    user: null,
    priceUpdateTimer: null,
    countdownTimer: null,
    lastUpdateTime: '',
    isUpdating: false,
    autoUpdateMode: true,
    simulatorPaused: false,
    priceSource: '',
    usingSimulator: false,
    countdown: 2,
    internationalPrice: '',
    exchangeRate: '',
    fxMeta: '',
    holdings: {
      currentHolding: 0,
      avgCost: 0,
      realizedProfit: 0,
      totalInvestment: 0
    },
    unrealizedProfit: 0,
    totalProfit: 0,
    totalReturnRate: 0,
    currentValue: 0,
    platforms: ['全部', ...storage.PLATFORMS],
    curvePlatformIndex: 0,
    curveRanges: ['最近一个月', '最近三个月', '最近半年', '最近一年', '最近三年'],
    curveRangeIndex: 3,
    showTrendDetail: false,
    cumulativeCurvePoints: [],
    platformHoldings: [],
    platformProfits: [],
    summaryPlatforms: []
  },

  onLoad() {
    this.refreshPage()
  },

  onShow() {
    this.refreshPage()
    if (this.data.autoUpdateMode && !this.data.simulatorPaused) {
      this.startAutoUpdate()
    }
  },

  onHide() {
    this.stopAutoUpdate()
  },

  onUnload() {
    this.stopAutoUpdate()
  },

  async refreshPage() {
    const user = auth.ensureLogin()
    if (!user) return

    this.setData({ user })
    await storage.syncTransactionsFromCloud(user.id)
    this.loadHoldings()
  },

  loadHoldings() {
    const transactions = storage.getTransactions()
    const currentPriceNum = parseFloat(this.data.currentPrice) || 0
    const platformOptions = this.getPlatformOptions(transactions)
    let curvePlatformIndex = this.data.curvePlatformIndex
    if (curvePlatformIndex >= platformOptions.length) {
      curvePlatformIndex = 0
    }
    const holdings = storage.calculateHoldings(transactions) || {
      currentHolding: 0,
      avgCost: 0,
      realizedProfit: 0,
      totalInvestment: 0
    }

    const selectedPlatform = platformOptions[curvePlatformIndex]
    const rawCurvePoints = storage.buildProfitCurve(transactions, selectedPlatform)
    const allCurvePoints = this.buildDailyCumulativeCurve(rawCurvePoints)
    const cumulativeCurvePoints = this.filterCurveBySelectedRange(allCurvePoints)
    const platformAnalysis = this.buildPlatformAnalysis(transactions, currentPriceNum)
    const summaryPlatforms = this.buildSummaryPlatforms(platformAnalysis.holdings, platformAnalysis.profits)

    this.setData({
      platforms: platformOptions,
      curvePlatformIndex,
      holdings,
      cumulativeCurvePoints,
      platformHoldings: platformAnalysis.holdings,
      platformProfits: platformAnalysis.profits,
      summaryPlatforms
    })

    this.calculateProfits()
    wx.nextTick(() => {
      this.drawCumulativeCurve()
      if (this.data.showTrendDetail) {
        this.drawTrendDetailCurve()
      }
    })
  },

  onOpenTrendDetail() {
    this.setData({ showTrendDetail: true })
    wx.nextTick(() => {
      this.drawTrendDetailCurve()
    })
  },

  onCloseTrendDetail() {
    this.setData({ showTrendDetail: false })
  },

  noop() {},

  buildDailyCumulativeCurve(points) {
    const list = Array.isArray(points) ? points : []
    if (list.length === 0) {
      return []
    }

    const dailyMap = {}
    list.forEach((item) => {
      const day = String(item.label || '').split(' ')[0]
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
        return
      }
      dailyMap[day] = Number(item.value) || 0
    })

    return Object.keys(dailyMap)
      .sort((a, b) => (a > b ? 1 : -1))
      .map((day) => ({
        label: day,
        value: dailyMap[day]
      }))
  },

  onPriceInput(e) {
    const currentPrice = e.detail.value
    this.setData({
      currentPrice
    })
    this.loadHoldings()
  },

  togglePriceMode() {
    const autoUpdateMode = !this.data.autoUpdateMode
    this.setData({
      autoUpdateMode,
      simulatorPaused: autoUpdateMode ? false : this.data.simulatorPaused
    })

    if (autoUpdateMode) {
      this.startAutoUpdate()
    } else {
      this.stopAutoUpdate()
    }
    
    if (autoUpdateMode) {
      wx.showToast({ title: '已切换至实时API', icon: 'success' })
    } else {
      wx.showToast({ title: '已切换至手动输入', icon: 'success' })
    }
  },

  onFetchPriceTap() {
    this.fetchGoldPrice(false, 'qveris')
  },

  onToggleSimulatorUpdate() {
    if (!this.data.autoUpdateMode) {
      return
    }

    if (this.data.simulatorPaused) {
      this.setData({ simulatorPaused: false })
      this.startAutoUpdate()
      wx.showToast({ title: '模拟已开始', icon: 'none' })
      return
    }

    this.setData({ simulatorPaused: true })
    this.stopAutoUpdate()
    wx.showToast({ title: '模拟已暂停', icon: 'none' })
  },

  onCurvePlatformChange(e) {
    this.setData({
      curvePlatformIndex: parseInt(e.detail.value, 10)
    })
    this.loadHoldings()
  },

  onCurveRangeChange(e) {
    this.setData({
      curveRangeIndex: parseInt(e.detail.value, 10)
    })
    this.loadHoldings()
  },

  onCurvePlatformTap(e) {
    const curvePlatformIndex = parseInt(e.currentTarget.dataset.index, 10)
    if (Number.isNaN(curvePlatformIndex)) return
    this.setData({ curvePlatformIndex })
    this.loadHoldings()
  },

  onCurveRangeTap(e) {
    const curveRangeIndex = parseInt(e.currentTarget.dataset.index, 10)
    if (Number.isNaN(curveRangeIndex)) return
    this.setData({ curveRangeIndex })
    this.loadHoldings()
  },

  getPlatformOptions(transactions) {
    return ['全部', ...storage.PLATFORMS]
  },

  filterCurveBySelectedRange(points) {
    const list = Array.isArray(points) ? points : []
    if (list.length === 0) {
      return []
    }

    const latestDate = this.parseCurvePointDate(list[list.length - 1].label)
    if (!latestDate) {
      return list
    }

    const rangeKey = this.data.curveRangeIndex
    const start = new Date(latestDate)

    if (rangeKey === 0) {
      start.setMonth(start.getMonth() - 1)
    } else if (rangeKey === 1) {
      start.setMonth(start.getMonth() - 3)
    } else if (rangeKey === 2) {
      start.setMonth(start.getMonth() - 6)
    } else if (rangeKey === 3) {
      start.setFullYear(start.getFullYear() - 1)
    } else {
      start.setFullYear(start.getFullYear() - 3)
    }

    const startTime = start.getTime()
    return list.filter(item => {
      const pointDate = this.parseCurvePointDate(item.label)
      return pointDate && pointDate.getTime() >= startTime
    })
  },

  parseCurvePointDate(label) {
    const datePart = String(label || '').split(' ')[0]
    if (!/^\d{4}-\d{2}-\d{2}$/.test(datePart)) {
      return null
    }
    const date = new Date(`${datePart}T00:00:00`)
    return Number.isNaN(date.getTime()) ? null : date
  },

  buildPlatformAnalysis(transactions, currentPrice) {
    const list = Array.isArray(transactions) ? transactions : []
    const holdings = []
    const profits = []

    storage.PLATFORMS.forEach(platform => {
      const platformTx = list.filter(tx => tx.platform === platform)
      if (platformTx.length === 0) {
        return
      }

      const result = storage.calculateHoldings(platformTx)
      const unrealizedProfit = currentPrice > 0
        ? result.currentHolding * (currentPrice - result.avgCost)
        : 0
      const totalProfit = result.realizedProfit
      const returnRate = result.totalInvestment > 0
        ? (result.realizedProfit / result.totalInvestment) * 100
        : 0

      holdings.push({
        platform,
        currentHolding: result.currentHolding,
        avgCost: result.avgCost
      })

      profits.push({
        platform,
        realizedProfit: result.realizedProfit,
        unrealizedProfit,
        totalProfit,
        returnRate
      })
    })

    return { holdings, profits }
  },

  buildSummaryPlatforms(holdings, profits) {
    const holdingMap = {}
    const profitMap = {}

    ;(holdings || []).forEach((item) => {
      holdingMap[item.platform] = item
    })

    ;(profits || []).forEach((item) => {
      profitMap[item.platform] = item
    })

    const platforms = [...new Set([...
      Object.keys(holdingMap),
      ...Object.keys(profitMap)
    ])]

    const orderMap = {
      民生: 0,
      浙商: 1,
      招商: 2,
      其他: 3
    }

    return platforms.map((platform) => {
      const holding = holdingMap[platform] || {}
      const profit = profitMap[platform] || {}
      return {
        platform,
        currentHolding: Number(holding.currentHolding) || 0,
        avgCost: Number(holding.avgCost) || 0,
        realizedProfit: Number(profit.realizedProfit) || 0,
        unrealizedProfit: Number(profit.unrealizedProfit) || 0
      }
    }).sort((a, b) => {
      const left = Object.prototype.hasOwnProperty.call(orderMap, a.platform)
        ? orderMap[a.platform]
        : 999
      const right = Object.prototype.hasOwnProperty.call(orderMap, b.platform)
        ? orderMap[b.platform]
        : 999
      if (left !== right) {
        return left - right
      }
      return b.currentHolding - a.currentHolding
    })
  },

  calculateProfits() {
    const { holdings } = this.data
    const currentPrice = parseFloat(this.data.currentPrice) || 0
    const totalProfit = holdings.realizedProfit
    const totalReturnRate = holdings.totalInvestment > 0
      ? (totalProfit / holdings.totalInvestment) * 100
      : 0

    if (!currentPrice || currentPrice <= 0) {
      this.setData({
        unrealizedProfit: 0,
        totalProfit,
        totalReturnRate,
        currentValue: 0
      })
      return
    }

    const unrealizedProfit = holdings.currentHolding * (currentPrice - holdings.avgCost)
    const currentValue = holdings.currentHolding * currentPrice

    this.setData({
      unrealizedProfit,
      totalProfit,
      totalReturnRate,
      currentValue
    })
  },

  drawCumulativeCurve() {
    const points = this.data.cumulativeCurvePoints || []
    const ctx = wx.createCanvasContext('cumulativeProfitCanvas', this)

    const width = 340
    const height = 160
    const paddingLeft = 58
    const paddingRight = 16
    const paddingTop = 18
    const paddingBottom = 26
    const chartWidth = width - paddingLeft - paddingRight
    const chartHeight = height - paddingTop - paddingBottom
    const axisBottomY = height - paddingBottom

    ctx.clearRect(0, 0, width, height)

    ctx.setStrokeStyle('#e8e8e8')
    ctx.setLineWidth(1)

    // X 轴
    ctx.beginPath()
    ctx.moveTo(paddingLeft, axisBottomY)
    ctx.lineTo(width - paddingRight, axisBottomY)
    ctx.stroke()

    // Y 轴
    ctx.beginPath()
    ctx.moveTo(paddingLeft, paddingTop)
    ctx.lineTo(paddingLeft, axisBottomY)
    ctx.stroke()

    ctx.setFillStyle('#9a9a9a')
    ctx.setFontSize(10)
    ctx.fillText('收益(元)', 6, 16)
    ctx.fillText('日期', width - 28, height - 4)

    if (points.length === 0) {
      ctx.setFillStyle('#999999')
      ctx.setFontSize(12)
      ctx.fillText('暂无收益曲线数据', 126, 86)
      ctx.draw()
      return
    }

    const values = points.map(item => item.value)
    const maxVal = Math.max(...values)
    const minVal = Math.min(...values)
    const span = maxVal === minVal ? Math.max(1, Math.abs(maxVal) * 0.2) : (maxVal - minVal)
    const plotMin = maxVal === minVal ? minVal - span / 2 : minVal
    const plotMax = maxVal === minVal ? maxVal + span / 2 : maxVal
    const plotSpan = plotMax - plotMin

    const yTicks = [plotMin, plotMin + plotSpan / 2, plotMax]
    yTicks.forEach((tick) => {
      const y = axisBottomY - ((tick - plotMin) / plotSpan) * chartHeight
      ctx.setStrokeStyle('#f0f0f0')
      ctx.beginPath()
      ctx.moveTo(paddingLeft, y)
      ctx.lineTo(width - paddingRight, y)
      ctx.stroke()

      ctx.setFillStyle('#8d8d8d')
      ctx.setFontSize(10)
      ctx.fillText(tick.toFixed(0), 8, y + 4)
    })

    if (minVal < 0 && maxVal > 0) {
      const zeroY = axisBottomY - ((0 - plotMin) / plotSpan) * chartHeight
      ctx.setStrokeStyle('#f0f0f0')
      ctx.beginPath()
      ctx.moveTo(paddingLeft, zeroY)
      ctx.lineTo(width - paddingRight, zeroY)
      ctx.stroke()
    }

    const xStep = points.length > 1 ? chartWidth / (points.length - 1) : 0

    ctx.setStrokeStyle('#f6b73c')
    ctx.setLineWidth(2)
    ctx.beginPath()

    points.forEach((point, index) => {
      const x = paddingLeft + xStep * index
      const y = axisBottomY - ((point.value - plotMin) / plotSpan) * chartHeight

      if (index === 0) {
        ctx.moveTo(x, y)
      } else {
        ctx.lineTo(x, y)
      }
    })
    ctx.stroke()

    points.forEach((point, index) => {
      const x = paddingLeft + xStep * index
      const y = axisBottomY - ((point.value - plotMin) / plotSpan) * chartHeight
      ctx.setFillStyle('#f6b73c')
      ctx.beginPath()
      ctx.arc(x, y, 2.5, 0, Math.PI * 2)
      ctx.fill()
    })

    const maxIndex = values.indexOf(maxVal)
    const minIndex = values.indexOf(minVal)
    const latestIndex = points.length - 1
    const markerMap = {}

    markerMap[maxIndex] = `${maxVal.toFixed(2)}`
    markerMap[minIndex] = `${minVal.toFixed(2)}`
    markerMap[latestIndex] = `${(Number(points[latestIndex].value) || 0).toFixed(2)}`

    Object.keys(markerMap).forEach((key) => {
      const idx = Number(key)
      if (!Number.isFinite(idx)) return
      const point = points[idx]
      if (!point) return

      const x = paddingLeft + xStep * idx
      const y = axisBottomY - ((point.value - plotMin) / plotSpan) * chartHeight
      const label = markerMap[idx]
      const textX = Math.max(paddingLeft + 2, Math.min(width - paddingRight - 64, x + 4))
      const textY = Math.max(paddingTop + 10, y - 8)

      ctx.setFillStyle('#d93025')
      ctx.setFontSize(10)
      ctx.fillText(label, textX, textY)
    })

    const formatAxisDate = (rawLabel) => {
      const datePart = String(rawLabel || '').split(' ')[0]
      if (/^\d{4}-\d{2}-\d{2}$/.test(datePart)) {
        return datePart.slice(5)
      }
      return datePart
    }

    ctx.setFillStyle('#999999')
    ctx.setFontSize(10)

    const labelY = height - 12
    const rightLimit = width - paddingRight - 30
    const candidateIndices = points.length <= 2
      ? points.map((_, index) => index)
      : [0, Math.floor((points.length - 1) / 2), points.length - 1]

    const uniqueIndices = [...new Set(candidateIndices)].sort((a, b) => a - b)

    uniqueIndices.forEach((pointIndex, order) => {
      const label = formatAxisDate(points[pointIndex].label)
      if (!label) {
        return
      }

      const pointX = paddingLeft + xStep * pointIndex
      let textX = pointX - 16
      if (order === 0) {
        textX = paddingLeft - 14
      }
      if (order === uniqueIndices.length - 1) {
        textX = Math.min(rightLimit, pointX - 20)
      }

      textX = Math.max(paddingLeft - 14, Math.min(rightLimit, textX))
      ctx.fillText(label, textX, labelY)
    })

    ctx.draw()
  },

  drawTrendDetailCurve() {
    const points = this.data.cumulativeCurvePoints || []
    const ctx = wx.createCanvasContext('trendDetailCanvas', this)

    const width = 360
    const height = 260
    const paddingLeft = 64
    const paddingRight = 18
    const paddingTop = 24
    const paddingBottom = 42
    const chartWidth = width - paddingLeft - paddingRight
    const chartHeight = height - paddingTop - paddingBottom
    const axisBottomY = height - paddingBottom

    ctx.clearRect(0, 0, width, height)
    ctx.setStrokeStyle('#e8e8e8')
    ctx.setLineWidth(1)

    ctx.beginPath()
    ctx.moveTo(paddingLeft, axisBottomY)
    ctx.lineTo(width - paddingRight, axisBottomY)
    ctx.stroke()

    ctx.beginPath()
    ctx.moveTo(paddingLeft, paddingTop)
    ctx.lineTo(paddingLeft, axisBottomY)
    ctx.stroke()

    ctx.setFillStyle('#8f8f8f')
    ctx.setFontSize(11)
    ctx.fillText('收益(元)', 8, 16)
    ctx.fillText('日期(MM-DD)', width - 74, height - 10)

    if (!points.length) {
      ctx.setFillStyle('#999999')
      ctx.setFontSize(13)
      ctx.fillText('暂无收益曲线数据', 130, 130)
      ctx.draw()
      return
    }

    const values = points.map(item => Number(item.value) || 0)
    const maxVal = Math.max(...values)
    const minVal = Math.min(...values)
    const span = maxVal === minVal ? Math.max(1, Math.abs(maxVal) * 0.2) : (maxVal - minVal)
    const plotMin = maxVal === minVal ? minVal - span / 2 : minVal
    const plotMax = maxVal === minVal ? maxVal + span / 2 : maxVal
    const plotSpan = plotMax - plotMin

    const yTickCount = 5
    for (let i = 0; i < yTickCount; i++) {
      const ratio = i / (yTickCount - 1)
      const tick = plotMin + (plotSpan * ratio)
      const y = axisBottomY - ratio * chartHeight

      ctx.setStrokeStyle('#f1f1f1')
      ctx.beginPath()
      ctx.moveTo(paddingLeft, y)
      ctx.lineTo(width - paddingRight, y)
      ctx.stroke()

      ctx.setFillStyle('#8d8d8d')
      ctx.setFontSize(10)
      ctx.fillText(tick.toFixed(0), 10, y + 4)
    }

    const xStep = points.length > 1 ? chartWidth / (points.length - 1) : 0

    ctx.setStrokeStyle('#f6b73c')
    ctx.setLineWidth(2)
    ctx.beginPath()
    points.forEach((point, index) => {
      const x = paddingLeft + xStep * index
      const y = axisBottomY - ((Number(point.value) - plotMin) / plotSpan) * chartHeight
      if (index === 0) {
        ctx.moveTo(x, y)
      } else {
        ctx.lineTo(x, y)
      }
    })
    ctx.stroke()

    points.forEach((point, index) => {
      const x = paddingLeft + xStep * index
      const y = axisBottomY - ((Number(point.value) - plotMin) / plotSpan) * chartHeight
      ctx.setFillStyle('#f6b73c')
      ctx.beginPath()
      ctx.arc(x, y, 3, 0, Math.PI * 2)
      ctx.fill()
    })

    const keyIndices = [...new Set([values.indexOf(maxVal), values.indexOf(minVal), points.length - 1])]
    keyIndices.forEach((idx) => {
      const value = Number(points[idx].value) || 0
      const x = paddingLeft + xStep * idx
      const y = axisBottomY - ((value - plotMin) / plotSpan) * chartHeight
      const textX = Math.max(paddingLeft + 2, Math.min(width - paddingRight - 50, x + 4))
      const textY = Math.max(paddingTop + 10, y - 8)
      ctx.setFillStyle('#d93025')
      ctx.setFontSize(11)
      ctx.fillText(value.toFixed(2), textX, textY)
    })

    const labelIndices = points.length <= 4
      ? points.map((_, index) => index)
      : [0, Math.floor((points.length - 1) / 3), Math.floor((points.length - 1) * 2 / 3), points.length - 1]
    const formatDate = (raw) => String(raw || '').slice(5, 10)

    labelIndices.forEach((idx, order) => {
      const x = paddingLeft + xStep * idx
      const label = formatDate(points[idx].label)
      let textX = x - 16
      if (order === 0) textX = paddingLeft - 14
      if (order === labelIndices.length - 1) textX = Math.min(width - paddingRight - 34, x - 20)
      ctx.setFillStyle('#999999')
      ctx.setFontSize(10)
      ctx.fillText(label, textX, height - 14)
    })

    ctx.draw()
  },

  onUserActions() {
    wx.showActionSheet({
      itemList: ['退出登录', '清除当前用户数据'],
      success: (res) => {
        if (res.tapIndex === 0) {
          this.onLogout()
          return
        }
        if (res.tapIndex === 1) {
          this.onClearData()
        }
      }
    })
  },

  onClearData() {
    wx.showModal({
      title: '警示',
      content: '确定要清除当前账号的所有交易数据吗？此操作不可恢复。',
      success: async (res) => {
        if (res.confirm) {
          const result = await storage.clearTransactionsAsync()
          if (!result.success) {
            wx.showToast({ title: result.message || '清空失败，请重试', icon: 'none' })
            return
          }
          this.refreshPage()
          wx.showToast({ title: '数据已清除', icon: 'success' })
        }
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

  onGoWedding() {
    wx.navigateTo({ url: '/pages/wedding/wedding' })
  },

  onGoSelector() {
    wx.navigateTo({ url: '/pages/portal/portal' })
  },

  /**
   * 启动自动更新（仅模拟器，每2秒刷新）
   */
  startAutoUpdate() {
    // 清除可能存在的旧定时器
    this.stopAutoUpdate()
    this.setData({ simulatorPaused: false })
    
    // 立即执行一次
    this.fetchGoldPrice(true, 'simulator')
    
    // 设置定时器，每2秒刷新一次
    const timer = setInterval(() => {
      this.fetchGoldPrice(true, 'simulator')
    }, 2000)
    
    // 设置倒计时定时器，每秒更新一次
    this.setData({ countdown: 2 })
    const countdownTimer = setInterval(() => {
      let countdown = this.data.countdown - 1
      if (countdown < 0) {
        countdown = 2
      }
      this.setData({ countdown })
    }, 1000)
    
    this.setData({
      priceUpdateTimer: timer,
      countdownTimer: countdownTimer
    })
  },

  /**
   * 停止自动更新
   */
  stopAutoUpdate() {
    if (this.data.priceUpdateTimer) {
      clearInterval(this.data.priceUpdateTimer)
      this.setData({
        priceUpdateTimer: null
      })
    }
    if (this.data.countdownTimer) {
      clearInterval(this.data.countdownTimer)
      this.setData({
        countdownTimer: null,
        countdown: 2
      })
    }
  },

  /**
   * 获取实时金价
   */
  fetchGoldPrice(isAutoRefresh = false, preferredSource) {
    if (isAutoRefresh && !this.data.autoUpdateMode) {
      return
    }

    if (isAutoRefresh && this.data.simulatorPaused) {
      return
    }

    if (this.data.isUpdating) {
      return
    }
    
    this.setData({ isUpdating: true })
    
    const selectedSource = preferredSource || 'simulator'
    
    goldPrice.getCurrentGoldPrice(false, selectedSource)
      .then(result => {
        const now = new Date()
        const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`
        
        // 判断是否使用模拟器
        const isSimulator = result.source === 'simulator'
        const sourceText = this.getSourceText(result.source)
        
        // 优先使用数据层返回的动态国际金价与汇率
        const internationalPrice = result.internationalPrice || ''
        const exchangeRate = (typeof result.fxRate === 'number' && result.fxRate > 0)
          ? `汇率 ${result.fxRate.toFixed(6)}`
          : ''
        const fxMeta = this.buildFxMetaText(result.fxSource, result.fxTimestamp)
        
        this.setData({
          currentPrice: result.price.toFixed(2),
          lastUpdateTime: timeStr,
          priceSource: sourceText,
          usingSimulator: isSimulator,
          isUpdating: false,
          countdown: 2,
          internationalPrice,
          exchangeRate,
          fxMeta
        })

        if (result.fallbackFrom === 'qveris' && !isAutoRefresh) {
          wx.showToast({
            title: 'Qveris暂不可用，已切到模拟器',
            icon: 'none'
          })
        }
        
        // 更新收益计算
        this.loadHoldings()
        
        // 如果首次使用模拟器，提示用户
        if (isSimulator && !this.data.hasShownSimulatorTip) {
          this.data.hasShownSimulatorTip = true
        }
      })
      .catch(error => {
        console.error('获取金价失败:', error)
        this.setData({ 
          isUpdating: false,
          lastUpdateTime: '获取失败'
        })
        
        // 自动刷新失败时，3秒后重试
        if (isAutoRefresh) {
          console.log(`${selectedSource} 失败，3秒后重试...`)
          setTimeout(() => {
            if (this.data.autoUpdateMode && !this.data.simulatorPaused) {
              this.fetchGoldPrice(true, 'simulator')
            }
          }, 3000)
        }
      })
  },

  /**
   * 获取数据源文本
   */
  getSourceText(source) {
    const sourceMap = {
      'qveris': 'Qveris',
      'simulator': '智能模拟'
    }
    return sourceMap[source] || source
  },

  buildFxMetaText(fxSource, fxTimestamp) {
    if (!fxSource && !fxTimestamp) {
      return ''
    }

    const sourceTextMap = {
      realtime: '实时汇率',
      cache: '缓存汇率',
      fallback: '默认汇率'
    }

    const sourceText = sourceTextMap[fxSource] || '汇率'
    if (!fxTimestamp) {
      return sourceText
    }

    const date = new Date(fxTimestamp)
    if (Number.isNaN(date.getTime())) {
      return sourceText
    }

    const timeText = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}:${String(date.getSeconds()).padStart(2, '0')}`
    return `${sourceText} ${timeText}`
  },

  /**
   * 显示配置说明
   */
  showConfigGuide() {
    const config = goldPrice.getConfigSuggestion()
    const content = [config.problem, '', ...config.solutions].join('\n')
    
    wx.showModal({
      title: config.title,
      content: content,
      confirmText: '我知道了',
      showCancel: false
    })
  }
})
