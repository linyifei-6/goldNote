const auth = require('../../utils/auth')
const chat = require('../../utils/chat')
const social = require('../../utils/social')

Page({
  data: {
    user: null,
    scene: 'gold',
    threadId: '',
    targetUserId: '',
    targetName: '聊天',
    peer: null,
    relationInfo: null,
    messages: [],
    hasMore: false,
    loading: false,
    inputText: '',
    sending: false,
    scrollToId: ''
  },

  onLoad(options) {
    const scene = social.normalizeScene(options && options.scene)
    const threadId = decodeURIComponent(String((options && options.threadId) || ''))
    const targetUserId = decodeURIComponent(String((options && options.targetUserId) || ''))
    const targetName = decodeURIComponent(String((options && options.targetName) || '聊天')) || '聊天'

    this.setData({ scene, threadId, targetUserId, targetName })
    wx.setNavigationBarTitle({ title: targetName })
  },

  onShow() {
    this.refreshMessages(true)
    this.startPolling()
  },

  onHide() {
    this.stopPolling()
  },

  onUnload() {
    this.stopPolling()
  },

  startPolling() {
    this.stopPolling()
    this._pollingTimer = setInterval(() => {
      this.refreshMessages(false, true)
    }, 5000)
  },

  stopPolling() {
    if (this._pollingTimer) {
      clearInterval(this._pollingTimer)
      this._pollingTimer = null
    }
  },

  async refreshMessages(reset = false, silent = false) {
    const user = auth.ensureLogin('/pages/login/login')
    if (!user) return
    if (user.isGuest) {
      wx.showToast({ title: '访客模式不支持聊天', icon: 'none' })
      return
    }

    if (!silent) {
      this.setData({ loading: true })
    }

    const result = await chat.getMessages({
      scene: this.data.scene,
      threadId: this.data.threadId,
      targetUserId: this.data.targetUserId,
      limit: 40
    })

    if (!result.success) {
      if (!silent) {
        wx.showToast({ title: result.message || '加载消息失败', icon: 'none' })
      }
      this.setData({ loading: false })
      return
    }

    const peer = result.peer || this.data.peer
    const peerName = (peer && peer.nickname) || this.data.targetName || '聊天'
    wx.setNavigationBarTitle({ title: peerName })

    this.setData({
      user,
      peer,
      relationInfo: result.relationInfo || null,
      targetName: peerName,
      threadId: result.threadId || this.data.threadId,
      messages: result.list || [],
      hasMore: !!result.hasMore,
      loading: false
    })

    if (result.threadId) {
      await chat.markRead(this.data.scene, result.threadId)
    }

    this.scrollToBottom()
  },

  async onLoadMoreHistory() {
    const list = this.data.messages || []
    if (!list.length) {
      return
    }

    const oldest = list[0]
    const beforeMs = Number(oldest.createdAtMs) || 0
    if (!(beforeMs > 0)) {
      return
    }

    const result = await chat.getMessages({
      scene: this.data.scene,
      threadId: this.data.threadId,
      targetUserId: this.data.targetUserId,
      beforeMs,
      limit: 40
    })

    if (!result.success) {
      wx.showToast({ title: result.message || '加载更多失败', icon: 'none' })
      return
    }

    this.setData({
      threadId: result.threadId || this.data.threadId,
      hasMore: !!result.hasMore,
      messages: [...(result.list || []), ...list]
    })
  },

  onInputMessage(e) {
    this.setData({ inputText: e.detail.value })
  },

  scrollToBottom() {
    const list = this.data.messages || []
    if (!list.length) {
      return
    }

    const lastId = list[list.length - 1].id
    this.setData({ scrollToId: `msg_${lastId}` })
  },

  async onSendMessage() {
    if (this.data.sending) {
      return
    }

    const content = String(this.data.inputText || '').trim()
    if (!content) {
      wx.showToast({ title: '请输入消息内容', icon: 'none' })
      return
    }

    this.setData({ sending: true })

    const clientMsgId = `CMSG_${Date.now()}_${Math.floor(Math.random() * 1000)}`
    const result = await chat.sendMessage({
      scene: this.data.scene,
      threadId: this.data.threadId,
      targetUserId: this.data.targetUserId,
      content,
      clientMsgId
    })

    if (!result.success) {
      this.setData({ sending: false })
      wx.showToast({ title: result.message || '发送失败', icon: 'none' })
      return
    }

    const nextThreadId = result.threadId || this.data.threadId
    const nextMessages = [...(this.data.messages || [])]
    if (result.message) {
      nextMessages.push(result.message)
    }

    this.setData({
      threadId: nextThreadId,
      messages: nextMessages,
      inputText: '',
      sending: false
    })

    this.scrollToBottom()
  }
})
