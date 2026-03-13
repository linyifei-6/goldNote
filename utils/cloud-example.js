/**
 * 浜戝嚱鏁拌皟鐢ㄧず渚? * 
 * 鍦ㄥ皬绋嬪簭涓皟鐢ㄤ簯鍑芥暟鐨勭ず渚嬩唬鐮? */

// ============================================
// 1. 鍒濆鍖栦簯寮€鍙戯紙鍦?app.js 涓級
// ============================================
/*
App({
  onLaunch() {
    wx.cloud.init({
      env: 'goldnote-7gvcgw84da48b20a',
      traceUser: true
    })
  }
})
*/

// ============================================
// 2. 鐢ㄦ埛鐧诲綍
// ============================================
function cloudLogin() {
  return wx.cloud.callFunction({
    name: 'login',
    data: {}
  }).then(res => {
    if (res.result.success) {
      console.log('鐧诲綍鎴愬姛:', res.result.user)
      wx.setStorageSync('gold_current_user', res.result.user)
      return res.result.user
    } else {
      console.error('鐧诲綍澶辫触:', res.result.message)
      wx.showToast({ title: '鐧诲綍澶辫触', icon: 'none' })
      return null
    }
  }).catch(err => {
    console.error('鐧诲綍寮傚父:', err)
    return null
  })
}

// ============================================
// 3. 鑾峰彇浜ゆ槗璁板綍
// ============================================
function getTransactions(options = {}) {
  const {
    limit = 100,
    offset = 0,
    startDate,
    endDate,
    platform,
    type
  } = options

  return wx.cloud.callFunction({
    name: 'getTransactions',
    data: {
      limit,
      offset,
      startDate,
      endDate,
      platform,
      type
    }
  }).then(res => {
    if (res.result.success) {
      return res.result.data
    } else {
      console.error('鑾峰彇浜ゆ槗澶辫触:', res.result.message)
      return []
    }
  })
}

// ============================================
// 4. 淇濆瓨浜ゆ槗璁板綍
// ============================================
function saveTransaction(transaction, action = 'create') {
  return wx.cloud.callFunction({
    name: 'saveTransaction',
    data: {
      action, // 'create' | 'update' | 'delete'
      transaction
    }
  }).then(res => {
    if (res.result.success) {
      wx.showToast({ title: action === 'delete' ? '鍒犻櫎鎴愬姛' : '淇濆瓨鎴愬姛', icon: 'success' })
      return res.result
    } else {
      wx.showToast({ title: res.result.message, icon: 'none' })
      return res.result
    }
  })
}

// ============================================
// 5. 鑾峰彇濠氱ぜ鏁版嵁
// ============================================
function getWeddingData(dataType) {
  // dataType: 'profile' | 'tasks' | 'expenses' | 'notes' | 'invites'
  return wx.cloud.callFunction({
    name: 'getWeddingData',
    data: { dataType }
  }).then(res => {
    if (res.result.success) {
      return res.result.data
    } else {
      console.error('鑾峰彇濠氱ぜ鏁版嵁澶辫触:', res.result.message)
      return []
    }
  })
}

// ============================================
// 6. 淇濆瓨濠氱ぜ鏁版嵁
// ============================================
function saveWeddingData(dataType, data, action = 'create') {
  return wx.cloud.callFunction({
    name: 'saveWeddingData',
    data: {
      action, // 'create' | 'update' | 'delete' | 'upsert'
      dataType,
      data
    }
  }).then(res => {
    if (res.result.success) {
      wx.showToast({ title: '淇濆瓨鎴愬姛', icon: 'success' })
      return res.result
    } else {
      wx.showToast({ title: res.result.message, icon: 'none' })
      return res.result
    }
  })
}

// ============================================
// 7. 浜戝瓨鍌ㄤ笂浼犳枃浠?// ============================================
function uploadFile(filePath, cloudPath) {
  return wx.cloud.uploadFile({
    filePath,
    cloudPath
  }).then(res => {
    console.log('涓婁紶鎴愬姛:', res.fileID)
    return res.fileID
  }).catch(err => {
    console.error('涓婁紶澶辫触:', err)
    return null
  })
}

// ============================================
// 8. 浜戝瓨鍌ㄤ笅杞芥枃浠?// ============================================
function downloadFile(fileID) {
  return wx.cloud.downloadFile({
    fileID
  }).then(res => {
    console.log('涓嬭浇鎴愬姛:', res.tempFilePath)
    return res.tempFilePath
  }).catch(err => {
    console.error('涓嬭浇澶辫触:', err)
    return null
  })
}

// ============================================
// 浣跨敤绀轰緥
// ============================================
/*
// 鐧诲綍
cloudLogin().then(user => {
  if (user) {
    // 鑾峰彇浜ゆ槗璁板綍
    getTransactions({ limit: 50 }).then(transactions => {
      console.log('浜ゆ槗璁板綍:', transactions)
    })
    
    // 淇濆瓨鏂颁氦鏄?    saveTransaction({
      type: 'buy',
      price: 550.5,
      weight: 10,
      platform: '鎷涘晢',
      date: '2026-03-10'
    })
    
    // 鑾峰彇濠氱ぜ妗ｆ
    getWeddingData('profile').then(profiles => {
      console.log('濠氱ぜ妗ｆ:', profiles)
    })
    
    // 淇濆瓨濠氱ぜ浠诲姟
    saveWeddingData('tasks', {
      title: '棰勮閰掑簵',
      type: '鍦哄湴',
      dueDate: '2026-06-01',
      priority: 1,
      budgetAmount: 50000
    }, 'create')
  }
})
*/

module.exports = {
  cloudLogin,
  getTransactions,
  saveTransaction,
  getWeddingData,
  saveWeddingData,
  uploadFile,
  downloadFile
}
