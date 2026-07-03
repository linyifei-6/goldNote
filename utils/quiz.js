const STORAGE = require('./storage')

// ===== Storage Keys =====
const PREDICTION_PREFIX = 'quiz_predictions_'
const MATCH_RESULTS_KEY = 'quiz_match_results'
const LEADERBOARD_CACHE_KEY = 'quiz_leaderboard_cache'
const USER_POOL_KEY = 'quiz_user_pool'
const SCHEDULE_CACHE_KEY = 'quiz_schedule_cache'
const SCHEDULE_DRAFT_KEY = 'quiz_schedule_draft'
const SCHEDULE_META_KEY = 'quiz_schedule_meta'
const SCHEDULE_SOURCE_KEY = 'quiz_schedule_source_url'
const RELIEF_DATE_KEY = 'quiz_last_relief_date'

// ===== Constants =====
const INITIAL_POOL = 1000
const MIN_BET = 10
const MAX_BET_RATIO = 0.5
const RELIEF_THRESHOLD = 100
const RELIEF_AMOUNT = 200
const HOUSE_EDGE = 0.92
const MAX_ODDS = 20.00

// ===== Team Lookup =====
let _allMatches = null
let _teamMap = null

function cloneValue(value) {
  if (value == null) return value
  try {
    return JSON.parse(JSON.stringify(value))
  } catch (e) {
    return value
  }
}

function getScheduleBundle() {
  try {
    if (wx && wx.getFileSystemManager) {
      var fs = wx.getFileSystemManager()
      var raw = fs.readFileSync('/data/worldcup_2026.json', 'utf8')
      if (raw) {
        return JSON.parse(raw)
      }
    }
  } catch (e) {
    console.warn('Read bundled schedule failed:', e)
  }
  return { teams: [], rounds: [] }
}

function countScheduleMatches(data) {
  var total = 0
  if (!data || !Array.isArray(data.rounds)) return total
  for (var i = 0; i < data.rounds.length; i++) {
    var round = data.rounds[i]
    total += Array.isArray(round.matches) ? round.matches.length : 0
  }
  return total
}

function buildScheduleMeta(data, extra) {
  var meta = extra || {}
  var dataMeta = data && data.meta ? data.meta : {}
  return {
    version: String(data && data.version ? data.version : '1.0.0'),
    updatedAt: String(data && data.updatedAt ? data.updatedAt : getBeijingDateString()),
    sourceUrl: String(meta.sourceUrl || dataMeta.sourceUrl || ''),
    sourceName: String(meta.sourceName || dataMeta.sourceName || ''),
    publishedAt: String(meta.publishedAt || dataMeta.publishedAt || ''),
    importedAt: String(meta.importedAt || dataMeta.importedAt || ''),
    roundCount: Array.isArray(data && data.rounds) ? data.rounds.length : 0,
    matchCount: countScheduleMatches(data),
    note: String(meta.note || dataMeta.note || '')
  }
}

function normalizeScheduleData(data, meta) {
  var next = cloneValue(data)
  if (!next || !Array.isArray(next.teams) || !Array.isArray(next.rounds)) return null
  next.version = String(next.version || '1.0.0')
  next.updatedAt = String(next.updatedAt || getBeijingDateString())
  next.teams = next.teams.map(function(team) {
    return cloneValue(team) || team
  })
  next.rounds = next.rounds.map(function(round) {
    var nextRound = cloneValue(round) || round
    nextRound.matches = Array.isArray(round.matches) ? round.matches.map(function(match) {
      var nextMatch = cloneValue(match) || match
      if (nextMatch.status !== 'scheduled' && nextMatch.status !== 'live' && nextMatch.status !== 'finished') {
        nextMatch.status = 'scheduled'
      }
      if (typeof nextMatch.isPlaceholder !== 'boolean') {
        nextMatch.isPlaceholder = !!nextMatch.isPlaceholder
      }
      return nextMatch
    }) : []
    return nextRound
  })
  next.meta = buildScheduleMeta(next, meta || (next.meta || {}))
  return next
}

function hydrateScheduleWithResults(data) {
  if (!data || !Array.isArray(data.rounds)) return data
  var results = getMatchResults()
  for (var r = 0; r < data.rounds.length; r++) {
    var round = data.rounds[r]
    if (!round || !Array.isArray(round.matches)) continue
    for (var m = 0; m < round.matches.length; m++) {
      var match = round.matches[m]
      if (!match || !match.id) continue
      var result = results[match.id]
      if (!result) continue
      match.scoreA = result.scoreA
      match.scoreB = result.scoreB
      match.status = 'finished'
    }
  }
  return data
}

