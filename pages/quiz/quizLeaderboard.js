const auth = require('../../utils/auth')
const quiz = require('../../utils/quiz')

Page({
  data: { user: null, currentUserId: '', sortBy: 'points', leaderboard: [], myRank: null, loading: false },

  onShow: function() {
    var user = auth.ensureLogin()
    if (user) { this.setData({ user: user, currentUserId: user.id }); this.loadLeaderboard() }
  },

  loadLeaderboard: function() {
    var user = this.data.user
    if (!user) return
    var data = quiz.buildLeaderboard(user.id)
    var list = []
    var sb = this.data.sortBy
    if (sb === 'wealth') { list = data.wealth || [] }
    else if (sb === 'accuracy') {
      list = (data.ranking || []).concat().sort(function(a, b) { return b.accuracy - a.accuracy })
      for (var i = 0; i < list.length; i++) list[i].rank = i + 1
    } else { list = data.ranking || [] }
    var myRank = null
    for (var j = 0; j < list.length; j++) {
      if (list[j].userId === user.id) {
        myRank = list[j]
        break
      }
    }
    this.setData({ leaderboard: list, myRank: myRank })
  },

  onSortTab: function(e) {
    var sb = e.currentTarget.dataset.sort
    if (sb === this.data.sortBy) return
    this.setData({ sortBy: sb })
    this.loadLeaderboard()
  }
})
