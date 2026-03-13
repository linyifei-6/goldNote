# 金价API配置说明

## 当前状态

由于微信小程序的安全限制，第三方API域名需要在小程序后台配置白名单才能访问。

**当前使用：智能模拟器**
- 基于真实市场价格范围（1130-1155元/克，2026年3月）
- 模拟真实市场的波动特征
- 具有趋势性和连续性
- 适合开发测试和演示使用

## 方案一：配置合法域名（推荐）

如需获取真实金价，请按以下步骤配置：

### 1. 登录小程序管理后台
访问：https://mp.weixin.qq.com

### 2. 进入域名配置
- 点击左侧菜单：**开发** → **开发管理** → **开发设置**
- 找到 **服务器域名** 部分
- 点击 **request合法域名** 后的 **修改** 按钮

### 3. 添加以下域名
```
https://cdn-rili.jin10.com
https://hq.sinajs.cn
https://push2.eastmoney.com
https://qt.gtimg.cn
```

**推荐优先级：**
1. **金十数据**（https://cdn-rili.jin10.com）- 专业金融数据平台，最稳定
2. **新浪财经**（https://hq.sinajs.cn）- 数据更新快，可靠性高
3. **东方财富**（https://push2.eastmoney.com）- 数据全面
4. **腾讯财经**（https://qt.gtimg.cn）- 备用数据源

### 4. 保存并重新编译
- 点击保存
- 重新编译小程序
- 刷新页面即可看到真实金价

### 数据来源说明
- **金十数据**：专业金融数据平台，提供上海黄金交易所实时报价（优先推荐）
- **新浪财经**：
  - Au9999现货（hq.sinajs.cn/list=AU9999）- 国内沪金价格，元/克
  - Au(T+D)延期（hq.sinajs.cn/list=hf_CHA50CFD）- 上海金交所延期价格
  - ⚠️ 注意：不要使用hf_XAU接口，那是伦敦金（美元/盎司）
- **东方财富网**：上海金Au9999现货价格，需要单位转换处理
- **腾讯财经**：Au9999价格，备用数据源

所有数据源均查询国内沪金价格（元/克），自动切换确保数据可靠性。

## 方案二：使用云函数代理（无需配置域名）

如果无法配置域名白名单，可以使用云函数作为代理。

### 1. 开通云开发
- 在小程序管理后台开通云开发
- 创建云环境

### 2. 创建云函数
在项目中创建 `cloudfunctions/getGoldPrice/index.js`：

```javascript
const cloud = require('wx-server-sdk')
const axios = require('axios')

cloud.init()

exports.main = async (event, context) => {
  try {
    // 尝试东方财富API
    const response = await axios.get(
      'https://push2.eastmoney.com/api/qt/stock/get?secid=113.au9999&fields=f43,f58,f169,f170,f46,f44,f45,f47,f86'
    )
    
    const price = parseFloat(response.data.data.f43)
    
    return {
      success: true,
      price: parseFloat(price.toFixed(2)),
      source: 'eastmoney_au9999',
      timestamp: Date.now()
    }
  } catch (error) {
    return {
      success: false,
      error: error.message
    }
  }
}
```

### 3. 修改小程序代码
在 `utils/goldPrice.js` 中添加云函数调用：

```javascript
function fetchFromCloudFunction() {
  return new Promise((resolve, reject) => {
    wx.cloud.callFunction({
      name: 'getGoldPrice',
      success: res => {
        if (res.result.success) {
          resolve(res.result)
        } else {
          reject(new Error(res.result.error))
        }
      },
      fail: error => {
        reject(error)
      }
    })
  })
}
```

### 4. 更新调用逻辑
优先使用云函数获取金价。

## 方案三：使用自建服务器代理

如果有自己的服务器，可以搭建API代理：

### 1. 创建代理接口
在自己的服务器上创建接口，例如：
```
https://yourdomain.com/api/gold-price
```

### 2. 代理请求
服务器端代码请求第三方API并返回数据

### 3. 配置服务器域名
在小程序后台配置自己的服务器域名

## 智能模拟器说明

当前使用的智能模拟器特点：

### 价格范围
- 基准价：1143元/克
- 波动范围：1130-1155元/克
- 基于2026年3月真实市场价格区间

### 模拟特性
1. **连续性**：价格变化平滑，不会突变
2. **趋势性**：模拟市场的短期趋势
3. **均值回归**：价格偏离基准后会有回归倾向
4. **真实波动**：每次更新0.1-0.3元的微小波动，符合实际市场特征

### 适用场景
- ✅ 开发和测试
- ✅ 功能演示
- ✅ 用户体验评估
- ❌ 实际交易决策

## 常见问题

### Q1: 为什么不能直接访问第三方API？
A: 微信小程序出于安全考虑，只允许访问在后台配置过的域名。

### Q2: 模拟器的价格准确吗？
A: 模拟器基于真实价格区间，但不是实时市场价格，仅供参考。

### Q3: 配置域名需要多久生效？
A: 通常立即生效，如未生效请等待5-10分钟。

### Q4: 可以使用其他金价API吗？
A: 可以，修改 `utils/goldPrice.js` 中的API地址，并配置相应域名。**注意区分：**
- **国内金价**：Au9999、沪金，单位为元/克，价格范围1000-1500
- **国际金价**：伦敦金、COMEX黄金，单位为美元/盎司，价格范围1800-2500
- 不要混用，否则会导致价格错误显示

### Q5: 为什么显示的金价是5000多元？
A: 这通常是使用了错误的API接口（如新浪的hf_XAU），该接口返回的是伦敦金价格（美元/盎司），而不是国内金价（元/克）。已修复为正确的Au9999接口。

### Q6: 云函数有调用限制吗？
A: 小程序云开发有免费额度，超出后需要付费。详见微信云开发文档。

## 技术支持

如有问题，请查看以下资源：
- 微信小程序开发文档：https://developers.weixin.qq.com/miniprogram/dev/
- 微信云开发文档：https://developers.weixin.qq.com/miniprogram/dev/wxcloud/basis/getting-started.html

---

**建议：** 对于正式发布的小程序，强烈建议配置合法域名获取真实金价，以提供准确的数据服务。
