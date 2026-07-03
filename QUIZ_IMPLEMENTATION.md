# 竞猜笔记模块 技术实现说明

**版本**: 1.0.0  
**最后更新**: 2026年7月3日  

---

## 1. 项目结构

### 1.1 新增文件

`
utils/
  quiz.js                    <- 竞猜核心数据层（比赛数据、预测CRUD、积分计算）

pages/
  quiz/
    quiz.js                  <- 赛程列表页面逻辑
    quiz.wxml                <- 赛程列表页面模板
    quiz.wxss                <- 赛程列表页面样式
    quizPredict.js           <- 预测提交页面逻辑
    quizPredict.wxml         <- 预测提交页面模板
    quizPredict.wxss         <- 预测提交页面样式
    quizLeaderboard.js       <- 排行榜页面逻辑
    quizLeaderboard.wxml     <- 排行榜页面模板
    quizLeaderboard.wxss     <- 排行榜页面样式

components/
  quiz-match-card/
    quiz-match-card.js       <- 比赛卡片组件
    quiz-match-card.wxml     <- 比赛卡片模板
    quiz-match-card.wxss     <- 比赛卡片样式

data/
  worldcup_2026.json         <- 世界杯内置赛程数据

cloudfunctions/
  saveQuizData/index.js      <- 保存预测/赛果的云函数
  getQuizData/index.js       <- 获取预测/赛果的云函数
`

### 1.2 需修改文件

| 文件 | 修改内容 |
|------|---------|
| app.json | 添加 quiz 子包注册 |
| pages/portal/portal.js | 添加 onGoQuiz() 导航方法 |
| pages/portal/portal.wxml | 添加竞猜笔记入口按钮 |
| project.config.json | 添加新的云函数目录 |
| database-indexes.json | 添加 quiz 集合索引 |

---

## 2. 数据存储设计

### 2.1 本地存储

沿用项目现有的 wx.setStorageSync / wx.getStorageSync 模式。

| 存储键 | 类型 | 说明 |
|--------|------|------|
| quiz_predictions_{userId} | JSON 数组 | 用户的所有预测记录 |
| quiz_match_results | JSON 对象 | 已更新的赛果 { matchId: { scoreA, scoreB } } |
| quiz_leaderboard_cache | JSON 对象 | 排行榜缓存数据 |
| quiz_my_stats_{userId} | JSON 对象 | 用户个人统计缓存 |

### 2.2 云端集合

| 集合名 | 说明 | 索引 |
|--------|------|------|
| quiz_predictions | 预测记录 | userId + matchId（唯一） |
| quiz_match_results | 赛果记录 | matchId（唯一） |

### 2.3 内置赛程数据

比赛基础数据随版本包内置在 data/worldcup_2026.json 中，确保离线可查看赛程。

---

## 3. 工具模块：utils/quiz.js

### 3.1 核心函数接口

**赛程数据**
- getAllMatches() - 获取所有比赛
- getMatchesByRound() - 按轮次分组
- getMatchById(matchId) - 获取单场比赛
- updateMatchStatus(matchId, status) - 更新比赛状态

**预测操作**
- createPrediction(matchId, input, userId) - 创建预测
- getPredictions(userId) - 获取用户所有预测
- getPredictionByMatch(matchId, userId) - 获取单场预测
- deletePrediction(matchId, userId) - 删除预测

**赛果与积分**
- setMatchResult(matchId, scoreA, scoreB, userId) - 录入赛果
- calculatePredictionPoints(prediction, actualScoreA, actualScoreB, isKnockout) - 计算得分
- recalculateUserPoints(userId) - 重新计算积分

**排行榜**
- buildLeaderboard(users, currentUserId) - 构建排行榜
- calculateUserStats(userId) - 用户统计

**云同步**
- syncPredictionsFromCloud(userId) - 从云端同步
- savePredictionToCloud(userId, prediction) - 保存到云端

### 3.2 积分计算算法

`javascript
function calculatePredictionPoints(prediction, actualScoreA, actualScoreB, isKnockout) {
  let winnerPoints = 0
  let scoreBonus = 0

  // 1. 胜负判定
  const actualWinner = actualScoreA > actualScoreB ? 'teamA'
    : actualScoreB > actualScoreA ? 'teamB' : 'draw'
  if (prediction.predictedWinner === actualWinner) {
    winnerPoints = 3
  }

  // 2. 比分奖励（仅在胜负正确时计分）
  if (winnerPoints > 0) {
    const diffA = Math.abs(prediction.predictedScoreA - actualScoreA)
    const diffB = Math.abs(prediction.predictedScoreB - actualScoreB)

    if (diffA === 0 && diffB === 0) {
      scoreBonus = 5   // 完全命中
    } else if (diffA <= 1 && diffB <= 1) {
      scoreBonus = 3   // 两队接近
    } else if (diffA <= 1 || diffB <= 1) {
      scoreBonus = 1   // 一队接近
    }
  }

  return { winner: winnerPoints, scoreBonus, total: winnerPoints + scoreBonus }
}
`

---

## 4. 页面设计

### 4.1 quiz（赛程列表页）

路由: /pages/quiz/quiz

**页面数据**:
`javascript
data: {
  user: null,
  rounds: [],               // 按轮次分组的比赛数组
  currentRoundIndex: 0,     // 当前选中的轮次索引
  filterDate: '',
  predictionMap: {},        // { matchId: Prediction }
  matchResultMap: {},       // { matchId: { scoreA, scoreB } }
  userStats: null,
  loginLoading: false
}
`

