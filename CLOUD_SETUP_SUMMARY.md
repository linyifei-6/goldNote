# 浜戝紑鍙戦厤缃畬鎴愭€荤粨

## 鉁?宸插畬鎴愮殑宸ヤ綔

### 1. 浜戝嚱鏁板垱寤猴紙5 涓級

| 浜戝嚱鏁?| 鐘舵€?| 鏂囦欢璺緞 |
|--------|------|----------|
| `login` | 鉁?宸插垱寤?| `cloudfunctions/login/` |
| `getTransactions` | 鉁?宸插垱寤?| `cloudfunctions/getTransactions/` |
| `saveTransaction` | 鉁?宸插垱寤?| `cloudfunctions/saveTransaction/` |
| `getWeddingData` | 鉁?宸插垱寤?| `cloudfunctions/getWeddingData/` |
| `saveWeddingData` | 鉁?宸插垱寤?| `cloudfunctions/saveWeddingData/` |

### 2. 閰嶇疆鏂囦欢鍒涘缓

| 鏂囦欢 | 鐢ㄩ€?|
|------|------|
| `project.config.json` | 宸叉洿鏂颁簯鍑芥暟鐩綍閰嶇疆 |
| `database-indexes.json` | 鏁版嵁搴撶储寮曢厤缃?|
| `cloud-storage-config.json` | 浜戝瓨鍌ㄩ厤缃?|
| `CLOUD_DEPLOYMENT.md` | 瀹屾暣閮ㄧ讲鎸囧崡 |
| `deploy-cloud.ps1` | 涓€閿儴缃茶剼鏈?|
| `utils/cloud-example.js` | 浜戝嚱鏁拌皟鐢ㄧず渚?|

---

## 馃搵 鏁版嵁搴撻泦鍚堣璁?
### 鏍稿績闆嗗悎

```
users (鐢ㄦ埛)
鈹溾攢鈹€ _id: 鑷姩鐢熸垚鐨?ID
鈹溾攢鈹€ openId: 寰俊 OpenID
鈹溾攢鈹€ nickname: 鏄电О
鈹溾攢鈹€ avatarUrl: 澶村儚
鈹溾攢鈹€ gender: 鎬у埆
鈹溾攢鈹€ province: 鐪佷唤
鈹溾攢鈹€ country: 鍥藉
鈹溾攢鈹€ createdAt: 鍒涘缓鏃堕棿
鈹斺攢鈹€ lastLoginAt: 鏈€鍚庣櫥褰曟椂闂?
transactions (浜ゆ槗璁板綍)
鈹溾攢鈹€ _id: 鑷姩鐢熸垚鐨?ID
鈹溾攢鈹€ userId: 鐢ㄦ埛 ID
鈹溾攢鈹€ id: 浜ゆ槗缂栧彿 (濡?ZS0001)
鈹溾攢鈹€ type: buy/sell
鈹溾攢鈹€ price: 浠锋牸
鈹溾攢鈹€ weight: 鍏嬫暟
鈹溾攢鈹€ platform: 骞冲彴
鈹溾攢鈹€ date: 浜ゆ槗鏃ユ湡
鈹溾攢鈹€ fee_rate: 璐圭巼
鈹溾攢鈹€ fee_amount: 鎵嬬画璐?鈹溾攢鈹€ net_amount: 鍑€棰?鈹溾攢鈹€ timestamp: 鏃堕棿鎴?鈹溾攢鈹€ createdAt: 鍒涘缓鏃堕棿
鈹斺攢鈹€ updatedAt: 鏇存柊鏃堕棿
```

### 濠氱ぜ鐩稿叧闆嗗悎

```
wedding_profiles (濠氱ぜ妗ｆ)
鈹溾攢鈹€ userId
鈹溾攢鈹€ weddingDate
鈹溾攢鈹€ location
鈹溾攢鈹€ totalBudget
鈹斺攢鈹€ hasSaved

wedding_tasks (濠氱ぜ浠诲姟)
鈹溾攢鈹€ userId
鈹溾攢鈹€ title
鈹溾攢鈹€ type
鈹溾攢鈹€ dueDate
鈹溾攢鈹€ checked
鈹溾攢鈹€ priority
鈹溾攢鈹€ budgetAmount
鈹斺攢鈹€ actualAmount

wedding_expenses (濠氱ぜ鏀嚭)
鈹溾攢鈹€ userId
鈹溾攢鈹€ category
鈹溾攢鈹€ amount
鈹斺攢鈹€ date

wedding_notes (澶囧绗旇)
鈹溾攢鈹€ userId
鈹溾攢鈹€ title
鈹溾攢鈹€ content
鈹溾攢鈹€ module
鈹溾攢鈹€ stage
鈹斺攢鈹€ dueDate

wedding_invites (浜插弸閭€璇?
鈹溾攢鈹€ userId
鈹溾攢鈹€ linkCode
鈹溾攢鈹€ message
鈹斺攢鈹€ invitees
```

