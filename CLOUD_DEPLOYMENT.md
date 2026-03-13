# 寰俊浜戝紑鍙戦儴缃叉寚鍗?
## 椤圭洰淇℃伅
- **浜戠幆澧?ID**: `goldnote-7gvcgw84da48b20a`
- **灏忕▼搴?AppID**: `wxcc3aa76a357ec730`
- **婧愪唬鐮佺洰褰?*: `G:\Iflow\goldnote`

---

## 馃摝 涓€銆佷簯鍑芥暟鍒楄〃

宸插垱寤轰互涓嬩簯鍑芥暟锛?
| 浜戝嚱鏁板悕 | 鍔熻兘 | 璋冪敤鏉冮檺 |
|---------|------|---------|
| `login` | 鐢ㄦ埛寰俊鐧诲綍 | 鎵€鏈夌敤鎴?|
| `getTransactions` | 鑾峰彇浜ゆ槗璁板綍 | 鎵€鏈夌敤鎴?|
| `saveTransaction` | 淇濆瓨/鏇存柊/鍒犻櫎浜ゆ槗 | 鎵€鏈夌敤鎴?|
| `getWeddingData` | 鑾峰彇濠氱ぜ鏁版嵁 | 鎵€鏈夌敤鎴?|
| `saveWeddingData` | 淇濆瓨濠氱ぜ鏁版嵁 | 鎵€鏈夌敤鎴?|

---

## 馃殌 浜屻€侀儴缃叉楠?
### 姝ラ 1锛氬畨瑁呬簯寮€鍙?CLI锛堝鏈畨瑁咃級

```bash
npm install -g cloudbase-cli
```

### 姝ラ 2锛氱櫥褰曞井淇′簯寮€鍙?
```bash
cloudbase login
```

鎸夋彁绀烘壂鐮佺櫥褰曞井淇″紑鍙戣€呰处鍙枫€?
### 姝ラ 3锛氬垵濮嬪寲浜戝紑鍙戦」鐩?
鍦ㄩ」鐩洰褰曚笅鎵ц锛?
```bash
cd G:\Iflow\goldnote
cloudbase init
```

閫夋嫨浣犵殑浜戠幆澧冿細`goldnote-7gvcgw84da48b20a`

### 姝ラ 4锛氫笂浼犱簯鍑芥暟

**鏂瑰紡 A锛氫娇鐢ㄥ井淇″紑鍙戣€呭伐鍏凤紙鎺ㄨ崘锛?*

1. 鎵撳紑寰俊寮€鍙戣€呭伐鍏?2. 瀵煎叆椤圭洰 `G:\Iflow\goldnote`
3. 鍙抽敭鐐瑰嚮 `cloudfunctions` 鐩綍
4. 閫夋嫨 **"涓婁紶骞堕儴缃诧細浜戠瀹夎渚濊禆"**
5. 绛夊緟涓婁紶瀹屾垚

**鏂瑰紡 B锛氫娇鐢?CLI 鍛戒护**

```bash
# 涓婁紶鎵€鏈変簯鍑芥暟
cloudbase functions:deploy login
cloudbase functions:deploy getTransactions
cloudbase functions:deploy saveTransaction
cloudbase functions:deploy getWeddingData
cloudbase functions:deploy saveWeddingData
```

### 姝ラ 5锛氬垱寤烘暟鎹簱闆嗗悎

鍦ㄥ井淇″紑鍙戣€呭伐鍏蜂腑锛?
1. 鐐瑰嚮宸︿晶 **"浜戝紑鍙?** 鎸夐挳
2. 杩涘叆 **"鏁版嵁搴?** 闈㈡澘
3. 鍒涘缓浠ヤ笅闆嗗悎锛?   - `users`
   - `transactions`
   - `wedding_profiles`
   - `wedding_tasks`
   - `wedding_expenses`
   - `wedding_notes`
   - `wedding_invites`

### 姝ラ 6锛氶厤缃暟鎹簱鏉冮檺

涓烘瘡涓泦鍚堣缃潈闄愶紙鎺ㄨ崘锛夛細

```json
{
  "read": "auth.openid == doc.userId",
  "write": "auth.openid == doc.userId"
}
```

**娉ㄦ剰**锛歚users` 闆嗗悎鐨勬潈闄愶細
```json
{
  "read": "auth.openid == doc.openId",
  "write": "auth.openid == doc.openId"
}
```

### 姝ラ 7锛氭坊鍔犳暟鎹簱绱㈠紩

鍦ㄥ井淇″紑鍙戣€呭伐鍏风殑鏁版嵁搴撻潰鏉夸腑锛屼负姣忎釜闆嗗悎娣诲姞绱㈠紩锛堝弬鑰?`database-indexes.json`锛夛細

**transactions 闆嗗悎绱㈠紩锛?*
- `userId` (鍗囧簭) + `date` (闄嶅簭)
- `userId` (鍗囧簭) + `platform` (鍗囧簭)
- `userId` (鍗囧簭) + `timestamp` (闄嶅簭)

**wedding_tasks 闆嗗悎绱㈠紩锛?*
- `userId` (鍗囧簭) + `dueDate` (鍗囧簭)

**wedding_expenses 闆嗗悎绱㈠紩锛?*
- `userId` (鍗囧簭) + `date` (闄嶅簭)

---

## 馃敡 涓夈€佸皬绋嬪簭绔唬鐮佹敼閫?
闇€瑕佷慨鏀逛互涓嬫枃浠朵互浣跨敤浜戝紑鍙戯細

### 1. `app.js` - 鍒濆鍖栦簯寮€鍙?
```javascript
const cloud = require('wx-server-sdk')

