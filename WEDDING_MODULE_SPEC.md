# 婚礼笔记模块 功能说明文档

**版本**: 1.0.0  
**最后更新**: 2026年4月18日  
**模块路径**: `/pages/wedding/` 和 `/cloudfunctions/`

---

## 📑 文档目录

1. [模块概述](#模块概述)
2. [功能架构](#功能架构)
3. [核心功能详解](#核心功能详解)
4. [数据模型](#数据模型)
5. [交互流程](#交互流程)
6. [云函数接口](#云函数接口)
7. [业务规则](#业务规则)
8. [使用指南](#使用指南)
9. [故障排查](#故障排查)

---

## 模块概述

### 1.1 功能定位

婚礼笔记是 GoldNote 平台中的备婚管理中心，为新人夫妇提供**一站式备婚规划和追踪工具**。用户可以通过该模块：

- 📋 创建并管理备婚任务清单
- 💰 跟踪和预算控制
- 👥 邀请亲友并确认出席
- 💑 与伴侣实时共享工作进度（情侣模式）
- 📱 发布公开邀请页面供亲友查看

### 1.2 模块组成

| 组件 | 功能描述 | 文件位置 |
|------|--------|---------|
| **wedding** (主页面) | 综合备婚管理中心，包含任务/预算/亲友三个分区 | `pages/wedding/` |
| **weddingTasks** | 简化的任务列表视图，支持拖动排序 | `pages/wedding/weddingTasks.*` |
| **weddingGuest** | 公开邀请页面，亲友可查看婚期和留言 | `pages/wedding/weddingGuest.*` |
| **getWeddingData** | 云函数：读取婚礼数据 | `cloudfunctions/getWeddingData/` |
| **saveWeddingData** | 云函数：保存/更新婚礼数据 | `cloudfunctions/saveWeddingData/` |

### 1.3 技术栈

- **前端**: WeChat Mini Program (WXML/WXSS/JavaScript)
- **后端**: WeChat Cloud Functions
- **数据库**: MongoDB (通过 WeChat Cloud DB)
- **本地存储**: WeChat Storage API
- **认证**: WeChat OpenID 体系

---

## 功能架构

### 2.1 系统架构图

```
┌─────────────────────────────────────┐
│   WeChat Mini Program 前端           │
├─────────────────────────────────────┤
│  wedding.js (主界面)                 │
│  ├─ 任务分区  (Task Management)      │
│  ├─ 预算分区  (Budget Planning)      │
│  └─ 亲友分区  (Guest Management)     │
│                                      │
│  weddingTasks.js (快速任务视图)       │
│  weddingGuest.js (公开邀请页)        │
└──────────────┬──────────────────────┘
               │ 本地存储同步
               ↓
        WeChat Storage
        (wedding_profile_{userId}
         wedding_tasks_{userId}
         wedding_expenses_{userId}
         wedding_invites_{userId})
               │
               └─ 异步上传
                  ↓
┌─────────────────────────────────────┐
│   WeChat Cloud Functions             │
├─────────────────────────────────────┤
│  getWeddingData() - 数据读取          │
│  saveWeddingData() - 数据写入         │
└──────┬──────────────────────────────┘
       │ CRUD 操作
       ↓
┌─────────────────────────────────────┐
│   WeChat Cloud Database (MongoDB)    │
├─────────────────────────────────────┤
│  ├─ wedding_profiles                │
│  ├─ wedding_tasks                   │
│  ├─ wedding_expenses                │
│  ├─ wedding_notes                   │
│  └─ wedding_invites                 │
└─────────────────────────────────────┘
```

### 2.2 工作模式

#### 方式一：个人模式 (Solo Mode)

```
用户 A (新娘)
    │
    ├─ 婚礼工作区所有者: A 的 openid
    ├─ 本地存储 key: wedding_tasks_{A_openid}
    └─ 云端数据库 filter: userId === 'A_openid'
```

#### 方式二：情侣共管模式 (Couple Mode)

```
用户 A (新娘) ←─ 建立关系 (社交模块) ─→ 用户 B (新郎)
    │                                        │
    ├─────── 共享工作空间 ID ───────────────┤
    │                                        │
    └─ sharedWeddingOwnerId = 'COUPLE_ID'  ─┘
       │
       ├─ 本地存储 key: wedding_tasks_{COUPLE_ID}
       ├─ 云端数据库 filter: userId === 'COUPLE_ID'
       └─ A 和 B 数据完全同步，修改立即可见
```

**情侣模式激活条件**:
1. 通过 social 模块建立情侣关系
2. 双方都接受关系邀请
3. System 会自动分配 `sharedWeddingOwnerId`

---

## 核心功能详解

### 3.1 任务管理 (Task Management)

#### 3.1.1 功能概览

**任务分区** 是婚礼笔记的核心功能，支持：

| 功能 | 说明 |
|------|------|
| ✏️ **创建任务** | 输入标题、选择类型/优先级、设置截止日期、添加预算 |
| 🏷️ **分类标签** | 8 种预定义类型：婚纱摄影、婚宴酒店、婚礼策划等 |
| ⭐ **优先级** | 1-5 星评级，视觉化显示 |
| 📅 **截止日期** | 自动计算"已逾期""今日截止""3天内"等状态 |
| 🔍 **多维筛选** | 按类型、状态、优先级组合筛选 |
| 🔄 **排序** | 自定义排序、按日期、按类型、按创建时间 |
| 📦 **批量操作** | 多选模式下批量完成或删除 |
| ⏰ **到期提醒** | 浮层提示 10 天内到期的任务 |

#### 3.1.2 任务生命周期

```
创建
  │
  ├─ 在编辑
  │   │
  │   └─ 保存 → 本地存储 + 云端上传
  │
  ├─ 进行中
  │   ├─ 条件: dueDate > today
  │   └─ 显示剩余天数
  │
  ├─ 3天内截止 (soon)
  │   ├─ 条件: 0 < (dueDate - today) <= 3
  │   └─ 显示警告样式 (黄色)
  │
  ├─ 今日截止 (today)
  │   ├─ 条件: dueDate === today
  │   └─ 显示紧急样式 (橙色)
  │
  ├─ 已逾期 (overdue)
  │   ├─ 条件: dueDate < today && !checked
  │   └─ 显示逾期样式 (红色)
  │
  └─ 已完成 (done)
      ├─ 条件: checked === true
      └─ 显示删除线和灰色效果
```

#### 3.1.3 任务类型（8 种预定义）

| 序号 | 类型 | 排序索引 | 示例任务 |
|------|------|---------|---------|
| 1 | 婚纱摄影 | 0 | 选婚纱、定档期、试妆 |
| 2 | 婚宴酒店 | 1 | 定酒店、确认菜单、布置方案 |
| 3 | 婚礼策划 | 2 | 邀请嘉宾、确认流程、预订音乐 |
| 4 | 婚礼服务 | 3 | 化妆师、摄像、司仪 |
| 5 | 婚礼节点 | 4 | 送礼、敬酒、切蛋糕 |
| 6 | 婚品物料 | 5 | 喜糖、喜帖、礼炮 |
| 7 | 婚房装修 | 6 | 布置新房、购置家具 |
| 8 | 其他 | 7 | 自定义任务 |

#### 3.1.4 任务编辑模态框

用户可以在模态框中编辑任务的所有字段：

```
┌──────────────────────────────────┐
│  编辑任务                         │
├──────────────────────────────────┤
│ 📝 标题           [输入框]         │
│ 🏷️  类型           [下拉框]         │
│ ⭐ 优先级         [星评]           │
│ 📅 截止日期       [日期选择]       │
│ 💰 预算金额       [金额输入]       │
│ 💵 实际支出       [金额输入]       │
│ 📋 备注           [多行文本]       │
│ 🖼️  任务图片       [上传/预览]      │
│                                  │
│ [保存] [取消] [删除]              │
└──────────────────────────────────┘
```

**图片上传**:
- 存储路径: `wedding-task-images/{userId}/{timestamp}.jpg`
- 最大 5 张图片
- 自动上传到微信云存储

#### 3.1.5 任务筛选与排序

**快速筛选面板**:

```
┌─────────────────┐
│ 任务类型        │
├─────────────────┤
│ ☐ 婚纱摄影      │
│ ☐ 婚宴酒店      │
│ ☐ 婚礼策划      │
│ ... (8 种)      │
└─────────────────┘

┌─────────────────┐
│ 任务状态        │
├─────────────────┤
│ ✓ 全部          │
│ ✓ 未完成        │
│ ○ 已逾期        │
│ ○ 今日截止      │
└─────────────────┘

┌─────────────────┐
│ 排序方式        │
├─────────────────┤
│ ✓ 自定义排序    │
│ ○ 截止日期      │
│ ○ 任务类型      │
│ ○ 创建时间      │
│ ○ 优先级        │
└─────────────────┘
```

**排序逻辑**:
- **自定义排序**: 按 `sortOrder` 字段升序
- **截止日期**: 按 dueDate 升序（未设置日期的放最后）
- **任务类型**: 按类型索引升序
- **创建时间**: 按 createdAt 升序
- **优先级**: 按 priority 降序（5 星优先）

#### 3.1.6 到期提醒浮层

**自动显示条件**:
- 页面加载时触发一次检查
- 显示 10 天内到期且未完成的任务
- 最多显示 6 条

**模态框内容**:

```
┌──────────────────────────────┐
│ 🔔 最近 10 天的待办事项       │
├──────────────────────────────┤
│ • 选婚纱 (1 天后)            │
│ • 定酒店 (3 天后)            │
│ • 邀请嘉宾 (已逾期 2 天)      │
│ • ... (最多 6 条)             │
│                              │
│ [知道了] [查看全部]           │
└──────────────────────────────┘
```

**意义**: 帮助用户一眼了解最紧迫的任务。

#### 3.1.7 批量操作

**激活方式**: 点击"选择"按钮 → 进入多选模式

```
进入多选模式
  │
  ├─ 每个任务前显示 ☑️ 复选框
  ├─ 点击复选框选中任务
  ├─ 页面底部显示
  │  ├─ 已选: 3 项
  │  ├─ [全选] [反选]
  │  └─ [批量完成] [批量删除]
  │
  └─ 操作完成后自动退出多选模式
```

**批量删除**: 需要二次确认（防误删）

---

### 3.2 预算管理 (Budget Planning)

#### 3.2.1 功能概览

**预算分区** 帮助用户追踪和控制婚礼总支出：

```
总预算 (来自基础资料)
  │
  ├─ 已用预算
  │   ├─ 其他支出 (单独记录的临时支出)
  │   └─ 任务实际 (所有任务的 actualAmount 总和)
  │
  └─ 剩余预算 = 总预算 - 已用预算
      └─ 如果为负数则显示红色告警
```

#### 3.2.2 预算数据来源

| 预算类型 | 数据来源 | 说明 |
|---------|---------|------|
| **总预算** | `wedding_profile.totalBudget` | 用户在基础资料中设置的总预算 |
| **其他支出** | `wedding_expenses[]` 数组 | 临时支出记录，独立于任务 |
| **任务预算** | 每个 task 的 `budgetAmount` | 任务的计划预算（参考用） |
| **任务实际** | 每个 task 的 `actualAmount` | 任务的实际支出（用于计算） |

#### 3.2.3 支出记录管理

**添加支出**:

```
┌──────────────────────────┐
│ 添加其他支出              │
├──────────────────────────┤
│ 类别 [下拉框]            │
│  ├─ 场地预定             │
│  ├─ 餐饮饮料             │
│  ├─ 装饰布景             │
│  ├─ 礼物特产             │
│  ├─ 化妆造型             │
│  ├─ 摄影摄像             │
│  └─ 其他                 │
│                          │
│ 金额 [￥ 输入框]          │
│ 日期 [日期选择]          │
│                          │
│ [保存] [取消]            │
└──────────────────────────┘
```

**支出列表**:
- 按日期倒序显示
- 每条显示: 类别 + 日期 + 金额
- 支持删除单条记录

#### 3.2.4 预算分析面板

**显示内容**:

```
┌──────────────────────────────┐
│ 💰 预算概览                   │
├──────────────────────────────┤
│ 总预算    ¥ 500,000           │
│ │                             │
│ ├─ 方案 A (任务分类)          │
│ │  ├─ 婚纱摄影  ¥ 8,000 (预)  │
│ │  ├─          ¥ 7,500 (实)  │
│ │  ├─ 婚宴酒店  ¥ 120,000 (预)│
│ │  └─          ¥ 120,000 (实)│
│ │                             │
│ ├─ 其他支出    ¥ 50,000       │
│ │                             │
│ └─ 已用预算    ¥ 177,500      │
│                               │
│ 剩余预算    ¥ 322,500         │
│ ✓ 预算充足                    │
└──────────────────────────────┘
```

**预算告警**:
- 剩余 < 0: 显示"⚠️ 预算超支"（红色）
- 剩余 < 50000: 显示"⚠️ 预算紧张"（黄色）

---

### 3.3 亲友管理 (Guest Management)

#### 3.3.1 功能概览

**亲友分区** 允许新人管理邀请和亲友确认状态：

| 功能 | 说明 |
|------|------|
| 📨 **邀请链接** | 生成可分享的邀请链接、邀请语编辑 |
| 👥 **亲友列表** | 显示所有受邀亲友的确认状态 |
| 📊 **统计信息** | 已确认/未确认人数 |
| ✍️ **手动添加** | 添加亲友记录和确认状态 |

#### 3.3.2 邀请链接管理

**邀请链接格式**:

```
/pages/weddingGuest/weddingGuest?code={linkCode}

示例:
/pages/weddingGuest/weddingGuest?code=WI202604180001
```

**邀请链接功能**:

```
┌──────────────────────────────┐
│ 💌 邀请亲友                   │
├──────────────────────────────┤
│ 邀请语编辑:                   │
│ ┌─────────────────────────┐  │
│ │ 诚邀您见证我们的婚礼。  │  │
│ │ 期待您的祝福！          │  │
│ └─────────────────────────┘  │
│                               │
│ 邀请链接:                      │
│ /pages/weddingGuest/...?code= │
│ WI202604180001                │
│                               │
│ [复制链接] [分享卡片]          │
│                               │
│ 确认状态:                      │
│ ✓ 已确认: 28 人                │
│ ○ 未确认: 12 人                │
└──────────────────────────────┘
```

**链接分享方式**:
1. 复制链接分享到聊天/微信群
2. 转发为微信卡片
3. 生成 QR 码（可选）

#### 3.3.3 亲友列表

**显示字段**:

```
┌────────────────────────────┐
│ 姓名        确认状态  操作   │
├────────────────────────────┤
│ 张三        ✓ 已确认  编辑   │
│ 李四        ○ 未确认  编辑   │
│ 王五        ✓ 已确认  删除   │
│ ...                         │
│                             │
│ 统计: 已确认 28 人 未确认 12 人│
└────────────────────────────┘
```

**亲友状态操作**:
- 单击状态标记切换确认/未确认
- 编辑: 修改亲友信息
- 删除: 删除亲友记录

#### 3.3.4 手动添加亲友

```
┌──────────────────────────────┐
│ 手动添加亲友                   │
├──────────────────────────────┤
│ 姓名 [输入框]                │
│ 状态 ○ 已确认 ○ 未确认       │
│                              │
│ [添加] [取消]                │
└──────────────────────────────┘
```

---

### 3.4 亲友邀请页 (Wedding Guest Page)

#### 3.4.1 访问方式

**方式 A：通过邀请链接（无需登录）**

```
亲友收到邀请链接
  │
  └─ 点击链接 → weddingGuest?code=WI...
      │
      ├─ 检查 code 有效性
      ├─ 从云端读取邀请信息
      └─ 显示公开内容（不显示详细地点）
```

**方式 B：通过 openid（需登录）**

```
已登录用户
  │
  └─ 访问 weddingGuest?ownerId=...&login=1
      │
      ├─ 验证用户身份
      ├─ 检查访问权限（是否是邀请亲友）
      └─ 显示完整内容（包含详细地点）
```

#### 3.4.2 页面布局

```
┌─────────────────────────────────────┐
│                                      │
│        🎊  婚礼盛典  🎊              │
│                                      │
│    新人姓名: 小王 & 小李             │
│                                      │
│    诚邀您见证                        │
│    我们的婚礼时刻                    │
│                                      │
├─────────────────────────────────────┤
│                                      │
│    📅 距离婚礼还有 45 天               │
│                                      │
│  [详细信息] [返回]                   │
│                                      │
├─────────────────────────────────────┤
│  💬 祝福留言 (仅限已登录用户)        │
│                                      │
│  张三: 祝你们新婚快乐！              │
│  李四: 白头偕老，永远相爱！          │
│  ...                                 │
│                                      │
│  [写留言]                            │
│                                      │
└─────────────────────────────────────┘
```

#### 3.4.3 倒计时显示逻辑

```javascript
days = weddingDate - today;

if (days > 0) {
  // 婚礼未开始
  countdownText = `距离婚礼还有 ${days} 天`;
  color = 'blue';
} else if (days === 0) {
  // 婚礼当天
  countdownText = '今天是婚礼日，欢迎见证幸福时刻';
  color = 'red';
} else {
  // 婚礼已结束
  countdownText = `婚礼已圆满结束 ${-days} 天`;
  color = 'gray';
}
```

#### 3.4.4 权限控制

**未登录访问 (通过 code)**:
```
显示内容:
✓ 新人姓名
✓ 邀请语
✓ 倒计时
✗ 详细日期 (提示"成为亲友后可查看")
✗ 详细地点 (提示"成为亲友后可查看")
✗ 祝福留言 (需登录)
```

**已登录访问**:
```
显示内容:
✓ 新人姓名
✓ 邀请语
✓ 倒计时
✓ 详细日期
✓ 详细地点
✓ 祝福留言 + 输入框
```

**权限判定**:
```javascript
canViewDetails = (userLogin && userInInviteList) || isOwnData;
```

#### 3.4.5 祝福留言墙

**留言功能**:
- 仅限已登录用户
- 支持文本输入和表情
- 留言实时显示在列表
- 显示用户昵称和留言时间
- 支持删除自己的留言

**留言存储**:
- 存储位置: `wedding_notes` 集合
- 字段: `{id, ownerId, userId, message, createdAt}`

---

### 3.5 情侣模式 (Couple Mode)

#### 3.5.1 模式激活

**步骤**:

1. **社交模块申请**: 用户 A (新娘) 通过 social 模块向用户 B (新郎) 发起情侣关系申请
2. **双向确认**: 用户 B 接受申请
3. **系统配置**: System 自动分配 `sharedWeddingOwnerId`
4. **数据迁移**: 将 A 和 B 各自的婚礼数据合并到共享 ID

#### 3.5.2 工作原理

**共享工作空间**:

```
用户 A 本地存储:
  wedding_profile_{COUPLE_ID}
  wedding_tasks_{COUPLE_ID}
  wedding_expenses_{COUPLE_ID}

用户 B 本地存储:
  wedding_profile_{COUPLE_ID}
  wedding_tasks_{COUPLE_ID}
  wedding_expenses_{COUPLE_ID}

云端数据库 filter:
  userId === 'COUPLE_ID'
```

**实时同步**:
- 用户 A 修改任务 → 保存到本地 + 云端
- 用户 B 打开 wedding 页面 → 从云端拉取最新数据
- 数据完全一致，无冲突

#### 3.5.3 角色区分

虽然数据共享，但系统记录了用户身份：

```javascript
// 确定工作空间所有者
weddingWorkspaceOwnerId = social.getWeddingWorkspaceRole() === 'couple' 
  ? couple.sharedWeddingOwnerId 
  : currentUser.openid;

// 记录修改者
data.modifiedBy = currentUser.openid;
```

**应用场景**:
- 新娘修改任务 → 显示"小王 更新了此任务"
- 新郎删除支出 → 显示"小李 删除了支出记录"

#### 3.5.4 解除情侣关系

**流程**:
1. 一方通过 social 模块提交解除申请
2. 另一方确认解除
3. 系统拆分共享数据：
   - 各自保留一份当前快照副本
   - 新建各自的工作空间 ID
   - 后续修改各自独立

---

## 数据模型

### 4.1 本地存储结构

#### 4.1.1 storage key 命名规范

```
wedding_profile_{userId}      // 婚礼档案
wedding_tasks_{userId}        // 任务列表 (数组)
wedding_expenses_{userId}     // 支出记录 (数组)
wedding_notes_{userId}        // 笔记/留言 (数组, 预留)
wedding_invites_{userId}      // 邀请配置 (单个对象)
```

**说明**: `userId` 可能是当前用户的 openid 或情侣模式下的 `sharedWeddingOwnerId`

#### 4.1.2 数据结构

##### wedding_profile

```javascript
{
  // 基础信息
  weddingDate: "2025-06-15",           // 日期格式 YYYY-MM-DD
  location: "北京市朝阳区",
  totalBudget: 500000,                 // 单位：元，数值类型
  
  // 元数据
  hasSaved: true,                      // 是否已同步到云端
  updatedAt: "2026-04-18T10:30:00Z",   // ISO 8601 timestamp
  _id: "mongodb_object_id"             // 云端 ID (同步后)
}
```

##### wedding_task

```javascript
{
  // 唯一标识
  id: "WT1713421400123456",            // WT + timestamp + random(6)
  
  // 基本信息
  title: "选婚纱",
  type: "婚纱摄影",                    // 8 种预定义类型之一
  priority: 3,                         // 1-5 星
  dueDate: "2025-05-01",               // YYYY-MM-DD 或 null
  
  // 状态
  checked: false,                      // 是否完成
  status: "进行中",                    // 自动计算: 进行中|今日截止|3天内|已逾期|已完成
  
  // 预算
  budgetAmount: 8000,                  // 计划预算 (元)
  actualAmount: 7500,                  // 实际支出 (元)
  budgetRemarks: "不超过8500",          // 预算备注
  
  // 备注和图片
  note: "去XXX影楼试纱，带上婚纱参考图",
  noteImages: [
    "wedding-task-images/openid/1713421400001.jpg",
    "wedding-task-images/openid/1713421400002.jpg"
  ],                                    // 云存储文件 ID 数组，max 5
  
  // 排序
  sortOrder: 0,                        // 拖动排序后的顺序
  
  // 时间戳
  createdAt: "2026-04-18T10:00:00Z",
  updatedAt: "2026-04-18T10:30:00Z",
  
  // 云端字段
  _id: "mongodb_object_id",
  userId: "openid"                     // 工作空间所有者 openid
}
```

##### wedding_expense

```javascript
{
  id: "WE1713421400123456",            // WE + timestamp + random(6)
  
  category: "场地预定",                // 7 种分类
  amount: 120000,                      // 单位：元
  date: "2025-04-10",                  // YYYY-MM-DD
  remark: "酒店首期定金",
  
  createdAt: "2026-04-18T10:00:00Z",
  updatedAt: "2026-04-18T10:30:00Z",
  
  _id: "mongodb_object_id",
  userId: "openid"
}
```

##### wedding_invite

```javascript
{
  id: "INVITE_MAIN",                   // 固定值，一对新人只有一条记录
  
  linkCode: "WI202604180001",          // 邀请码
  ownerName: "小王&小李",              // 新人姓名
  
  inviteMessage: "诚邀您见证我们的婚礼。期待您的祝福！",
  
  invitees: [
    {
      id: "WG{id}",
      name: "张三",
      status: "已确认"                  // "已确认" | "未确认"
    },
    {
      id: "WG{id}",
      name: "李四",
      status: "未确认"
    }
  ],                                    // 亲友列表
  
  createdAt: "2026-04-18T10:00:00Z",
  _id: "mongodb_object_id",
  userId: "openid"
}
```

##### wedding_note (留言)

```javascript
{
  id: "WN{timestamp}{random}",
  
  ownerId: "新人的openid",              // 拥有者
  userId: "留言者的openid",             // 谁留的言
  userNickname: "张三",
  userAvatar: "https://...",
  
  message: "祝你们新婚快乐！",
  
  createdAt: "2026-04-18T10:00:00Z",
  
  _id: "mongodb_object_id"
}
```

### 4.2 云数据库集合

| 集合名 | 说明 | 主要字段 |
|-------|------|---------|
| `wedding_profiles` | 婚礼档案 | _id, userId, weddingDate, location, totalBudget |
| `wedding_tasks` | 任务列表 | _id, userId, id, title, type, dueDate, checked, priority |
| `wedding_expenses` | 支出记录 | _id, userId, id, category, amount, date |
| `wedding_notes` | 笔记留言 | _id, ownerId, userId, message, createdAt |
| `wedding_invites` | 邀请配置 | _id, userId, linkCode, invitees, inviteMessage |

### 4.3 数据完整性规则

| 字段 | 类型 | 验证规则 | 示例 |
|------|------|---------|------|
| **id** | String | 非空，唯一 | "WT1713421400123456" |
| **title** | String | 非空，长度 1-100 | "选婚纱" |
| **dueDate** | String | 格式 YYYY-MM-DD 或 null | "2025-05-01" |
| **type** | String | 必须在 8 种类型内 | "婚纱摄影" |
| **priority** | Number | 整数 1-5 | 3 |
| **amount** | Number | 非负整数 | 8000 |
| **checked** | Boolean | 必须为 true/false | true |
| **createdAt** | String | ISO 8601 | "2026-04-18T10:00:00Z" |

---

## 交互流程

### 5.1 页面初始化流程

#### 5.1.1 wedding.js 的 onShow 流程

```
页面显示 (onShow)
  │
  ├─ Step 1: 同步云端关系数据
  │   └─ social.syncRelationsFromCloud()
  │
  ├─ Step 2: 确定婚礼工作区所有者
  │   ├─ 检查是否有 sharedWeddingOwnerId (情侣模式)
  │   │   └─ 如果有 → weddingWorkspaceOwnerId = sharedWeddingOwnerId
  │   └─ 如果没有 → weddingWorkspaceOwnerId = currentUser.openid (个人模式)
  │
  ├─ Step 3: 同步云端婚礼数据到本地
  │   └─ storage.syncWeddingDataFromCloud(weddingWorkspaceOwnerId)
  │      ├─ 调用 getWeddingData 云函数 (dataType='profile', 'tasks', 等)
  │      ├─ 更新本地 storage key (wedding_profile_{ID} 等)
  │      └─ merge 本地修改 (若存在冲突)
  │
  ├─ Step 4: 加载本地数据到页面
  │   ├─ loadWeddingProfile()    → page.data.weddingDate 等
  │   ├─ loadTasks()             → page.data.tasks[]
  │   ├─ loadExpenses()          → page.data.expenses[]
  │   ├─ loadInviteData()        → page.data.invitees[]
  │   └─ computeCoupleSummary()  → page.data.coupleSummary
  │
  ├─ Step 5: 计算任务统计
  │   ├─ 任务总数、完成数、逾期数
  │   ├─ 自动判定任务状态 (进行中/逾期/3天内 等)
  │   └─ page.setData({ ... })
  │
  └─ Step 6: 触发到期提醒
      └─ checkUpcomingTasks() → 显示浮层
```

#### 5.1.2 weddingGuest.js 的初始化流程

```
page onLoad (可能来自邀请链接)
  │
  ├─ Step 1: 提取参数
  │   ├─ code (邀请码)
  │   └─ ownerId (新人 openid，可选)
  │
  ├─ Step 2: 判断访问权限
  │   ├─ 如果有 code → 无需登录，公开访问
  │   ├─ 如果有 ownerId → 需验证登录且检查权限
  │   └─ 否则 → 提示错误
  │
  ├─ Step 3: 读取邀请页数据
  │   └─ 调用 getWeddingData 云函数
  │        └─ dataType = 'guestViewByCode' (若 code 存在)
  │
  ├─ Step 4: 显示内容
  │   ├─ 新人姓名
  │   ├─ 邀请语
  │   ├─ 倒计时
  │   ├─ 若已登录 → 显示详细日期、地点、留言框
  │   └─ 若未登录 → 隐藏详细信息
  │
  └─ Step 5: 加载留言列表 (若已登录)
      └─ 从 wedding_notes 集合查询
```

### 5.2 创建任务流程

```
用户点击"添加任务"
  │
  ├─ 显示输入框
  │   ├─ 标题 (必填)
  │   ├─ 类型选择 (下拉框)
  │   ├─ 优先级 (星评选择器)
  │   ├─ 截止日期 (日期选择)
  │   ├─ 预算金额 (输入框)
  │   └─ 实际支出 (输入框)
  │
  ├─ 用户输入并点击"保存"
  │   ├─ 验证必填字段 (标题)
  │   ├─ 验证日期格式
  │   └─ 验证金额非负
  │
  ├─ 创建任务对象
  │   ├─ 生成唯一 id: "WT" + timestamp + random(6)
  │   ├─ 初始化 checked = false
  │   ├─ 初始化 sortOrder = 0 (排在最后)
  │   └─ 设置 createdAt = now()
  │
  ├─ 保存到本地存储 (同步)
  │   └─ storage.setJSON(`wedding_tasks_{userId}`, [...tasks, newTask])
  │
  ├─ 异步上传云端 (fireAndForget)
  │   ├─ 调用 saveWeddingData 云函数
  │   │   └─ action='create', dataType='tasks', data=newTask
  │   ├─ 若成功 → 更新本地 _id 字段
  │   └─ 若失败 → 记录日志 (不中断用户操作)
  │
  ├─ 页面更新
  │   ├─ page.setData({ tasks: [...] })
  │   ├─ 重新计算任务统计
  │   └─ 显示成功提示
  │
  └─ 清空输入框，退出编辑模式
```

### 5.3 编辑任务流程

```
用户点击任务条目
  │
  ├─ 打开编辑模态框
  │   └─ 加载当前任务的所有字段
  │
  ├─ 用户修改字段
  │   ├─ 可修改任何字段
  │   ├─ 若上传图片 → 上传到云存储
  │   │   └─ 路径: wedding-task-images/{userId}/{timestamp}.jpg
  │   └─ 收集修改项
  │
  ├─ 用户点击"保存"
  │   ├─ 验证修改后的值
  │   └─ 合并到原任务对象
  │
  ├─ 更新本地存储 (同步)
  │   └─ storage.updateJSON(`wedding_tasks_{userId}`, id, updatedTask)
  │
  ├─ 异步上传云端 (fireAndForget)
  │   └─ saveWeddingData: action='update', dataType='tasks'
  │
  └─ 关闭模态框，刷新任务列表
```

### 5.4 任务排序流程 (weddingTasks 页面)

```
用户长按任务
  │
  ├─ 进入拖动模式
  │   └─ 显示"点击目标位置"提示
  │
  ├─ 用户点击目标位置
  │   ├─ 计算新的排序顺序
  │   ├─ 更新所有受影响任务的 sortOrder 字段
  │   └─ page.setData({ tasks: reorderedTasks })
  │
  ├─ 保存到本地存储 (同步)
  │   └─ storage.setJSON(`wedding_tasks_{userId}`, reorderedTasks)
  │
  ├─ 异步上传云端 (fireAndForget)
  │   ├─ 遍历所有受影响的任务
  │   └─ 调用 saveWeddingData (action='update')
  │
  └─ 退出拖动模式
```

### 5.5 预算计算流程

```
页面显示或数据更新
  │
  ├─ Step 1: 读取总预算
  │   └─ totalBudget = profile.totalBudget
  │
  ├─ Step 2: 汇总已用预算
  │   ├─ otherExpenses = sum(expenses[].amount)
  │   ├─ taskActuals = sum(tasks[].actualAmount)
  │   └─ usedBudget = otherExpenses + taskActuals
  │
  ├─ Step 3: 计算剩余预算
  │   └─ remainingBudget = totalBudget - usedBudget
  │
  ├─ Step 4: 判断预算状态
  │   ├─ 如果 remaining >= totalBudget * 0.1 → "预算充足" (绿色)
  │   ├─ 如果 0 <= remaining < totalBudget * 0.1 → "预算紧张" (黄色)
  │   └─ 如果 remaining < 0 → "预算超支" (红色)
  │
  └─ Step 5: 更新页面显示
      └─ page.setData({ budgetSummary: {...} })
```

### 5.6 情侣模式激活流程

```
用户 A 和用户 B 建立情侣关系 (通过 social 模块)
  │
  ├─ Step 1: 社交关系建立
  │   ├─ A 发起邀请 → social 集合中新增关系记录
  │   └─ B 接受邀请 → 关系状态变为 'accepted'
  │
  ├─ Step 2: System 分配共享工作空间 ID
  │   ├─ sharedWeddingOwnerId = 'COUPLE_ID'
  │   └─ 在 relations 集合中记录该 ID
  │
  ├─ Step 3: 数据合并
  │   ├─ 读取 A 的 wedding_profile_{A}
  │   ├─ 读取 B 的 wedding_profile_{B}
  │   ├─ 合并两份数据 (冲突时取较新的)
  │   └─ 存储到 wedding_profile_{COUPLE_ID}
  │
  ├─ Step 4: 本地存储迁移
  │   ├─ A 的本地 key: wedding_tasks_{A} → wedding_tasks_{COUPLE_ID}
  │   └─ B 的本地 key: wedding_tasks_{B} → wedding_tasks_{COUPLE_ID}
  │
  └─ Step 5: 下次打开 wedding 页面
      └─ 两人都从 wedding_tasks_{COUPLE_ID} 读取和修改
```

---

## 云函数接口

### 6.1 getWeddingData 云函数

#### 6.1.1 功能描述

提供婚礼数据的**只读接口**，支持多种查询场景。

#### 6.1.2 接口签名

```javascript
/**
 * @param {Object} event 请求对象
 * @param {string} event.dataType - 数据类型，可选值: 
 *   'profile' | 'tasks' | 'expenses' | 'notes' | 'invites' | 'guestViewByCode'
 * @param {string} event.userId - (可选) 目标用户 openid，默认为当前用户
 * @param {string} event.code - (可选) 邀请码，用于公开查询 (dataType='guestViewByCode')
 * @param {string} event.ownerId - (可选) 新人 openid，用于查询特定工作空间
 * @returns {Object} {success, data, dataType, message}
 */
exports.main = async (event) => {
  // ...
}
```

#### 6.1.3 请求示例

**示例 1：读取自己的任务列表**

```javascript
// 前端调用
wx.cloud.callFunction({
  name: 'getWeddingData',
  data: {
    dataType: 'tasks'
    // 默认使用当前用户 openid
  }
})

// 响应
{
  success: true,
  dataType: 'tasks',
  data: [
    {
      id: 'WT...',
      title: '选婚纱',
      type: '婚纱摄影',
      dueDate: '2025-05-01',
      checked: false,
      ...
    },
    ...
  ]
}
```

**示例 2：读取邀请页（公开，无需登录）**

```javascript
// 前端调用
wx.cloud.callFunction({
  name: 'getWeddingData',
  data: {
    dataType: 'guestViewByCode',
    code: 'WI202604180001'
  }
})

// 响应
{
  success: true,
  dataType: 'guestViewByCode',
  data: {
    inviteCode: 'WI202604180001',
    ownerName: '小王&小李',
    weddingDate: '2025-06-15',
    weddingLocation: '北京市朝阳区',
    inviteMessage: '诚邀您见证我们的婚礼。',
    totalTasks: 42,
    completedTasks: 18,
    guestCount: {
      confirmed: 28,
      unconfirmed: 12
    }
  }
}
```

**示例 3：读取特定工作空间的数据 (情侣模式)**

```javascript
// 前端调用
wx.cloud.callFunction({
  name: 'getWeddingData',
  data: {
    dataType: 'tasks',
    ownerId: 'COUPLE_ID'  // 指定工作空间
  }
})
```

#### 6.1.4 响应格式

**成功响应**:

```javascript
{
  success: true,
  dataType: 'tasks',
  data: [
    { /* task object */ },
    { /* task object */ }
  ]
}
```

**失败响应**:

```javascript
{
  success: false,
  message: '用户未授权访问此数据',
  dataType: 'tasks'
}
```

#### 6.1.5 支持的 dataType

| dataType | 返回类型 | 说明 |
|----------|---------|------|
| **profile** | Object | 单个婚礼档案 |
| **tasks** | Array | 任务列表 |
| **expenses** | Array | 支出记录 |
| **invites** | Object | 邀请配置 |
| **notes** | Array | 笔记/留言 |
| **guestViewByCode** | Object | 邀请页数据（公开） |

---

### 6.2 saveWeddingData 云函数

#### 6.2.1 功能描述

提供婚礼数据的**读写接口**，支持创建、更新、删除操作。

#### 6.2.2 接口签名

```javascript
/**
 * @param {Object} event 请求对象
 * @param {string} event.action - 操作类型: 'create' | 'update' | 'upsert' | 'delete' | 'confirm'
 * @param {string} event.dataType - 数据类型: 'profile' | 'tasks' | 'expenses' | 'invites' | 'notes' | 'guestAttendanceByCode'
 * @param {Object} event.data - 数据对象 (create/update 时必需)
 * @param {string} event.id - 记录 ID (update/delete 时必需)
 * @param {string} event.userId - (可选) 目标用户，默认为当前用户
 * @param {string} event.code - (可选) 邀请码 (confirm 操作)
 * @param {string} event.guestName - (可选) 亲友姓名 (confirm 操作)
 * @returns {Object} {success, _id, id, message}
 */
exports.main = async (event) => {
  // ...
}
```

#### 6.2.3 请求示例

**示例 1：创建任务**

```javascript
wx.cloud.callFunction({
  name: 'saveWeddingData',
  data: {
    action: 'create',
    dataType: 'tasks',
    data: {
      title: '选婚纱',
      type: '婚纱摄影',
      priority: 3,
      dueDate: '2025-05-01',
      budgetAmount: 8000,
      actualAmount: 0,
      note: '去XXX影楼试纱'
    }
  }
})

// 成功响应
{
  success: true,
  _id: 'mongodb_object_id',
  id: 'WT1713421400123456',
  message: '创建成功'
}
```

**示例 2：更新任务**

```javascript
wx.cloud.callFunction({
  name: 'saveWeddingData',
  data: {
    action: 'update',
    dataType: 'tasks',
    id: 'WT1713421400123456',
    data: {
      checked: true,
      actualAmount: 7500,
      updatedAt: '2026-04-18T10:30:00Z'
    }
  }
})

// 成功响应
{
  success: true,
  message: '更新成功'
}
```

**示例 3：删除任务**

```javascript
wx.cloud.callFunction({
  name: 'saveWeddingData',
  data: {
    action: 'delete',
    dataType: 'tasks',
    id: 'WT1713421400123456'
  }
})

// 成功响应
{
  success: true,
  message: '删除成功'
}
```

**示例 4：确认亲友出席 (通过邀请码)**

```javascript
wx.cloud.callFunction({
  name: 'saveWeddingData',
  data: {
    action: 'confirm',
    dataType: 'guestAttendanceByCode',
    code: 'WI202604180001',
    guestName: '张三',
    status: '已确认'
  }
})

// 成功响应
{
  success: true,
  message: '亲友状态已更新'
}
```

**示例 5：发布留言**

```javascript
wx.cloud.callFunction({
  name: 'saveWeddingData',
  data: {
    action: 'create',
    dataType: 'notes',
    data: {
      ownerId: '新人openid',
      message: '祝你们新婚快乐！',
      userNickname: '当前用户昵称',
      userAvatar: 'https://...'
    }
  }
})

// 成功响应
{
  success: true,
  _id: 'mongodb_object_id',
  message: '留言已发布'
}
```

#### 6.2.4 数据规范化

云函数在保存前自动对数据进行验证和规范化：

```javascript
// normalizeByDataType(dataType, data)

// tasks:
- title: trim + max 100 chars
- type: 检查是否在 8 种类型内
- priority: 整数转换, 1-5 范围
- dueDate: 验证 YYYY-MM-DD 格式
- budgetAmount: 非负整数
- checked: 强制 boolean

// expenses:
- category: 检查是否在 7 种分类内
- amount: 非负整数
- date: 验证 YYYY-MM-DD 格式

// profile:
- totalBudget: 非负整数
- location: trim + max 100 chars
```

#### 6.2.5 自动生成字段

创建新记录时，云函数自动填充：

```javascript
{
  id: 'WT' + Date.now() + Math.random().toString(36).substr(2,6),
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  userId: event.userInfo.openId,  // 当前用户 openid
  modifiedBy: event.userInfo.openId
}
```

---

## 业务规则

### 7.1 核心业务规则

| 规则 | 说明 | 影响 |
|------|------|------|
| **数据隔离** | 所有查询都按 userId 过滤 | 用户只能看到自己的数据 |
| **情侣共管** | 情侣模式下数据完全共享 | 两人修改立即对方可见 |
| **任务状态自动计算** | 根据 dueDate 和 checked 计算 | 不需要手动更新状态字段 |
| **预算自动汇总** | 实时计算已用和剩余 | 超支时显示警告 |
| **异步同步** | 本地先写，然后上传云端 | 不阻塞 UI，网络失败不中断 |
| **倒计时不实时** | onShow 时计算一次 | 用户回到页面时刷新，不是实时更新 |
| **排序持久化** | sortOrder 字段保存在数据库 | 关闭 app 后排序保留 |

### 7.2 任务状态判定规则

```javascript
function getTaskStatus(task, today) {
  if (task.checked) return 'done';
  
  if (!task.dueDate) return '未设置';
  
  const diffDays = calculateDaysDiff(task.dueDate, today);
  
  if (diffDays < 0) return 'overdue';      // 已逾期
  if (diffDays === 0) return 'today';      // 今日截止
  if (0 < diffDays <= 3) return 'soon';    // 3天内截止
  
  return '进行中';
}
```

### 7.3 权限控制规则

| 场景 | 允许操作 | 拒绝操作 |
|------|---------|---------|
| **未登录** | 查看邀请页 | 修改任何数据、查看详细日期/地点、发留言 |
| **已登录 - 自己的工作空间** | 全部操作 | / |
| **已登录 - 情侣共享** | 全部操作 | / |
| **已登录 - 他人工作空间** | 查看邀请页 (若有链接) | 删除、修改他人数据 |

### 7.4 预算告警规则

```javascript
const ratio = remainingBudget / totalBudget;

if (remainingBudget < 0) {
  status = '⚠️ 预算超支';
  color = 'red';
  severity = 'critical';
} else if (ratio < 0.1) {
  status = '⚠️ 预算紧张';
  color = 'orange';
  severity = 'warning';
} else {
  status = '✓ 预算充足';
  color = 'green';
  severity = 'ok';
}
```

### 7.5 邀请链接规则

- 每个用户只能生成一个邀请链接 (`id = 'INVITE_MAIN'`)
- 链接永久有效（除非用户主动删除邀请记录）
- 通过 code 访问不需要登录，但仅显示基本信息
- 邀请语可编辑，修改立即生效

### 7.6 亲友确认规则

- 亲友可通过邀请链接查看并确认出席
- 已登录用户可手动修改亲友状态
- 确认状态不影响亲友查看邀请页内容

---

## 使用指南

### 8.1 新用户上手流程

#### 第一次使用

1. **进入 wedding 页面**
   - 首页自动显示"完善基础信息"提示
   - 页面初始状态: 无任务、无预算

2. **设置基础信息**
   - 点击"编辑基础信息"
   - 输入: 婚期、地点、总预算
   - 保存后立即显示"距离婚礼还有 XX 天"

3. **创建第一个任务**
   - 点击"+ 添加任务"
   - 输入标题，选择类型
   - 保存任务

4. **邀请亲友**
   - 切换到"亲友"分区
   - 编辑邀请语
   - 点击"复制链接"分享

#### 第二次及以后

- 页面自动加载上次的数据
- 同步云端最新数据
- 显示倒计时和到期提醒

### 8.2 常见操作步骤

**操作 1：批量完成任务**

```
1. 点击"选择"进入多选模式
2. 逐个点击任务前的复选框选中
3. 点击"批量完成"确认
→ 所有选中任务标记为已完成
```

**操作 2：调整任务优先级**

```
1. 打开任务编辑模态框
2. 点击优先级星评调整 (1-5 星)
3. 保存
→ 可按优先级排序查看
```

**操作 3：跟踪预算**

```
1. 切换到"预算"分区
2. 添加支出或修改任务的"实际支出"
3. 查看剩余预算
→ 若剩余为负，显示红色告警
```

**操作 4：启用情侣共管**

```
1. 打开"社交"模块
2. 向伴侣发起情侣关系申请
3. 伴侣接受申请
→ 两人的 wedding 数据完全同步
```

---

## 故障排查

### 9.1 常见问题

#### 问题 1：页面加载一直显示"加载中"

**原因**: 云函数请求超时或网络连接问题

**解决**:
1. 检查网络连接
2. 尝试返回再进入页面
3. 检查云函数是否部署成功
4. 查看浏览器控制台错误日志

#### 问题 2：修改任务后没有保存到云端

**原因**: 异步上传失败（不影响本地数据）

**解决**:
1. 检查浏览器控制台是否有错误
2. 重新打开页面检查本地数据是否保留
3. 检查云函数是否可调用
4. 查看用户是否有写入权限

#### 问题 3：邀请链接无法访问

**原因**: 链接码超期或输入错误

**解决**:
1. 重新复制邀请链接
2. 检查链接格式是否正确
3. 确认邀请记录未被删除

#### 问题 4：情侣模式不工作

**原因**: 情侣关系未建立或未互相接受

**解决**:
1. 通过 social 模块建立关系
2. 确认双方都已接受
3. 重新打开 wedding 页面刷新数据

#### 问题 5：任务排序复位了

**原因**: 页面刷新或数据同步导致排序信息丢失

**解决**:
1. 确认 sortOrder 字段已保存到云端
2. 检查是否有多个标签页同时编辑
3. 避免在拖动中途切换页面

### 9.2 调试建议

#### 启用本地调试

```javascript
// 在 wedding.js 顶部添加
const DEBUG = true;

function log(...args) {
  if (DEBUG) {
    console.log('[Wedding]', ...args);
  }
}

// 使用 log() 替代 console.log()
log('Task created:', newTask);
log('Remaining budget:', remainingBudget);
```

#### 检查本地存储

```javascript
// 在浏览器控制台执行
wx.getStorage({
  key: 'wedding_tasks_' + wx.getStorageSync('openid'),
  success(res) {
    console.log('Local tasks:', res.data);
  }
});
```

#### 检查云端数据

```javascript
// 在云函数中添加日志
console.log('Request:', event);
console.log('Current user:', event.userInfo.openId);

// 调用云函数后检查返回值
wx.cloud.callFunction({
  name: 'getWeddingData',
  data: { dataType: 'tasks' },
  success(res) {
    console.log('Cloud response:', res.result);
  }
});
```

### 9.3 性能优化建议

1. **减少云函数调用**: 合并多个 getWeddingData 调用
2. **本地缓存**: 避免重复读取同一份数据
3. **虚拟列表**: 任务列表超过 100 项时使用虚拟滚动
4. **图片压缩**: 任务图片上传前自动压缩
5. **异步加载**: 不阻塞首屏显示

---

## 附录

### A1 任务类型完整列表

```
0 - 婚纱摄影 (Photography)
1 - 婚宴酒店 (Venue)
2 - 婚礼策划 (Planning)
3 - 婚礼服务 (Services)
4 - 婚礼节点 (Milestones)
5 - 婚品物料 (Supplies)
6 - 婚房装修 (Decoration)
7 - 其他 (Other)
```

### A2 支出分类完整列表

```
0 - 场地预定 (Venue)
1 - 餐饮饮料 (Catering)
2 - 装饰布景 (Decoration)
3 - 礼物特产 (Gifts)
4 - 化妆造型 (Makeup)
5 - 摄影摄像 (Photography)
6 - 其他 (Other)
```

### A3 数据库索引建议

```javascript
// wedding_tasks 集合
db.wedding_tasks.createIndex({ userId: 1 });
db.wedding_tasks.createIndex({ userId: 1, dueDate: 1 });
db.wedding_tasks.createIndex({ userId: 1, type: 1 });

// wedding_invites 集合
db.wedding_invites.createIndex({ linkCode: 1 });
db.wedding_invites.createIndex({ userId: 1 });

// wedding_notes 集合 (留言)
db.wedding_notes.createIndex({ ownerId: 1, createdAt: -1 });
```

### A4 关键代码片段

**计算倒计时**:
```javascript
function calculateCountdown(weddingDate) {
  const today = new Date();
  const wedding = new Date(weddingDate);
  const diffMs = wedding - today;
  const diffDays = Math.ceil(diffMs / (24 * 60 * 60 * 1000));
  
  if (diffDays > 0) {
    return `距离婚礼还有 ${diffDays} 天`;
  } else if (diffDays === 0) {
    return '今天是婚礼日';
  } else {
    return `婚礼已圆满结束 ${-diffDays} 天`;
  }
}
```

**生成任务 ID**:
```javascript
function generateTaskId() {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substr(2, 6);
  return 'WT' + timestamp + random; // 例: WT1713421400123456
}
```

**本地存储助手**:
```javascript
const storage = {
  getWeddingTasks: (userId) => {
    return wx.getStorageSync(`wedding_tasks_${userId}`) || [];
  },
  saveWeddingTasks: (userId, tasks) => {
    wx.setStorageSync(`wedding_tasks_${userId}`, tasks);
  },
  updateTask: (userId, taskId, updates) => {
    const tasks = storage.getWeddingTasks(userId);
    const index = tasks.findIndex(t => t.id === taskId);
    if (index >= 0) {
      tasks[index] = { ...tasks[index], ...updates };
      storage.saveWeddingTasks(userId, tasks);
    }
  }
};
```

---

## 文档维护

- **最后更新**: 2026年4月18日
- **下一次审查**: 2026年5月18日
- **维护人**: 开发团队
- **版本历史**: 
  - v1.0.0 (2026-04-18) - 初始版本

---

**EOF**
