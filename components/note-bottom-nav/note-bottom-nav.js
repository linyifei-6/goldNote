Component({
  properties: {
    items: {
      type: Array,
      value: []
    },
    activeKey: {
      type: String,
      value: ''
    },
    mode: {
      type: String,
      value: 'fixed'
    }
  },

  methods: {
    onTapItem(e) {
      const key = String((e.currentTarget.dataset && e.currentTarget.dataset.key) || '')
      if (!key) {
        return
      }
      this.triggerEvent('change', { key })
    }
  }
})