function readStoredSchedule(key) {
  try {
    var data = wx.getStorageSync(key)
    if (data && data.teams && data.rounds) return hydrateScheduleWithResults(normalizeScheduleData(data, data.meta || {}))
  } catch (e) {}
  return null
}

function saveStoredSchedule(key, data, meta) {
  var normalized = normalizeScheduleData(data, meta)
  if (!normalized) return null
  normalized = hydrateScheduleWithResults(normalized)
  wx.setStorageSync(key, normalized)
  return normalized
}

function getStoredScheduleSourceUrl() {
  try {
    return String(wx.getStorageSync(SCHEDULE_SOURCE_KEY) || '')
  } catch (e) {
    return ''
  }
}

function setStoredScheduleSourceUrl(url) {
  try {
    wx.setStorageSync(SCHEDULE_SOURCE_KEY, String(url || ''))
  } catch (e) {}
}

function extractSchedulePayload(payload) {
  if (!payload) return null
  if (payload.teams && payload.rounds) return payload
  if (payload.data && payload.data.teams && payload.data.rounds) return payload.data
  if (payload.result && payload.result.teams && payload.result.rounds) return payload.result
  return null
}

function requestJson(url) {
  return new Promise(function(resolve, reject) {
    if (!url) {
      reject(new Error('赛程地址不能为空'))
      return
    }
    wx.request({
      url: url,
      method: 'GET',
      success: function(res) {
        var payload = res ? res.data : null
        if (typeof payload === 'string') {
          try {
            payload = JSON.parse(payload)
          } catch (e) {
            reject(new Error('赛程返回内容不是有效JSON'))
            return
          }
        }
        resolve(payload)
      },
      fail: function(err) {
        reject(err || new Error('请求赛程失败'))
      }
    })
  })
}

function getTeamMap() {
  if (_teamMap) return _teamMap
  _teamMap = {}
  const data = getAllMatchData()
  ;(data.teams || []).forEach(function(t) {
    _teamMap[t.id] = t
  })
  return _teamMap
}

// ===== Match Data =====
function getAllMatchData() {
  if (_allMatches) return _allMatches
  try {
    var cached = readStoredSchedule(SCHEDULE_CACHE_KEY)
    if (cached) {
      _allMatches = cached
      return _allMatches
    }
    _allMatches = hydrateScheduleWithResults(normalizeScheduleData(getScheduleBundle(), {}))
    return _allMatches
  } catch (e) {
    console.warn('Cannot load match data:', e)
    return { teams: [], rounds: [] }
  }
}

function setAllMatchData(data) {
  var normalized = saveStoredSchedule(SCHEDULE_CACHE_KEY, data, data && data.meta ? data.meta : {})
  if (!normalized) return null
  _allMatches = normalized
  saveScheduleMeta(normalized.meta || buildScheduleMeta(normalized, {}))
  return normalized
}

function saveScheduleDraft(data, meta) {
  var normalized = saveStoredSchedule(SCHEDULE_DRAFT_KEY, data, meta || {})
  if (!normalized) return false
  if (meta && meta.sourceUrl) setStoredScheduleSourceUrl(meta.sourceUrl)
  return true
}

function getScheduleDraft() {
  return readStoredSchedule(SCHEDULE_DRAFT_KEY)
}

function getScheduleMeta() {
  try {
    var meta = wx.getStorageSync(SCHEDULE_META_KEY)
    return meta && typeof meta === 'object' ? meta : buildScheduleMeta(getAllMatchData(), {})
  } catch (e) {
    return buildScheduleMeta(getAllMatchData(), {})
  }
}

function saveScheduleMeta(meta) {
  try {
    wx.setStorageSync(SCHEDULE_META_KEY, meta || {})
  } catch (e) {}
}

function resetScheduleCache() {
  _allMatches = null
  try {
    wx.removeStorageSync(SCHEDULE_CACHE_KEY)
  } catch (e) {}
}

function restoreBundledSchedule() {
  _allMatches = null
  try {
    wx.removeStorageSync(SCHEDULE_CACHE_KEY)
    wx.removeStorageSync(SCHEDULE_DRAFT_KEY)
    wx.removeStorageSync(SCHEDULE_META_KEY)
    wx.removeStorageSync(SCHEDULE_SOURCE_KEY)
  } catch (e) {}
  return setAllMatchData(getScheduleBundle())
}

function getAllMatches() {
  const data = getAllMatchData()
  var list = []
  ;(data.rounds || []).forEach(function(r) {
    ;(r.matches || []).forEach(function(m) {
      list.push(m)
    })
  })
  return list
}

function getMatchesByRound() {
  return getAllMatchData().rounds || []
}

function getMatchById(matchId) {
  var list = getAllMatches()
  for (var i = 0; i < list.length; i++) {
    if (list[i].id === matchId) return list[i]
  }
  return null
}

