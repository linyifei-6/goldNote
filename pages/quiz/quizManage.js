const quiz = require('../../utils/quiz')

Page({
  data: {
    sourceUrl: '',
    rawJsonText: '',
    active: null,
    draft: null,
    loadingPull: false,
    loadingPublish: false,
    loadingRestore: false,
    statusText: ''
  },

  onShow: function() {
    this.syncSnapshot()
  },

  syncSnapshot: function(message) {
    var snapshot = quiz.getScheduleMaintenanceSnapshot()
    this.setData({
      sourceUrl: snapshot.sourceUrl || '',
      active: snapshot.active || null,
      draft: snapshot.draft || null,
      statusText: message || ''
    })
  },

  onSourceUrlInput: function(e) {
    this.setData({ sourceUrl: e.detail.value })
  },

  onRawJsonInput: function(e) {
    this.setData({ rawJsonText: e.detail.value })
  },

  onPullLatest: function() {
    if (this.data.loadingPull) return
    var sourceUrl = String(this.data.sourceUrl || '').trim()
    var rawJsonText = String(this.data.rawJsonText || '').trim()
    var self = this

    this.setData({ loadingPull: true, statusText: '' })
    wx.showLoading({ title: '拉取赛程中' })

    var task = rawJsonText
      ? quiz.pullLatestScheduleDraft({ rawJson: rawJsonText, sourceUrl: sourceUrl, sourceName: '手工导入' })
      : quiz.pullLatestScheduleDraft({ sourceUrl: sourceUrl })

    Promise.resolve(task)
      .then(function(result) {
        var text = result && result.fallback ? (result.message || '已回退到内置赛程包') : '赛程草稿已更新'
        wx.showToast({ title: text, icon: 'none' })
        self.syncSnapshot(text)
      })
      .catch(function(error) {
        var text = (error && error.message) || '拉取失败'
        wx.showToast({ title: text, icon: 'none' })
        self.syncSnapshot(text)
      })
      .finally(function() {
        self.setData({ loadingPull: false })
        wx.hideLoading()
      })
  },

  onPublish: function() {
    if (this.data.loadingPublish) return
    var self = this
    this.setData({ loadingPublish: true, statusText: '' })
    wx.showLoading({ title: '发布赛程中' })

    var result = quiz.publishScheduleData()
    if (!result || !result.success) {
      wx.hideLoading()
      wx.showToast({ title: (result && result.message) || '发布失败', icon: 'none' })
      this.setData({ loadingPublish: false, statusText: (result && result.message) || '发布失败' })
      return
    }

    setTimeout(function() {
      wx.hideLoading()
      wx.showToast({ title: '赛程已发布', icon: 'success' })
      self.setData({ loadingPublish: false, sourceUrl: result.meta && result.meta.sourceUrl ? result.meta.sourceUrl : self.data.sourceUrl })
      self.syncSnapshot('赛程已发布')
    }, 200)
  },

  onRestoreBundled: function() {
    if (this.data.loadingRestore) return
    var self = this
    wx.showModal({
      title: '恢复内置赛程',
      content: '这会清空草稿和发布缓存，并恢复为内置赛程包，是否继续？',
      success: function(res) {
        if (!res.confirm) return
        self.setData({ loadingRestore: true, statusText: '' })
        wx.showLoading({ title: '恢复中' })
        var result = quiz.restoreBundledSchedule()
        wx.hideLoading()
        self.setData({ loadingRestore: false, sourceUrl: '', rawJsonText: '' })
        if (result) {
          wx.showToast({ title: '已恢复内置赛程', icon: 'success' })
          self.syncSnapshot('已恢复内置赛程')
        } else {
          wx.showToast({ title: '恢复失败', icon: 'none' })
          self.syncSnapshot('恢复失败')
        }
      }
    })
  },

  onGoBack: function() {
    wx.navigateBack()
  }
})
