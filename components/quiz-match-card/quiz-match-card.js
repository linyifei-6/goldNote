
Component({
  properties: {
    match: { type: Object, value: null },
    prediction: { type: Object, value: null },
    result: { type: Object, value: null },
    teamA: { type: String, value: '' },
    teamB: { type: String, value: '' },
    flagA: { type: String, value: '' },
    flagB: { type: String, value: '' }
  },
  methods: {
    onTap: function() {
      this.triggerEvent('matchtap', { matchId: this.properties.match ? this.properties.match.id : '' })
    }
  }
})