function getTeamName(teamId) {
  var map = getTeamMap()
  var t = map[teamId]
  return t ? t.name : teamId
}

function getTeamFlag(teamId) {
  var map = getTeamMap()
  var t = map[teamId]
  return t ? t.flag : ''
}

function getTeamRanking(teamId) {
  var map = getTeamMap()
  var t = map[teamId]
  return t ? t.fifaRanking : 50
}

// ===== Odds Calculation =====
function calculateOdds(teamARanking, teamBRanking, stage, isKnockout) {
  var strA = Math.max(1, 210 - teamARanking)
  var strB = Math.max(1, 210 - teamBRanking)
  var df = 0.22
  if (stage === 'quarter' || stage === 'round_16' || stage === 'round_32') {
    df = 0.15
  } else if (stage === 'semi' || stage === 'final' || stage === 'third') {
    df = 0.10
  }
  if (isKnockout && stage === 'knockout') {
    df = 0.15
  }
  var total = strA + strB
  var nd = 1 - df
  var pa = (strA / total) * nd
  var pb = (strB / total) * nd
  var odA = pa > 0 ? Math.min(HOUSE_EDGE / pa, MAX_ODDS) : 99.99
  var odB = pb > 0 ? Math.min(HOUSE_EDGE / pb, MAX_ODDS) : 99.99
  var odD = df > 0 ? Math.min(HOUSE_EDGE / df, MAX_ODDS) : 0
  return {
    teamA: Math.round(odA * 100) / 100,
    teamB: Math.round(odB * 100) / 100,
    draw: Math.round(odD * 100) / 100
  }
}

function getMatchOdds(match) {
  if (!match) return { teamA: 2.00, teamB: 2.00, draw: 0 }
  if (match.isPlaceholder) return { teamA: 2.00, teamB: 2.00, draw: 0 }

  var baseOdds = match.odds
  if (!baseOdds) {
    var rankA = getTeamRanking(match.teamA)
    var rankB = getTeamRanking(match.teamB)
    baseOdds = calculateOdds(rankA, rankB, match.stage, match.isKnockout)
  }

  if (match.status !== 'scheduled') {
    return baseOdds
  }

  var market = getMatchMarketSnapshot(match.id)
  return blendOddsWithMarket(baseOdds, market, match.isKnockout)
}

function getAllPredictionsForMatch(matchId) {
  var allUsers = STORAGE.getUsers() || []
  var list = []
  for (var i = 0; i < allUsers.length; i++) {
    var userId = allUsers[i] && allUsers[i].id
    if (!userId) continue
    var predictions = getPredictions(userId)
    for (var p = 0; p < predictions.length; p++) {
      if (predictions[p].matchId === matchId) {
        list.push(predictions[p])
      }
    }
  }
  return list
}

function getMatchMarketSnapshot(matchId) {
  var predictions = getAllPredictionsForMatch(matchId)
  var snapshot = {
    participants: predictions.length,
    stakeTotal: 0,
    teamA: 0,
    teamB: 0,
    draw: 0
  }

  for (var i = 0; i < predictions.length; i++) {
    var pred = predictions[i]
    var stakeWeight = Math.max(1, parseInt(pred.stakePoints, 10) || 0)
    snapshot.stakeTotal += stakeWeight
    if (pred.predictedWinner === 'teamA') snapshot.teamA += stakeWeight
    else if (pred.predictedWinner === 'teamB') snapshot.teamB += stakeWeight
    else snapshot.draw += stakeWeight
  }

  return snapshot
}

function blendOddsWithMarket(baseOdds, market, isKnockout) {
  if (!baseOdds) return { teamA: 2.00, teamB: 2.00, draw: 0 }

  var hasDraw = !isKnockout && baseOdds.draw > 0
  var totalParticipants = market && market.participants ? market.participants : 0
  var crowdFactor = Math.min(0.34, 0.08 + totalParticipants * 0.012)

  var pA = baseOdds.teamA > 0 ? 1 / baseOdds.teamA : 0
  var pB = baseOdds.teamB > 0 ? 1 / baseOdds.teamB : 0
  var pD = hasDraw && baseOdds.draw > 0 ? 1 / baseOdds.draw : 0
  var pSum = pA + pB + pD
  if (pSum <= 0) return baseOdds

  pA = pA / pSum
  pB = pB / pSum
  pD = pD / pSum

  var totalWeight = (market && market.stakeTotal) || 0
  var wA = totalWeight > 0 ? market.teamA / totalWeight : 0
  var wB = totalWeight > 0 ? market.teamB / totalWeight : 0
  var wD = totalWeight > 0 ? market.draw / totalWeight : 0

  var mA = pA * (1 - crowdFactor) + wA * crowdFactor
  var mB = pB * (1 - crowdFactor) + wB * crowdFactor
  var mD = hasDraw ? (pD * (1 - crowdFactor) + wD * crowdFactor) : 0

  var mSum = mA + mB + mD
  if (mSum <= 0) return baseOdds

  mA = mA / mSum
  mB = mB / mSum
  mD = hasDraw ? mD / mSum : 0

  var oddsA = mA > 0 ? Math.min(HOUSE_EDGE / mA, MAX_ODDS) : 99.99
  var oddsB = mB > 0 ? Math.min(HOUSE_EDGE / mB, MAX_ODDS) : 99.99
  var oddsD = hasDraw && mD > 0 ? Math.min(HOUSE_EDGE / mD, MAX_ODDS) : 0

  return {
    teamA: Math.round(oddsA * 100) / 100,
    teamB: Math.round(oddsB * 100) / 100,
    draw: Math.round(oddsD * 100) / 100
  }
}

