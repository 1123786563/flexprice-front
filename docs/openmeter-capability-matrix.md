# OpenMeter 核心能力接入矩阵

> 基准：`@openmeter/sdk` 全部 17 个客户端命名空间 × OSS 后端（127.0.0.1:8888 实测）。
> 状态：✅ 已接入（数据真实） · 🟡 已接入+部分降级 · ⛔ 明确排除（附理由）。
> 更新：2026-09-04 晚（Notifications 切片进行时）。

## 计量核心（Metering）

| 能力 | SDK | 接入状态 | 落点 |
|---|---|---|---|
| 事件摄取 | `events.ingest` | ✅ | `EventsApi.fireEvents` + 遥测 `ingestUsageEvents`/`useUsageTracking`/`usePageViewTracking` |
| 事件查询（v2 游标分页） | `events.list` | ✅ | `EventsApi.getRawEvents/queryEvents`（type/subject/时间下推、iter_last_key↔nextCursor） |
| 事件调试 | `events.list(id)` | 🟡 | `EventsApi.getEventDebug`：事件原文+校验错误真实；归属调试链 OM 无管线（固定 unprocessed） |
| 计量表 CRUD | `meters.*` | ✅ | `MeterApi`（slug 派生、聚合枚举双向映射、COUNT_UNIQUE↔UNIQUE_COUNT） |
| 用量查询（窗口聚合） | `meters.queryPost` | ✅ | `EventsApi.getUsageByMeter`：subject/filterGroupBy/windowSize 透传 |
| **维度分析（groupBy）** | `meters.queryPost.groupBy` | ✅ | payload `group_by` 透传，结果行带 `group_by` 维度值（API 层通路，UI 后续可用） |
| 计量主体 | `subjects.*` | ✅ | 遥测 `useRegisterUsageSubject`（登录自动注册）；v2 客户即主体载体（usageAttribution） |
| 服务健康指标 | `debug.getMetrics` | ⛔ | Prometheus 内部指标，非前端业务数据 |

## 计费核心（Billing）

| 能力 | SDK | 接入状态 | 落点 |
|---|---|---|---|
| 客户 CRUD | `customers.*` | ✅ | `CustomerApi`（key↔external_id、替换式 update、软删语义） |
| 客户 entitlement 实例 | `customers.entitlements` | ✅ | `CustomerApi.getEntitlements`（v2 list + feature 档案补全） |
| 计划 CRUD/发布/归档/克隆 | `plans.*` | ✅ | `PlanApi`（create 后自动尝试发布；key 规范化 normalizeOmKey） |
| 价格卡（rateCards） | （经 plan update） | ✅ | `PriceApi`（复合 id `planId:phaseKey:cardKey`；FIXED/USAGE/PACKAGE/TIERED 四模型） |
| 订阅创建/取消/变更/迁移 | `subscriptions.*` | ✅ | `SubscriptionApi`（draft 自动发布、timing 映射、migrate 批量同步）；行项目 CRUD/数量修改⛔（OM 费率卡模型无对应，报错给指引） |
| 订阅附加组件 | `subscriptionAddons.*` | ✅ | `SubscriptionApi.getActiveAddons`（真实实例映射，active/inactive 按 activeTo） |
| 发票（出账/作废/审批） | `billing.invoices.*` | ✅ | `InvoiceApi`（状态矩阵、两步 ONE_OFF 创建、PDF⛔ SDK 无端点） |
| 收入聚合 | （客户端聚合） | ✅ | `DashboardApi.getRevenues`（发票按月/币种聚合 + 支付状态计数） |
| 权益 v2 实例 | `entitlements`（v2） | ✅ | `EntitlementApi`（search 按 subscription/plan/addon 路由，卡片合成） |
| 权益 v1（subject 维度） | `entitlementsV1.*` | 🟡 | override 已接；value/history/reset SDK 有、Flexprice 无对应 UI 入口（API 通路在 entitlements v2 客户实例覆盖） |
| 额度授予（grants） | `entitlements.grants` | 🟡 | `CreditGrantApi`（list/create(SUBSCRIPTION)/void；目录级 grant⛔ OM 无实体） |
| 附加组件目录 | `addons.*` | ✅ | `AddonApi`（entitlementTemplate 合成、创建缺省 single/USD） |
| 功能目录 | `features.*` | ✅ | `FeatureApi`（两步建表、metadata 保留键 flexprice.*；update=删重建） |
| 批量操作进度 | `info.getProgress` | ⛔ | Flexprice 无批量操作 UI 落点（导出/导入均为空态垫片） |
| 币种目录 | `info.listCurrencies` | ⛔ | 无独立 UI 消费点（币种来自 plan/customer 数据本身） |

## 通知（Notifications）——已接入（UI+API 完整；后端写路径受社区版 noop 限制）

| 能力 | SDK | 接入状态 | 落点 |
|---|---|---|---|
| 通知渠道（WEBHOOK） | `notifications.channels` | 🟡 | `NotificationApi`（CRUD 全量）+ Settings「Notifications」Tab；**读路径可用**；创建被 OSS noop 投递器拒绝（not implemented → 500），UI 顶部有提示条 |
| 通知规则（4 类型） | `notifications.rules` | 🟡 | 同上（balance.threshold：balance_value/usage_percentage/usage_value；entitlements.reset；invoice.created；invoice.updated；均可挂 feature 过滤）——依赖渠道存在 |
| 通知事件+重发 | `notifications.events` | 🟡 | 同上（list/get/resend）；无投递器时事件恒空 |

> 部署带真实 webhook 投递器的 OpenMeter 发行版后，以上写路径即全部生效（前端按 SDK 契约完整实现）。

## 云连接器（Apps/Portal）——明确排除

| 能力 | SDK | 状态 | 理由 |
|---|---|---|---|
| Marketplace 列表 | `apps.list` | ⛔ | UI 为静态目录形态（integrationCatalogSpecs），无动态消费落点；安装/计费依赖 OM Cloud |
| 云连接器安装/Stripe | `apps.stripe/checkout` | ⛔ | 依赖 OM Cloud 后端，OSS 为 noop/无数据 |
| 消费者门户 | `portal.*` | ⛔ | OSS portal 为 noop 适配器（`CustomerApi.createDashboardSession` 明确报错） |

## 验证

- 单测：全量 vitest 绿（含 5 项真实后端集成：客户/计划/订阅/entitlements/发票生命周期）
- 浏览器 E2E：读路径 8/8、写路径 6/6、dashboard 3/3
- 本矩阵由 `src/api/OpenMeterBackend.integration.test.ts`（gated）持续校验核心通路