---

## 馃殌 涓嬩竴姝ユ搷浣?
### 鏂瑰紡 A锛氫娇鐢ㄩ儴缃茶剼鏈紙鎺ㄨ崘锛?
```powershell
# 鍦?PowerShell 涓墽琛?cd G:\Iflow\goldnote
.\deploy-cloud.ps1
```

### 鏂瑰紡 B锛氭墜鍔ㄩ儴缃?
1. **瀹夎 CLI**锛堝鏈畨瑁咃級
   ```bash
   npm install -g cloudbase-cli
   ```

2. **鐧诲綍**
   ```bash
   cloudbase login
   ```

3. **涓婁紶浜戝嚱鏁?*
   ```bash
   cd G:\Iflow\goldnote
   cloudbase functions:deploy login
   cloudbase functions:deploy getTransactions
   cloudbase functions:deploy saveTransaction
   cloudbase functions:deploy getWeddingData
   cloudbase functions:deploy saveWeddingData
   ```

4. **鍒涘缓鏁版嵁搴撻泦鍚?*
   - 鎵撳紑寰俊寮€鍙戣€呭伐鍏?   - 鐐瑰嚮"浜戝紑鍙? 鈫?"鏁版嵁搴?
   - 鍒涘缓 7 涓泦鍚堬紙瑙佷笂鏂囷級

5. **璁剧疆鏁版嵁搴撴潈闄?*
   - 姣忎釜闆嗗悎璁剧疆涓猴細`auth.openid == doc.userId`

6. **娣诲姞绱㈠紩**
   - 鍙傝€?`database-indexes.json`

---

## 馃摫 灏忕▼搴忕鏀归€?
闇€瑕佷慨鏀逛互涓嬫枃浠讹細

### 1. `app.js`
娣诲姞浜戝紑鍙戝垵濮嬪寲锛?```javascript
wx.cloud.init({
  env: 'goldnote-7gvcgw84da48b20a',
  traceUser: true
})
```

### 2. `utils/auth.js`
鍒涘缓鏂版枃浠讹紝灏佽浜戠櫥褰曢€昏緫锛堝弬鑰?`utils/cloud-example.js`锛?
### 3. `utils/storage.js`
灏嗘湰鍦板瓨鍌ㄦ敼涓轰簯鏁版嵁搴撹皟鐢?
### 4. 鍚勯〉闈?JS
灏?`storage.xxx()` 璋冪敤鏀逛负浜戝嚱鏁拌皟鐢?
---

## 馃攼 鏁版嵁搴撴潈闄愰厤缃?
鍦ㄥ井淇″紑鍙戣€呭伐鍏蜂簯寮€鍙戞帶鍒跺彴锛屼负姣忎釜闆嗗悎璁剧疆鏉冮檺锛?
**users 闆嗗悎锛?*
```json
{
  "read": "auth.openid == doc.openId",
  "write": "auth.openid == doc.openId"
}
```

**鍏朵粬闆嗗悎锛?*
```json
{
  "read": "auth.openid == doc.userId",
  "write": "auth.openid == doc.userId"
}
```

---

## 馃搳 浜戝嚱鏁拌皟鐢ㄧず渚?
```javascript
// 鐧诲綍
wx.cloud.callFunction({
  name: 'login',
  data: {}
}).then(res => console.log(res))

// 鑾峰彇浜ゆ槗璁板綍
wx.cloud.callFunction({
  name: 'getTransactions',
  data: { limit: 100 }
}).then(res => console.log(res))

// 淇濆瓨浜ゆ槗
wx.cloud.callFunction({
  name: 'saveTransaction',
  data: {
    action: 'create',
    transaction: {
      type: 'buy',
      price: 550.5,
      weight: 10,
      platform: '鎷涘晢',
      date: '2026-03-10'
    }
  }
})

// 鑾峰彇濠氱ぜ鏁版嵁
wx.cloud.callFunction({
  name: 'getWeddingData',
  data: { dataType: 'tasks' }
})
```

---

## 馃摓 楠岃瘉娓呭崟

- [ ] 浜戝嚱鏁板叏閮ㄤ笂浼犳垚鍔?- [ ] 鏁版嵁搴撻泦鍚堝凡鍒涘缓
- [ ] 鏁版嵁搴撴潈闄愬凡璁剧疆
- [ ] 鏁版嵁搴撶储寮曞凡娣诲姞
- [ ] 灏忕▼搴忕浠ｇ爜宸叉敼閫?- [ ] 娴嬭瘯鐧诲綍鍔熻兘姝ｅ父
- [ ] 娴嬭瘯浜ゆ槗璁板綍 CRUD 姝ｅ父
- [ ] 娴嬭瘯濠氱ぜ鏁版嵁鍔熻兘姝ｅ父

---

*閰嶇疆瀹屾垚鏃堕棿锛?026-03-10 21:50*