**UI 布局**:
`
+---------------------------------------+
|  竞猜笔记                   个人统计   |
+---------------------------------------+
| 小组赛 | 1/8 | 1/4 | 半决赛 | 决赛    |  <- 轮次导航
+---------------------------------------+
| +----- 比赛卡片 -------------------+  |
| | 7月3日 21:00                    |  |
| | 巴西 vs 阿根廷                  |  |
| | MetLife Stadium                 |  |
| | [2:1] 已预测                    |  |
| +----------------------------------+  |
|                                       |
| +----- 比赛卡片 -------------------+  |
| | 7月4日 00:00                    |  |
| | 法国 vs 德国                    |  |
| | [点击竞猜]                      |  |
| +----------------------------------+  |
+---------------------------------------+
      [排行榜] 按钮浮底
`

### 4.2 quizPredict（预测提交页）

路由: /pages/quiz/quizPredict?matchId=WC2026_M001

**页面数据**:
`javascript
data: {
  match: null,
  prediction: {
    predictedWinner: '',    // teamA | teamB | draw
    predictedScoreA: '',
    predictedScoreB: ''
  },
  submitting: false,
  matchStarted: false,
  existingPrediction: null
}
`

**交互流程**:
1. 加载 matchId 对应的比赛信息
2. 检查是否已有预测（若有则回填表单）
3. 用户选择胜负（三个按钮：主队胜/平局/客队胜）
4. 用户可选输入比分（两个数字输入框）
5. 点击提交 -> 二次确认弹窗
6. 确认 -> 保存预测 -> 返回赛程列表

### 4.3 quizLeaderboard（排行榜页）

路由: /pages/quiz/quizLeaderboard

**页面数据**:
`javascript
data: {
  user: null,
  currentUserId: '',
  sortBy: 'points',         // points | accuracy | streak
  leaderboard: [],
  myRank: null,
  loading: false
}
`

**UI 布局**:
`
+---------------------------------------+
|  竞猜排行榜                           |
+---------------------------------------+
| 总积分 | 命中率 | 连对                |  <- 排序切换
+---------------------------------------+
| 1  用户A    42分  80%                |
| 2  用户B    38分  73%                |
| 3  用户C    35分  67%                |
| 4  用户D    32分  62%                |
| ...                                  |
+---------------------------------------+
| 你当前排名：#8  30分                  |  <- 固定底栏
+---------------------------------------+
`

---

## 5. 云函数设计

### 5.1 saveQuizData

`javascript
// 输入
{
  action: 'createPrediction',    // createPrediction | updateResult
  userId: 'user_xxx',
  prediction: { ... },
  matchResult: { ... }
}

// 输出
{
  success: true,
  prediction: { ... },
  message: ''
}
`

### 5.2 getQuizData

`javascript
// 输入
{
  action: 'getPredictions',     // getPredictions | getResults
  userId: 'user_xxx'
}

// 输出
{
  success: true,
  data: [ ... ],
  message: ''
}
`

---

## 6. 社交集成

竞猜排行榜设计为**全局排行榜**，但提供「好友筛选」功能（P2），利用 social.js 的 getGoldReadableUsers() 接口获取用户的好友列表。

`javascript
onViewUserPredictions(e) {
  const targetUserId = e.currentTarget.dataset.userId
  const isFriend = social.isFollowing(user.id, targetUserId, { scene: 'gold' })
  if (!isFriend) {
    wx.showToast({ title: '需先关注该用户', icon: 'none' })
    return
  }
  this.showUserPredictionDetail(targetUserId)
}
`

---

## 7. 入口集成

### 7.1 app.json 子包注册

`json
{
  "root": "pages/quiz",
  "pages": ["quiz", "quizPredict", "quizLeaderboard"]
}
`

### 7.2 portal.js 导航方法

`javascript
onGoQuiz() {
  const user = this.ensureGuestSession()
  if (!user) return
  wx.navigateTo({ url: '/pages/quiz/quiz' })
}
`

---

## 8. 分阶段实施计划

| 阶段 | 功能 | 产出 |
|------|------|------|
| Phase 1 | 赛程浏览 + 预测提交 + 积分结算 | utils/quiz.js, quiz, quizPredict 页面 |
| Phase 2 | 排行榜 + 个人统计 | quizLeaderboard 页面 |
| Phase 3 | 云同步 + 社交集成 | 云函数、好友预测 |

---

## 9. 组件设计：quiz-match-card

### Props

| 属性 | 类型 | 说明 |
|------|------|------|
| match | Object | 比赛数据 |
| prediction | Object/null | 用户预测（null 表示未预测） |
| result | Object/null | 实际赛果（null 表示未结束） |

### 展示状态

| 状态 | 显示内容 |
|------|---------|
| 未开始 + 未预测 | 对阵信息 + [点击竞猜] 按钮 |
| 未开始 + 已预测 | 对阵信息 + 预测结果徽章 |
| 进行中 | 对阵信息 + 「比赛中」标签 |
| 已结束 + 已预测 | 对阵 + 实际比分 + 预测对比 + 得分 |
| 已结束 + 未预测 | 对阵 + 实际比分（灰色显示） |
