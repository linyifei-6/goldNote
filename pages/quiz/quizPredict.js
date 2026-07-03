const auth = require('../../utils/auth')
const quiz = require('../../utils/quiz')

Page({
  data: {
    match: null,
    matchId: '',
    teamA: '',
    teamB: '',
    flagA: '',
    flagB: '',
    odds: null,
    allowDraw: true,
    marketSnapshot: null,
    marketText: '',
    selectedOdds: 0,
    scoreMult: 1.0,
    potentialReturnText: '0',
    netProfitText: '0',
    prediction: { predictedWinner: '', predictedScoreA: '', predictedScoreB: '' },
    pool: null,
    maxBet: 0,
    stakeValue: 0,
    expectedReturn: 0,
    existingPrediction: null,
    submitting: false,
    isEdit: false
  },

  onLoad: function(options) {
    var matchId = options.matchId || ''
    if (!matchId) { this.showErrorAndBack('参数错误'); return }

    var match = quiz.getMatchById(matchId)
    if (!match) { this.showErrorAndBack('比赛不存在'); return }
    if (match.status !== 'scheduled') { this.showErrorAndBack('比赛已开始或已结束'); return }

    var user = auth.ensureLogin()
    if (!user) return

    var teamA = match.isPlaceholder ? '待定' : quiz.getTeamName(match.teamA)
    var teamB = match.isPlaceholder ? '待定' : quiz.getTeamName(match.teamB)
    var flagA = ''
    var flagB = ''
    var odds = match.odds || quiz.getMatchOdds(match)
    var marketSnapshot = quiz.getMatchMarketSnapshot(matchId)
    var allowDraw = !match.isKnockout && odds.draw > 0
    var marketText = marketSnapshot.participants > 0 ? '当前已有 ' + marketSnapshot.participants + ' 人参与竞猜' : '当前暂无参与竞猜'

    var pool = quiz.getUserPool(user.id)
    var available = pool.totalPoints - pool.lockedInBets
    var maxBet = Math.floor(Math.min(available, pool.totalPoints * 0.5) / 10) * 10

    var existing = quiz.getPredictionByMatch(matchId, user.id)
    var isEdit = !!existing
    var predForm = { predictedWinner: '', predictedScoreA: '', predictedScoreB: '' }
    var stakeValue = 0
    var selectedOdds = 0

    if (existing) {
      predForm.predictedWinner = existing.predictedWinner
      predForm.predictedScoreA = existing.predictedScoreA != null ? String(existing.predictedScoreA) : ''
      predForm.predictedScoreB = existing.predictedScoreB != null ? String(existing.predictedScoreB) : ''
      stakeValue = existing.stakePoints || 0

      var baseOdds = existing.oddsAtPrediction || odds
      if (existing.predictedWinner === 'teamA') selectedOdds = baseOdds.teamA || 0
      else if (existing.predictedWinner === 'teamB') selectedOdds = baseOdds.teamB || 0
      else if (existing.predictedWinner === 'draw') selectedOdds = baseOdds.draw || 0
    }

    this.setData({
      match: match,
      matchId: matchId,
      teamA: teamA, teamB: teamB, flagA: flagA, flagB: flagB,
      odds: odds, allowDraw: allowDraw, marketSnapshot: marketSnapshot, marketText: marketText, pool: pool, maxBet: Math.max(maxBet, 0),
      prediction: predForm, stakeValue: stakeValue, selectedOdds: selectedOdds,
      existingPrediction: existing, isEdit: isEdit
    })
    this.calcSummary()
  },

  showErrorAndBack: function(msg) {
    wx.showToast({ title: msg, icon: 'none' })
    setTimeout(function() { wx.navigateBack() }, 1500)
  },

  selectWinner: function(e) {
    var winner = e.currentTarget.dataset.winner
    if (winner === 'draw' && !this.data.allowDraw) return
    var odds = this.data.odds
    var selectedOdds = 0
    if (winner === 'teamA') selectedOdds = odds.teamA
    else if (winner === 'teamB') selectedOdds = odds.teamB
    else if (winner === 'draw') selectedOdds = odds.draw
    this.setData({ 'prediction.predictedWinner': winner, selectedOdds: selectedOdds })
    this.calcSummary()
  },

  onScoreAInput: function(e) {
    this.setData({ 'prediction.predictedScoreA': e.detail.value })
    this.calcSummary()
  },

  onScoreBInput: function(e) {
    this.setData({ 'prediction.predictedScoreB': e.detail.value })
    this.calcSummary()
  },

  onStakeChange: function(e) {
    this.setData({ stakeValue: parseInt(e.detail.value, 10) || 0 })
    this.calcSummary()
  },

  calcSummary: function() {
    var stake = this.data.stakeValue || 0
    var odds = this.data.selectedOdds || 0
    var sa = this.data.prediction.predictedScoreA
    var sb = this.data.prediction.predictedScoreB
    var mult = 1.0
    if (sa !== '' && sb !== '') {
      var a = parseInt(sa, 10); var b = parseInt(sb, 10)
      if (!isNaN(a) && !isNaN(b)) mult = 1.2
    }
    var expRet = stake > 0 && odds > 0 ? Math.round(stake * odds * mult * 100) / 100 : 0
    var netProfit = expRet > 0 ? Math.max(0, Math.round((expRet - stake) * 100) / 100) : 0
    this.setData({
      scoreMult: mult,
      expectedReturn: expRet,
      potentialReturnText: stake > 0 && odds > 0 ? String(Math.round(stake * odds * 100) / 100) : '0',
      netProfitText: String(netProfit)
    })
  },

  submitPrediction: function() {
    if (this.data.submitting) return
    var winner = this.data.prediction.predictedWinner
    if (!winner) { wx.showToast({ title: '请选择胜方', icon: 'none' }); return }

    var user = auth.ensureLogin()
    if (!user) return

    var self = this
    var sa = this.data.prediction.predictedScoreA
    var sb = this.data.prediction.predictedScoreB
    var stake = this.data.stakeValue || 0
    var match = this.data.match
    var tA = this.data.teamA
    var tB = this.data.teamB
    var wName = winner === 'teamA' ? tA : winner === 'teamB' ? tB : '平局'

    var msg = tA + ' vs ' + tB + '\n预测: ' + wName
    if (sa !== '' && sb !== '') msg += ' ' + sa + '-' + sb
    if (stake > 0) msg += '\n下注: ' + stake + '分\n预期回报: ' + this.data.expectedReturn + '分'
    if (this.data.isEdit) msg += '\n(\u5c06覆盖原预测)'

    wx.showModal({
      title: '确认预测', content: msg,
      success: function(res) {
        if (!res.confirm) return
        self.setData({ submitting: true })
        // If edit: delete old prediction first
        if (self.data.isEdit && self.data.existingPrediction) {
          var preds = quiz.getPredictions(user.id)
          var filtered = []
          for (var i = 0; i < preds.length; i++) {
            if (preds[i].matchId !== self.data.matchId) filtered.push(preds[i])
          }
          quiz.savePredictions(user.id, filtered)
          // Unlock bet points
          var oldStake = self.data.existingPrediction.stakePoints || 0
          if (oldStake > 0) {
            var pool = quiz.getUserPool(user.id)
            pool.lockedInBets = Math.max(0, (pool.lockedInBets || 0) - oldStake)
            var pools = {}
            var key = 'quiz_user_pool'
            try { pools = wx.getStorageSync(key) || {} } catch(e) {}
            pools[user.id] = pool
            wx.setStorageSync(key, pools)
          }
        }
        self.doSavePrediction(user)
      }
    })
  },

  doSavePrediction: function(user) {
    var sa = this.data.prediction.predictedScoreA
    var sb = this.data.prediction.predictedScoreB
    var input = { predictedWinner: this.data.prediction.predictedWinner, stakePoints: this.data.stakeValue || 0 }
    if (sa !== '' && sb !== '') {
      input.predictedScoreA = parseInt(sa, 10) || 0
      input.predictedScoreB = parseInt(sb, 10) || 0
    }
    var result = quiz.createPrediction(this.data.matchId, input, user.id)
    if (!result.success) {
      wx.showToast({ title: result.message || '提交失败', icon: 'none' })
      this.setData({ submitting: false })
      return
    }
    wx.showToast({ title: '预测成功', icon: 'success' })
    setTimeout(function() { wx.navigateBack() }, 1000)
  }
})
