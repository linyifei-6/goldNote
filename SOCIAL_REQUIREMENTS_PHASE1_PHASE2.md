# GoldNote 好友机制 一期/二期实现说明

## 1. 实现目标

- 一期：
  - 黄金好友互看（持仓页、历史页可查看，禁止增删改）。
  - 婚礼亲友可查看婚期并留言祝福。
- 二期：
  - 婚礼情侣共享同一份任务、预算、邀请与基础信息（双向可编辑）。

## 2. 代码入口

- 关系能力与权限计算：utils/social.js
- 好友中心页面：pages/social/social.js
- 场景页新增入口：pages/portal/portal.wxml
- 黄金只读接入：
  - pages/index/index.js
  - pages/history/history.js
  - pages/transaction/transaction.js
- 婚礼情侣共享接入：
  - pages/wedding/wedding.js
  - pages/weddingTasks/weddingTasks.js
- 婚礼亲友祝福页：pages/weddingGuest/wedding.js
 - 婚礼亲友祝福页：pages/weddingGuest/weddingGuest.js

## 3. 数据结构（本地）

### 3.1 关系表

- 存储键：social_relations
- 字段：
  - id
  - type: gold | couple | guest
  - status: pending | accepted | rejected | cancelled | ended
  - requesterId
  - targetId
  - sharedWeddingOwnerId
  - createdAt
  - updatedAt

### 3.2 黄金查看对象

- 存储键：social_gold_view_target_{userId}
- 含义：当前用户在黄金模块选择查看的对象。

### 3.3 婚礼祝福

- 存储键：wedding_blessings_{ownerUserId}
- 字段：
  - id
  - authorId
  - authorName
  - content
  - createdAt

## 4. 一期功能说明

### 4.1 黄金好友互看（只读）

- 用户在好友中心发起 gold 关系申请。
- 目标用户在好友中心同意后，双方互为黄金可查看对象。
- 在持仓页、历史页、交易页新增“黄金查看对象”切换。
- 当查看对象不是自己时：
  - 标记为“好友只读模式”。
  - 历史页隐藏修改/删除与批量计算操作入口。
  - 交易页禁用录入功能，仅保留查看。

### 4.2 婚礼亲友查看婚期与祝福

- 用户在好友中心发起 guest 关系申请。
- 被邀请方同意后，可在好友中心进入“婚期与祝福”页面。
- 亲友页面显示：
  - 婚礼日期
  - 婚礼地点
  - 邀请语
  - 祝福墙
- 亲友可发送祝福留言。

## 5. 二期功能说明

### 5.1 情侣关系建立

- 用户在好友中心发起 couple 申请。
- 对方同意后，双方建立情侣关系。
- 约束：任意用户仅允许一个 active 情侣关系。

### 5.2 共享婚礼空间

- 通过 sharedWeddingOwnerId 统一婚礼数据归属。
- 婚礼主页、任务页读取与写入均改为共享 owner 的数据。
- 效果：
  - A 和 B 为情侣后，任一方新增/编辑任务与预算，另一方可见并可继续编辑。

## 6. 页面交互变更

### 6.1 好友中心（新增）

- 发起申请：gold / couple / guest。
- 待处理申请：同意、拒绝。
- 我发起的申请：撤回。
- 关系管理：解除关系。
- 黄金关系：可切换查看对象。
- 亲友关系：可进入婚期与祝福页。

### 6.2 婚礼页

- 新增“当前模式：个人模式 / 情侣共管”提示。
- 新增“好友中心”跳转入口。

## 7. 验收用例

1. 黄金好友只读
- A 与 B 建立 gold 关系。
- A 切换查看 B。
- A 在历史页无法修改/删除、在交易页无法提交录入。

2. 婚礼情侣共管
- A 与 B 建立 couple 关系。
- A 新增任务与支出，B 刷新后可见。
- B 修改任务优先级和预算，A 刷新后可见。

3. 婚礼亲友祝福
- A 邀请 B 为 guest 并通过。
- B 从好友中心进入 A 的婚期与祝福页。
- B 可看到婚期信息并发送祝福。
- A 侧可看到祝福新增。

## 8. 当前边界

- 关系数据与祝福数据目前为本地存储实现，适合联调与功能验证。
- 如需跨设备一致，需要在后续版本将关系与祝福迁移到云函数与云数据库。