function refreshScheduleData() {
  _allMatches = null
  return getAllMatchData()
}

function pullLatestScheduleDraft(options) {
  options = options || {}
  var sourceUrl = String(options.sourceUrl || getStoredScheduleSourceUrl() || '')
  var importedAt = new Date().toISOString()
  if (options.rawJson) {
    return new Promise(function(resolve, reject) {
      try {
        var parsed = typeof options.rawJson === 'string' ? JSON.parse(options.rawJson) : options.rawJson
        var payload = extractSchedulePayload(parsed)
        if (!payload) {
          reject(new Error('JSON中缺少 teams 或 rounds'))
          return
        }
        var normalized = normalizeScheduleData(payload, {
          sourceUrl: sourceUrl,
          sourceName: options.sourceName || '手工导入',
          importedAt: importedAt,
          note: options.note || ''
        })
        if (!normalized) {
          reject(new Error('赛程数据格式不正确'))
          return
        }
        saveScheduleDraft(normalized, normalized.meta)
        resolve({ success: true, data: normalized, meta: normalized.meta })
      } catch (e) {
        reject(new Error('JSON解析失败：' + (e && e.message ? e.message : '未知错误')))
      }
    })
  }

  if (!sourceUrl) {
    var bundled = normalizeScheduleData(getScheduleBundle(), {
      sourceName: '内置赛程包',
      importedAt: importedAt,
      note: '未配置远程赛程源，已回退到内置赛程包'
    })
    saveScheduleDraft(bundled, bundled.meta)
    return Promise.resolve({ success: true, data: bundled, meta: bundled.meta })
  }

  return requestJson(sourceUrl).then(function(payload) {
    var extracted = extractSchedulePayload(payload)
    if (!extracted) throw new Error('远程返回中未找到赛程数据')
    var normalized = normalizeScheduleData(extracted, {
      sourceUrl: sourceUrl,
      sourceName: options.sourceName || '远程赛程源',
      importedAt: importedAt,
      note: options.note || ''
    })
    if (!normalized) throw new Error('远程赛程数据格式不正确')
    saveScheduleDraft(normalized, normalized.meta)
    return { success: true, data: normalized, meta: normalized.meta }
  }).catch(function(err) {
    var bundled = normalizeScheduleData(getScheduleBundle(), {
      sourceUrl: sourceUrl,
      sourceName: '内置赛程包',
      importedAt: importedAt,
      note: '远程拉取失败，已回退到内置赛程包'
    })
    saveScheduleDraft(bundled, bundled.meta)
    return {
      success: true,
      fallback: true,
      message: err && err.message ? err.message : '远程拉取失败，已回退到内置赛程包',
      data: bundled,
      meta: bundled.meta
    }
  })
}

function publishScheduleData(data, meta) {
  var payload = data || getScheduleDraft()
  if (!payload) {
    return { success: false, message: '没有可发布的赛程数据' }
  }
  var normalized = setAllMatchData(payload)
  if (!normalized) return { success: false, message: '赛程发布失败' }
  var publishMeta = buildScheduleMeta(normalized, normalized.meta || meta || {})
  publishMeta.publishedAt = new Date().toISOString()
  saveScheduleMeta(publishMeta)
  setStoredScheduleSourceUrl(publishMeta.sourceUrl || getStoredScheduleSourceUrl())
  return { success: true, data: normalized, meta: publishMeta }
}