App({
  onLaunch() {
    // 鍒濆鍖栦簯寮€鍙戠幆澧?    wx.cloud.init({
      env: 'goldnote-7gvcgw84da48b20a',
      traceUser: true
    })
    
    this.globalData = {
      user: null,
      currentHolding: 0,
      avgCost: 0,
      realizedProfit: 0,
      totalInvestment: 0
    }
  }
})
```

### 2. `utils/auth.js` - 浜戠櫥褰曞皝瑁?
鍒涘缓鏂版枃浠?`utils/auth.js`锛?
```javascript
// 浜戠櫥褰?function login() {
  return wx.cloud.callFunction({
    name: 'login',
    data: {}
  }).then(res => {
    if (res.result.success) {
      wx.setStorageSync('gold_current_user', res.result.user)
      return res.result.user
    }
    throw new Error(res.result.message)
  })
}

function getCurrentUser() {
  return wx.getStorageSync('gold_current_user')
}

function logout() {
  wx.removeStorageSync('gold_current_user')
}

module.exports = {
  login,
  getCurrentUser,
  logout
}
```

### 3. `utils/storage.js` - 鏀逛负浜戞暟鎹簱璋冪敤

闇€瑕佹敼閫犵幇鏈夌殑 storage.js锛屽皢 `wx.getStorageSync/setStorageSync` 鏀逛负浜戞暟鎹簱璋冪敤銆?
---

## 鉁?鍥涖€侀獙璇侀儴缃?
### 楠岃瘉浜戝嚱鏁?
鍦ㄥ井淇″紑鍙戣€呭伐鍏风殑浜戝紑鍙戞帶鍒跺彴锛?
1. 杩涘叆 **"浜戝嚱鏁?** 闈㈡澘
2. 鏌ョ湅鎵€鏈変簯鍑芥暟鐘舵€佸簲涓?**"閮ㄧ讲鎴愬姛"**
3. 鐐瑰嚮浜戝嚱鏁板彲鏌ョ湅鏃ュ織

### 娴嬭瘯浜戝嚱鏁?
鍦ㄥ紑鍙戣€呭伐鍏锋帶鍒跺彴鎵ц锛?
```javascript
// 娴嬭瘯鐧诲綍浜戝嚱鏁?wx.cloud.callFunction({
  name: 'login',
  data: {}
}).then(res => console.log('鐧诲綍缁撴灉:', res))
```

---

## 馃摑 浜斻€佹暟鎹縼绉伙紙鍙€夛級

濡傛灉闇€瑕佸皢鐜版湁鏈湴鏁版嵁杩佺Щ鍒颁簯绔細

1. 瀵煎嚭鏈湴鏁版嵁锛堜娇鐢ㄧ幇鏈夊皬绋嬪簭鐨勫鍑哄姛鑳斤級
2. 缂栧啓杩佺Щ鑴氭湰瀵煎叆浜戞暟鎹簱
3. 鎴栨墜鍔ㄥ湪浜戝紑鍙戞帶鍒跺彴瀵煎叆

---

## 馃攼 鍏€佸畨鍏ㄥ缓璁?
1. **鏁版嵁搴撴潈闄?*锛氱‘淇濇墍鏈夐泦鍚堥兘璁剧疆浜嗘纭殑璇诲啓鏉冮檺
2. **浜戝嚱鏁版潈闄?*锛氬湪 `config.json` 涓檺鍒朵笉蹇呰鐨?openapi 璋冪敤
3. **鏁忔劅鏁版嵁**锛氫笉瑕佸湪瀹㈡埛绔瓨鍌ㄦ晱鎰熶俊鎭?4. **鏃ュ織鐩戞帶**锛氬畾鏈熸鏌ヤ簯鍑芥暟鏃ュ織锛屽彂鐜板紓甯歌皟鐢?
---

## 馃摓 甯歌闂

### Q: 浜戝嚱鏁颁笂浼犲け璐ワ紵
A: 妫€鏌?`package.json` 涓殑渚濊禆鏄惁姝ｇ‘锛岀‘淇濆凡鎵ц `npm install`

### Q: 鏁版嵁搴撴煡璇㈡參锛?A: 纭繚宸叉坊鍔犲悎閫傜殑绱㈠紩锛岄伩鍏嶅叏琛ㄦ壂鎻?
### Q: 濡備綍鏌ョ湅浜戝嚱鏁版棩蹇楋紵
A: 寰俊寮€鍙戣€呭伐鍏?鈫?浜戝紑鍙?鈫?浜戝嚱鏁?鈫?鐐瑰嚮鍑芥暟鍚?鈫?鏃ュ織

---

*鏈€鍚庢洿鏂帮細2026-03-10*
