# GoldNote

GoldNote 是一个微信小程序，当前包含两个核心模块：黄金交易记录与收益分析、婚礼筹备管理。项目基于微信小程序原生能力开发，并接入微信云开发完成登录、交易与婚礼数据的跨设备同步。

## 当前功能

### 黄金笔记
- 持仓总览：显示总持仓、持仓收益、累计已实现收益、总收益率。
- 分平台分析：当前统一为民生、招商、浙商、其他四个平台。
- 交易录入：支持买入、卖出、手续费预览与净额记录。
- 历史分析：支持按平台、类型、时间范围筛选交易记录。
- 金价展示：支持实时价格卡片、收益曲线与分平台统计。

### 结婚笔记
- 婚礼基础信息：日期、地点、预算等信息维护。
- 备婚任务：任务类型、优先级、状态、截止日期管理。
- 亲友邀请：宾客状态、统计与跟进记录。
- 数据清理：支持清除当前账号下的婚礼数据。

## 技术栈

- 微信小程序原生框架
- JavaScript / WXML / WXSS
- 微信云开发
- PowerShell 部署脚本

## 项目结构

```text
goldnote/
├── app.js
├── app.json
├── app.wxss
├── cloudfunctions/        # 云函数源码
├── components/           # 通用组件
├── images/               # 图片资源
├── pages/
│   ├── history/          # 黄金历史记录
│   ├── index/            # 黄金首页
│   ├── login/            # 登录页
│   └── transaction/      # 黄金交易录入
├── utils/
│   ├── auth.js           # 登录与用户资料逻辑
│   ├── goldPrice.js      # 金价相关逻辑
│   └── storage.js        # 本地存储与业务计算
├── deploy-cloud.ps1      # 云函数部署脚本
└── database-indexes.json # 云数据库索引定义
```

## 本地运行

1. 使用微信开发者工具导入项目根目录。
2. 在微信开发者工具中配置你自己的 AppID，个人调试也可使用测试号。
3. 根据你的云开发环境修改 [app.js](app.js) 中的 `env` 配置。
4. 如需启用云端能力，先在微信开发者工具中开通云开发环境，再部署 `cloudfunctions` 目录中的函数。

## 云开发说明

项目默认使用以下几类云资源：

- 云函数：`login`、`getTransactions`、`saveTransaction`、`getWeddingData`、`saveWeddingData`
- 云数据库集合：`users`、`transactions`、`wedding_profiles`、`wedding_tasks`、`wedding_expenses`、`wedding_notes`、`wedding_invites`
- 云存储：头像、交易凭证、婚礼相关图片

详细步骤见 [CLOUD_DEPLOYMENT.md](CLOUD_DEPLOYMENT.md) 和 [CLOUD_SETUP_SUMMARY.md](CLOUD_SETUP_SUMMARY.md)。

## 计算口径

- 累计收益：仅统计已实现收益，不随实时金价波动。
- 持仓收益：按当前金价与持仓成本差额计算浮动盈亏。
- 平台分析：历史平台数据会归并到民生、招商、浙商、其他四个平台中。
- 卖出收益：优先按实际到账净额推导卖出单价，减少手续费对结果的偏差。

## 仓库使用建议

- `project.private.config.json`、日志文件、私钥文件不应提交。
- `deploy-cloud.ps1` 已支持通过参数或环境变量传入云环境 ID，避免继续写死到个人机器路径。
- 如果你要公开此仓库，建议将自己的云环境、AppID 和地图服务配置替换为团队或演示环境。

## 后续可扩展方向

- 补充婚礼页面的自动化测试与数据校验。
- 将云环境配置统一抽成单独配置模块。
- 为公开仓库补一份演示截图和使用录屏。