function getScheduleMaintenanceSnapshot() {
  var active = getAllMatchData()
  var draft = getScheduleDraft()
  var activeMeta = getScheduleMeta()
  var draftMeta = draft && draft.meta ? draft.meta : null
  return {
    sourceUrl: getStoredScheduleSourceUrl(),
    active: {
      version: activeMeta.version || active.version || '1.0.0',
      updatedAt: activeMeta.updatedAt || active.updatedAt || '',
      publishedAt: activeMeta.publishedAt || '',
      sourceName: activeMeta.sourceName || (active.meta && active.meta.sourceName) || '',
      sourceUrl: activeMeta.sourceUrl || (active.meta && active.meta.sourceUrl) || '',
      roundCount: Array.isArray(active.rounds) ? active.rounds.length : 0,
      matchCount: countScheduleMatches(active)
    },
    draft: draft ? {
      version: draftMeta && draftMeta.version ? draftMeta.version : draft.version || '1.0.0',
      updatedAt: draftMeta && draftMeta.updatedAt ? draftMeta.updatedAt : draft.updatedAt || '',
      importedAt: draftMeta && draftMeta.importedAt ? draftMeta.importedAt : '',
      sourceName: draftMeta && draftMeta.sourceName ? draftMeta.sourceName : '',
      sourceUrl: draftMeta && draftMeta.sourceUrl ? draftMeta.sourceUrl : '',
      roundCount: Array.isArray(draft.rounds) ? draft.rounds.length : 0,
      matchCount: countScheduleMatches(draft)
    } : null
  }
}

// ===== Score/Ranking Points Calculation =====
function calculatePredictionPoints(predictedWinner, predictedScoreA, predictedScoreB, actualScoreA, actualScoreB, isKnockout) {
  var winnerPoints = 0
  var scoreBonus = 0

  var actualWinner = 'draw'
  if (actualScoreA > actualScoreB) actualWinner = 'teamA'
  else if (actualScoreB > actualScoreA) actualWinner = 'teamB'

  if (predictedWinner === actualWinner) {
    winnerPoints = 3
  }

  if (winnerPoints > 0 && predictedScoreA != null && predictedScoreB != null) {
    var diffA = Math.abs(predictedScoreA - actualScoreA)
    var diffB = Math.abs(predictedScoreB - actualScoreB)
    if (diffA === 0 && diffB === 0) {
      scoreBonus = 5
    } else if (diffA <= 1 && diffB <= 1) {
      scoreBonus = 3
    } else if (diffA <= 1 || diffB <= 1) {
      scoreBonus = 1
    }
  }

  return { winner: winnerPoints, scoreBonus: scoreBonus, total: winnerPoints + scoreBonus }
}

// ===== Betting Multiplier =====
function getScoreMultiplier(predictedScoreA, predictedScoreB, actualScoreA, actualScoreB) {
  if (predictedScoreA == null || predictedScoreB == null) return 1.0
  var diffA = Math.abs(predictedScoreA - actualScoreA)
  var diffB = Math.abs(predictedScoreB - actualScoreB)
  if (diffA === 0 && diffB === 0) return 1.5
  if (diffA <= 1 && diffB <= 1) return 1.2
  return 1.0
}

// ===== Prediction CRUD =====
function getPredictionKey(userId) {
  return PREDICTION_PREFIX + userId
}

function getPredictions(userId) {
  try {
    var data = wx.getStorageSync(getPredictionKey(userId))
    return Array.isArray(data) ? data : []
  } catch (e) {
    return []
  }
}

function savePredictions(userId, predictions) {
  wx.setStorageSync(getPredictionKey(userId), Array.isArray(predictions) ? predictions : [])
}

function getPredictionByMatch(matchId, userId) {
  var list = getPredictions(userId)
  for (var i = 0; i < list.length; i++) {
    if (list[i].matchId === matchId) return list[i]
  }
  return null
}

