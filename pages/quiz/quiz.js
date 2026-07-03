const auth = require('../../utils/auth')
const quiz = require('../../utils/quiz')
const storage = require('../../utils/storage')

Page({
  data: {
    user: null,
    rounds: [],
    dateOptions: [],
    selectedDate: 'all',
    currentRoundIndex: 0,
    currentMatches: [],
    predictionMap: {},
    myPredictions: [],
    myPredictionsTitle: '我的预测',
    userStats: null,
    myPool: null,
    viewMode: 'upcoming',
    roundSummaryText: '',
    lastRefreshedText: '',
    loginLoading: false
  },

  onShow: function() {
    var user = auth.ensureLogin()
    if (user) { this.setData({ user: user }); this.loadPage() }
  },

  onPullDownRefresh: function() {
    this.loadPage({ resetSchedule: true, fromPullDown: true })
  },

  onViewModeTap: function(e) {
    var mode = e.currentTarget.dataset.mode || 'upcoming'
    if (mode === this.data.viewMode) return
    this.setData({ viewMode: mode, selectedDate: 'all', currentRoundIndex: 0 })
    this.loadPage()
  },

  loadPage: function(options) {
    options = options || {}
    var user = this.data.user
    if (!user) return
    if (options.resetSchedule) {
      quiz.refreshScheduleData()
    }
    quiz.applyDailyRelief(user.id)

    var rounds = quiz.getMatchesByRound()
    var dateMap = {}
    var predictionMap = {}
    var predictions = quiz.getPredictions(user.id)
    for (var i = 0; i < predictions.length; i++)
      predictionMap[predictions[i].matchId] = predictions[i]

    // Enrich matches with team names and dynamic odds
    var enriched = []
    for (var r = 0; r < rounds.length; r++) {
      var rc = { key: rounds[r].key, name: rounds[r].name, matches: [] }
      for (var m = 0; m < rounds[r].matches.length; m++) {
        var match = rounds[r].matches[m]
        var visible = this.shouldShowMatch(match)
        if (!visible) continue
        dateMap[match.matchDate] = true
        var market = quiz.getMatchMarketSnapshot(match.id)
        var odds = quiz.getMatchOdds(match)
        rc.matches.push({
          id: match.id, round: match.round,
          teamA: match.teamA, teamB: match.teamB,
          teamA_name: match.isPlaceholder ? '\u5f85\u5b9a' : (quiz.getTeamName(match.teamA) || match.teamA || '\u5f85\u5b9a'),
          teamB_name: match.isPlaceholder ? '\u5f85\u5b9a' : (quiz.getTeamName(match.teamB) || match.teamB || '\u5f85\u5b9a'),
          teamA_flag: '',
          teamB_flag: '',
          matchDate: match.matchDate, matchTime: match.matchTime,
          venue: match.venue, status: match.status,
          scoreA: match.scoreA, scoreB: match.scoreB,
          scoreAPenalty: match.scoreAPenalty, scoreBPenalty: match.scoreBPenalty,
          isKnockout: match.isKnockout, stage: match.stage,
          isPlaceholder: match.isPlaceholder || false,
          odds: odds,
          marketParticipants: market.participants || 0,
          teamA_label: match.isPlaceholder ? '\u5f85\u5b9a' : (quiz.getTeamName(match.teamA) || match.teamA || '\u5f85\u5b9a'),
          teamB_label: match.isPlaceholder ? '\u5f85\u5b9a' : (quiz.getTeamName(match.teamB) || match.teamB || '\u5f85\u5b9a')
        })
      }
      if (rc.matches.length > 0) enriched.push(rc)
    }

    var dateOptions = [{ value: 'all', label: '全部' }]
    var dateKeys = Object.keys(dateMap).sort()
    for (var d = 0; d < dateKeys.length; d++) {
      dateOptions.push({ value: dateKeys[d], label: dateKeys[d].slice(5).replace('-', '/') })
    }

    var userStats = quiz.calculateUserStats(user.id)
    var myPool = quiz.getUserPool(user.id)
    var scheduleSnapshot = quiz.getScheduleMaintenanceSnapshot()
    var currentRoundIndex = Math.min(this.data.currentRoundIndex, Math.max(enriched.length - 1, 0))
    var currentMatches = this.filterRoundMatches(enriched[currentRoundIndex], this.data.selectedDate)
    var roundSummaryText = this.data.viewMode === 'history' ? '历史赛程' : '未来赛程'
    var lastRefreshedText = '已刷新：' + quiz.getBeijingDateString()
    if (scheduleSnapshot && scheduleSnapshot.active && scheduleSnapshot.active.version) {
      lastRefreshedText += ' · 赛程 ' + scheduleSnapshot.active.version
    }
    var myPredictionsTitle = this.data.viewMode === 'history' ? '我的历史竞猜' : '我的预测'

    // Build my predictions list
    var myPreds = []
    for (var i = 0; i < predictions.length; i++) {
      var p = predictions[i]
      if (this.data.viewMode === 'history' && p.status !== 'scored') continue
      var match = quiz.getMatchById(p.matchId)
      if (!match) continue
      myPreds.push({
        id: p.id, matchId: p.matchId,
        matchName: (match.isPlaceholder ? '\u5f85\u5b9a' : (quiz.getTeamName(match.teamA) || match.teamA || '\u5f85\u5b9a'))
          + ' vs ' + (match.isPlaceholder ? '\u5f85\u5b9a' : (quiz.getTeamName(match.teamB) || match.teamB || '\u5f85\u5b9a')),
        teamAName: match.isPlaceholder ? '\u5f85\u5b9a' : (quiz.getTeamName(match.teamA) || match.teamA || '\u5f85\u5b9a'),
        teamBName: match.isPlaceholder ? '\u5f85\u5b9a' : (quiz.getTeamName(match.teamB) || match.teamB || '\u5f85\u5b9a'),
        predictedWinner: p.predictedWinner,
        predictedScoreA: p.predictedScoreA, predictedScoreB: p.predictedScoreB,
        stakePoints: p.stakePoints || 0,
        status: p.status, points: p.points || { total: 0 },
        payout: p.payout || null
      })
    }

    this.setData({
      rounds: enriched, dateOptions: dateOptions, currentMatches: currentMatches,
      predictionMap: predictionMap, myPredictions: myPreds,
      myPredictionsTitle: myPredictionsTitle,
      userStats: userStats, myPool: myPool,
      roundSummaryText: roundSummaryText, lastRefreshedText: lastRefreshedText
    })

    if (options.fromPullDown) {
      wx.stopPullDownRefresh()
    }
  },

  getTeamLabel: function(teamName, teamCode, isPlaceholder) {
    if (isPlaceholder) return '\u5f85\u5b9a'
    return teamName || teamCode || '\u5f85\u5b9a'
  },

  shouldShowMatch: function(match) {
    if (!match) return false
    if (this.data.viewMode === 'history') return match.status === 'finished'
    return match.status === 'scheduled' || match.status === 'live'
  },

  filterRoundMatches: function(round, selectedDate) {
    if (!round || !round.matches) return []
    var matches = []
    for (var i = 0; i < round.matches.length; i++) {
      var match = round.matches[i]
      if (selectedDate === 'all' || match.matchDate === selectedDate) {
        matches.push(match)
      }
    }
    return matches
  },

  onDateTabTap: function(e) {
    var date = e.currentTarget.dataset.date || 'all'
    if (date === this.data.selectedDate) return
    var currentRound = this.data.rounds[this.data.currentRoundIndex] || null
    var currentMatches = this.filterRoundMatches(currentRound, date)
    this.setData({ selectedDate: date, currentMatches: currentMatches })
  },

  onRoundTabTap: function(e) {
    var idx = parseInt(e.currentTarget.dataset.index, 10)
    if (isNaN(idx)) return
    var rounds = this.data.rounds
    if (idx < 0 || idx >= rounds.length) return
    var matches = this.filterRoundMatches(rounds[idx], this.data.selectedDate)
    this.setData({ currentRoundIndex: idx, currentMatches: matches })
  },

  onMatchTap: function(e) {
    var mid = e.detail.matchId
    if (!mid) return
    var match = quiz.getMatchById(mid)
    if (!match) return
    if (match.status === 'finished') { this.showMatchResult(mid); return }
    if (match.status === 'live') { wx.showToast({ title: '\u6bd4\u8d5b\u8fdb\u884c\u4e2d', icon: 'none' }); return }
    wx.navigateTo({ url: '/pages/quiz/quizPredict?matchId=' + mid })
  },

  onMatchLongPress: function(e) {
    var mid = e.detail.matchId
    if (!mid) return
    var user = this.data.user
    if (!user) return
    var self = this
    wx./* 暂无原生API */showModal({
      title: '\u8d5b\u679c\u7ba1\u7406',
      message: '\u8f93\u5165\u6bd4\u5206\u683c\u5f0f: \u4e3b\u961f\u6bd4\u5206,\u5ba2\u961f\u6bd4\u5206 (\u4f8b: 2,1)',
      success: function(res) {
        var val = String(res.value || '').trim()
        var parts = val.split(',')
        if (parts.length !== 2) { wx.showToast({ title: '\u683c\u5f0f\u9519\u8bef\uff0c\u793a\u4f8b: 2,1', icon: 'none' }); return }
        var sa = parseInt(parts[0], 10)
        var sb = parseInt(parts[1], 10)
        if (isNaN(sa) || isNaN(sb) || sa < 0 || sb < 0) {
          wx.showToast({ title: '\u8bf7\u8f93\u5165\u6709\u6548\u6b63\u6574\u6570', icon: 'none' }); return
        }
        var r = quiz.setMatchResult(mid, sa, sb, user.id)
        if (r.success) {
          wx.showToast({ title: '\u8d5b\u679c\u5df2\u4fdd\u5b58', icon: 'success' })
          self.loadPage()
        } else {
          wx.showToast({ title: r.message || '\u4fdd\u5b58\u5931\u8d25', icon: 'none' })
        }
      }
    })
  },

  showMatchResult: function(matchId) {
    var prediction = quiz.getPredictionByMatch(matchId, this.data.user.id)
    var match = quiz.getMatchById(matchId)
    if (!match) return

    var tA = match.isPlaceholder ? '\u5f85\u5b9a' : quiz.getTeamName(match.teamA)
    var tB = match.isPlaceholder ? '\u5f85\u5b9a' : quiz.getTeamName(match.teamB)
    var sA = match.scoreA != null ? match.scoreA : '?'
    var sB = match.scoreB != null ? match.scoreB : '?'

    var lines = [tA + ' ' + sA + ' - ' + sB + ' ' + tB]
    if (match.scoreAPenalty != null)
      lines.push('\u70b9\u7403 ' + match.scoreAPenalty + '-' + match.scoreBPenalty)

    if (prediction) {
      var wName = prediction.predictedWinner === 'teamA' ? tA
        : prediction.predictedWinner === 'teamB' ? tB : '\u5e73\u5c40'
      lines.push('\n\u4f60\u7684\u9884\u6d4b: ' + wName)
      if (prediction.predictedScoreA != null)
        lines.push('\u6bd4\u5206 ' + prediction.predictedScoreA + '-' + prediction.predictedScoreB)
      if (prediction.stakePoints > 0)
        lines.push('\u4e0b\u6ce8: ' + prediction.stakePoints + '\u5206')
      if (prediction.points)
        lines.push('\u7ade\u731c\u79ef\u5206: ' + (prediction.points.total || 0) + '\u5206')
      if (prediction.payout)
        lines.push('\u4e0b\u6ce8\u76c8\u4e8f: ' + (prediction.payout.profit >= 0 ? '+' : '') + prediction.payout.profit)
    } else {
      lines.push('\n\u672a\u9884\u6d4b')
    }

    wx.showModal({ title: '\u8d5b\u679c', content: lines.join('\n'), showCancel: false })
  },

  onGoLeaderboard: function() {
    wx.navigateTo({ url: '/pages/quiz/quizLeaderboard' })
  },

  onGoScheduleAdmin: function() {
    wx.navigateTo({ url: '/pages/quiz/quizManage' })
  },

  onGoMyPredictions: function() {
    var preds = this.data.myPredictions
    if (preds.length === 0) { wx.showToast({ title: '\u6682\u65e0\u9884\u6d4b\u8bb0\u5f55', icon: 'none' }); return }
    var stats = this.data.userStats
    var lines = ['\u5171\u9884\u6d4b ' + stats.totalPredictions + '\u573a, \u547d\u4e2d ' + stats.correctPredictions + '\u573a']
    lines.push('\u7ade\u731c\u79ef\u5206: ' + stats.totalPoints)
    lines.push('\u547d\u4e2d\u7387: ' + stats.accuracy + '%')
    if (stats.totalBets > 0) {
      lines.push('\u4e0b\u6ce8 ' + stats.totalBets + '\u6b21, \u76c8\u4e8f: ' + (stats.totalBetProfit >= 0 ? '+' : '') + stats.totalBetProfit)
    }
    wx.showModal({ title: '\u6211\u7684\u7edf\u8ba1', content: lines.join('\n'), showCancel: false })
  }
})
