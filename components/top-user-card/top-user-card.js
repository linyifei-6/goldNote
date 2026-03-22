Component({
  properties: {
    user: {
      type: Object,
      value: null,
      observer(newVal) {
        const name = newVal && newVal.nickname ? String(newVal.nickname) : '一袋芋头'
        this.setData({
          displayNickname: name,
          displayNicknameInitial: name.charAt(0) || '芋'
        })
      }
    },
    showMessageBadge: {
      type: Boolean,
      value: false
    },
    unreadMessageCount: {
      type: Number,
      value: 0
    },
    showQuickActions: {
      type: Boolean,
      value: true
    }
  },
  data: {
    displayNickname: '一袋芋头',
    displayNicknameInitial: '芋'
  },
  methods: {
    onAvatarTap() {
      this.triggerEvent('avatar')
    },
    onSelectorTap() {
      // 仅保留语义化事件，避免旧事件名导致误绑定回归。
      this.triggerEvent('openselector')
    },
    onWeddingTap() {
      this.triggerEvent('wedding')
    },
    onMessageTap() {
      // 仅保留语义化事件，避免旧事件名误绑到错误页面跳转。
      this.triggerEvent('openmessage')
    },
    onSocialTap() {
      this.triggerEvent('social')
    }
  }
})