function createPrediction(matchId, input, userId) {
  var match = getMatchById(matchId)
  if (!match) {
    return { success: false, message: '比赛不存在' }
  }
  if (match.status !== 'scheduled') {
    return { success: false, message: '比赛已开始或已结束，不可预测' }
  }

  var predictedWinner = input.predictedWinner || ''
  if (!predictedWinner) {
    return { success: false, message: '请选择胜方' }
  }
  if (match.isKnockout && predictedWinner === 'draw') {
    return { success: false, message: '淘汰赛不能选择平局' }
  }

  var existing = getPredictionByMatch(matchId, userId)
  if (existing) {
    return { success: false, message: '已预测过该场比赛' }
  }

  // Validate pool
  var stakePoints = Math.max(0, parseInt(input.stakePoints, 10) || 0)
  if (stakePoints > 0) {
    var pool = getUserPool(userId)
    var available = pool.totalPoints - pool.lockedInBets
    if (stakePoints < MIN_BET && stakePoints > 0) {
      return { success: false, message: '最低下注 ' + MIN_BET + ' 分' }
    }
    if (stakePoints > pool.totalPoints * MAX_BET_RATIO) {
      return { success: false, message: '下注不可超过总资产的 ' + (MAX_BET_RATIO * 100) + '%' }
    }
    if (stakePoints > available) {
      return { success: false, message: '可用积分不足，当前可用 ' + available + ' 分' }
    }
  }

  var predictedScoreA = null
  var predictedScoreB = null
  if (input.predictedScoreA != null && input.predictedScoreB != null) {
    predictedScoreA = parseInt(input.predictedScoreA, 10) || 0
    predictedScoreB = parseInt(input.predictedScoreB, 10) || 0
  }

  var odds = getMatchOdds(match)
  var now = new Date().toISOString()

  var prediction = {
    id: 'PRED_' + Date.now() + '_' + Math.floor(Math.random() * 1000).toString().padStart(3, '0'),
    matchId: matchId,
    userId: userId,
    predictedWinner: predictedWinner,
    predictedScoreA: predictedScoreA,
    predictedScoreB: predictedScoreB,
    stakePoints: stakePoints,
    oddsAtPrediction: odds,
    finalMultiplier: 1.0,
    points: { winner: 0, scoreBonus: 0, total: 0 },
    payout: null,
    status: 'pending',
    createdAt: now,
    updatedAt: now
  }

  var list = getPredictions(userId)
  list.push(prediction)
  savePredictions(userId, list)

  // Lock bet points
  if (stakePoints > 0) {
    lockBetPoints(userId, stakePoints)
  }

  return { success: true, prediction: prediction }
}

// ===== Match Results & Settlement =====
function getMatchResults() {
  try {
    var data = wx.getStorageSync(MATCH_RESULTS_KEY)
    return data && typeof data === 'object' ? data : {}
  } catch (e) {
    return {}
  }
}

function setMatchResult(matchId, scoreA, scoreB, userId) {
  var match = getMatchById(matchId)
  if (!match) return { success: false, message: '比赛不存在' }

  var results = getMatchResults()
  results[matchId] = { scoreA: scoreA, scoreB: scoreB }
  wx.setStorageSync(MATCH_RESULTS_KEY, results)

  // Update match data in memory
  match.scoreA = scoreA
  match.scoreB = scoreB
  match.status = 'finished'

  // Settle all predictions for this match
  settleMatchPredictions(matchId, scoreA, scoreB)

  return { success: true }
}

function settleMatchPredictions(matchId, scoreA, scoreB) {
  var match = getMatchById(matchId)
  if (!match) return

  var allUsers = STORAGE.getUsers() || []
  for (var u = 0; u < allUsers.length; u++) {
    var userId = allUsers[u].id
    if (!userId) continue
    var predictions = getPredictions(userId)
    var changed = false
    for (var p = 0; p < predictions.length; p++) {
      var pred = predictions[p]
      if (pred.matchId === matchId && pred.status === 'pending') {
        // Score points
        var pts = calculatePredictionPoints(
          pred.predictedWinner, pred.predictedScoreA, pred.predictedScoreB,
          scoreA, scoreB, match.isKnockout
        )
        pred.points = pts
        pred.status = 'scored'

        // Bet settlement
        if (pred.stakePoints > 0) {
          var isWin = pts.winner > 0
          var multiplier = 1.0
          if (isWin) {
            multiplier = getScoreMultiplier(pred.predictedScoreA, pred.predictedScoreB, scoreA, scoreB)
          }
          pred.finalMultiplier = multiplier

          var baseOdds = pred.oddsAtPrediction || {}
          var selectedOdds = 1.0
          if (pred.predictedWinner === 'teamA') selectedOdds = baseOdds.teamA || 1.0
          else if (pred.predictedWinner === 'teamB') selectedOdds = baseOdds.teamB || 1.0
          else selectedOdds = baseOdds.draw || 1.0

          var returnAmount = 0
          var profit = 0
          if (isWin) {
            returnAmount = Math.round(pred.stakePoints * selectedOdds * multiplier * 100) / 100
            profit = Math.round((returnAmount - pred.stakePoints) * 100) / 100
          }

          pred.payout = {
            stake: pred.stakePoints,
            odds: Math.round(selectedOdds * 100) / 100,
            multiplier: multiplier,
            return: returnAmount,
            profit: profit
          }

          // Update user pool
          settleBetPool(userId, pred.stakePoints, profit)
        }

        pred.updatedAt = new Date().toISOString()
        changed = true
      }
    }
    if (changed) {
      savePredictions(userId, predictions)
    }
  }
}

// ===== User Pool Management =====
function getUserPoolKey() {
  return USER_POOL_KEY
}

