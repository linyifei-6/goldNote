Component({
  properties: {
    user: {
      type: Object,
      value: null
    },
    showMessageBadge: {
      type: Boolean,
      value: false
    },
    unreadMessageCount: {
      type: Number,
      value: 0
    }
  },
  methods: {
    onAvatarTap() {
      this.triggerEvent('avatar')
    },
    onSelectorTap() {
      this.triggerEvent('selector')
    },
    onWeddingTap() {
      this.triggerEvent('wedding')
    },
    onMessageTap() {
      this.triggerEvent('message')
    },
    onSocialTap() {
      this.triggerEvent('social')
    }
  }
})