function getAllUserPools() {
  try {
    var data = wx.getStorageSync(getUserPoolKey())
    return data && typeof data === 'object' ? data : {}
  } catch (e) {
    return {}
  }
}

function saveAllUserPools(pools) {
  wx.setStorageSync(getUserPoolKey(), pools || {})
}

function ensureUserPool(userId) {
  if (!userId) return null
  var pools = getAllUserPools()
  if (!pools[userId]) {
    pools[userId] = {
      totalPoints: INITIAL_POOL,
      initialPoints: INITIAL_POOL,
      betProfit: 0,
      reliefGranted: 0,
      lockedInBets: 0,
      updatedAt: new Date().toISOString()
    }
    saveAllUserPools(pools)
  }
  return pools[userId]
}

function getUserPool(userId) {
  return ensureUserPool(userId)
}

function lockBetPoints(userId, amount) {
  var pool = ensureUserPool(userId)
  if (!pool) return
  pool.lockedInBets = (pool.lockedInBets || 0) + amount
  pool.updatedAt = new Date().toISOString()
  var pools = getAllUserPools()
  pools[userId] = pool
  saveAllUserPools(pools)
}

function settleBetPool(userId, stake, profit) {
  var pool = ensureUserPool(userId)
  if (!pool) return
  pool.lockedInBets = Math.max(0, (pool.lockedInBets || 0) - stake)
  pool.totalPoints = (pool.totalPoints || INITIAL_POOL) + profit
  pool.betProfit = (pool.betProfit || 0) + profit
  pool.updatedAt = new Date().toISOString()
  var pools = getAllUserPools()
  pools[userId] = pool
  saveAllUserPools(pools)
}

function applyDailyRelief(userId) {
  var pool = ensureUserPool(userId)
  if (!pool) return null
  if (pool.totalPoints >= RELIEF_THRESHOLD) return null

  var today = getBeijingDateString()
  try {
    var lastRelief = wx.getStorageSync(RELIEF_DATE_KEY + '_' + userId)
    if (lastRelief === today) return null
  } catch (e) {}

  pool.totalPoints += RELIEF_AMOUNT
  pool.reliefGranted = (pool.reliefGranted || 0) + RELIEF_AMOUNT
  pool.updatedAt = new Date().toISOString()
  wx.setStorageSync(RELIEF_DATE_KEY + '_' + userId, today)

  var pools = getAllUserPools()
  pools[userId] = pool
  saveAllUserPools(pools)
  return { amount: RELIEF_AMOUNT, newTotal: pool.totalPoints }
}

function getBeijingDateString() {
  var now = new Date()
  var utc = now.getTime() + now.getTimezoneOffset() * 60000
  var cst = new Date(utc + 8 * 3600000)
  var y = cst.getUTCFullYear()
  var m = String(cst.getUTCMonth() + 1).padStart(2, '0')
  var d = String(cst.getUTCDate()).padStart(2, '0')
  return y + '-' + m + '-' + d
}

// ===== Leaderboard =====
function buildLeaderboard(currentUserId) {
  var allUsers = STORAGE.getUsers() || []
  var pools = getAllUserPools()
  var list = []

  for (var i = 0; i < allUsers.length; i++) {
    var u = allUsers[i]
    if (!u || !u.id) continue

    var predictions = getPredictions(u.id)
    var totalPreds = predictions.length
    var scoredPreds = 0
    var correctPreds = 0
    var totalPoints = 0
    var currentStreak = 0
    var bestStreak = 0

    // Sort predictions by createdAt descending for streak calculation
    var sorted = [].concat(predictions).sort(function(a, b) {
      return a.createdAt < b.createdAt ? 1 : -1
    })

    for (var p = 0; p < sorted.length; p++) {
      var pred = sorted[p]
      if (pred.status === 'scored') {
        scoredPreds++
        totalPoints += pred.points.total || 0
        if (pred.points.winner > 0) {
          correctPreds++
          currentStreak++
          if (currentStreak > bestStreak) bestStreak = currentStreak
        } else {
          currentStreak = 0
        }
      }
    }

    var pool = pools[u.id] || { totalPoints: INITIAL_POOL, betProfit: 0 }
    var accuracy = scoredPreds > 0 ? Math.round((correctPreds / scoredPreds) * 10000) / 100 : 0

    list.push({
      userId: u.id,
      nickname: u.nickname || '用户',
      avatarUrl: u.avatarUrl || '',
      totalPoints: totalPoints,
      totalPredictions: scoredPreds,
      correctPredictions: correctPreds,
      accuracy: accuracy,
      currentStreak: currentStreak,
      bestStreak: bestStreak,
      bettingAssets: pool.totalPoints || 0,
      bettingProfit: pool.betProfit || 0
    })
  }

  // Sort by totalPoints desc
  list.sort(function(a, b) { return b.totalPoints - a.totalPoints })
  for (var i = 0; i < list.length; i++) {
    list[i].rank = i + 1
  }

  // Weath sort
  var wealthList = [].concat(list).sort(function(a, b) { return b.bettingAssets - a.bettingAssets })
  for (var i = 0; i < wealthList.length; i++) {
    wealthList[i].wealthRank = i + 1
  }

  var myEntry = null
  for (var i = 0; i < list.length; i++) {
    if (list[i].userId === currentUserId) {
      myEntry = list[i]
      break
    }
  }

  return {
    ranking: list,
    wealth: wealthList,
    myRank: myEntry
  }
}

function calculateUserStats(userId) {
  var predictions = getPredictions(userId)
  var scored = predictions.filter(function(p) { return p.status === 'scored' })
  var correct = scored.filter(function(p) { return p.points.winner > 0 })
  var totalPoints = scored.reduce(function(s, p) { return s + (p.points.total || 0) }, 0)
  var totalBets = predictions.filter(function(p) { return p.stakePoints > 0 })
  var wonBets = totalBets.filter(function(p) { return p.points && p.points.winner > 0 })
  var totalBetProfit = totalBets.reduce(function(s, p) {
    return s + ((p.payout && p.payout.profit) || 0)
  }, 0)

  var pool = ensureUserPool(userId)
  var streak = 0
  var sorted = [].concat(scored).sort(function(a, b) { return a.createdAt < b.createdAt ? 1 : -1 })
  for (var i = 0; i < sorted.length; i++) {
    if (sorted[i].points.winner > 0) streak++
    else break
  }

  return {
    totalPredictions: scored.length,
    correctPredictions: correct.length,
    accuracy: scored.length > 0 ? Math.round((correct.length / scored.length) * 10000) / 100 : 0,
    totalPoints: totalPoints,
    currentStreak: streak,
    totalBets: totalBets.length,
    wonBets: wonBets.length,
    totalBetProfit: Math.round(totalBetProfit * 100) / 100,
    poolTotal: pool ? pool.totalPoints : INITIAL_POOL
  }
}

// ===== Cloud Sync =====
function canUseCloud() {
  return !!(wx && wx.cloud && typeof wx.cloud.callFunction === 'function')
}

function getCurrentUserId() {
  var user = STORAGE.getCurrentUser()
  return user && user.id ? String(user.id) : ''
}

// ===== Exports =====
module.exports = {
  // Constants
  INITIAL_POOL: INITIAL_POOL,
  MIN_BET: MIN_BET,
  MAX_BET_RATIO: MAX_BET_RATIO,
  RELIEF_AMOUNT: RELIEF_AMOUNT,

  // Match data
  getAllMatchData: getAllMatchData,
  getAllMatches: getAllMatches,
  getMatchesByRound: getMatchesByRound,
  getMatchById: getMatchById,
  getTeamName: getTeamName,
  getTeamFlag: getTeamFlag,
  getTeamRanking: getTeamRanking,

  // Odds
  calculateOdds: calculateOdds,
  getMatchOdds: getMatchOdds,
  getMatchMarketSnapshot: getMatchMarketSnapshot,
  refreshScheduleData: refreshScheduleData,
  pullLatestScheduleDraft: pullLatestScheduleDraft,
  publishScheduleData: publishScheduleData,
  restoreBundledSchedule: restoreBundledSchedule,
  resetScheduleCache: resetScheduleCache,
  setAllMatchData: setAllMatchData,
  saveScheduleDraft: saveScheduleDraft,
  getScheduleDraft: getScheduleDraft,
  getScheduleMeta: getScheduleMeta,
  getScheduleMaintenanceSnapshot: getScheduleMaintenanceSnapshot,
  getStoredScheduleSourceUrl: getStoredScheduleSourceUrl,
  setStoredScheduleSourceUrl: setStoredScheduleSourceUrl,

  // Scoring
  calculatePredictionPoints: calculatePredictionPoints,
  getScoreMultiplier: getScoreMultiplier,

  // Predictions
  getPredictions: getPredictions,
  getPredictionByMatch: getPredictionByMatch,
  createPrediction: createPrediction,

  // Match results
  setMatchResult: setMatchResult,
  getMatchResults: getMatchResults,

  // User pool
  getUserPool: getUserPool,
  applyDailyRelief: applyDailyRelief,

  // Leaderboard
  buildLeaderboard: buildLeaderboard,
  calculateUserStats: calculateUserStats,

  // Utils
  getBeijingDateString: getBeijingDateString,
  getCurrentUserId: getCurrentUserId
}
