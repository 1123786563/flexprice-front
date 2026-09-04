# flexprice-front 全量切换 OpenMeter 后端 实施计划

> **状态**：**已完成**（2026-09-04 19:15）。`src/api/` 全部模块脱离 Flexprice 后端（`grep AxiosClient` 零命中）：
> 业务域（customers/plans/prices/subscriptions/invoices/dashboard/features/addons/entitlements/creditgrants/events/meters/usage-records）
> 走 OM SDK + mappers 映射；平台域（auth/user/tenant/environment/rbac）走本地垫片；其余 27 个 Flexprice 特有模块确定性空态/报错降级。
>
> **验证**：tsc 0 错、vitest 948/948（新增域测试 106）、eslint 0 错、`npm run build` 通过；
> 浏览器 E2E 8/8（登录→dashboard→customers/plans/subscriptions/features 真实 OM 数据→invoices/events 可达→零 :8080 请求）。
> 关键修复记录：vite 代理 target 必须 127.0.0.1（localhost 解析 IPv6 ::1 导致每请求 ~7s）；`.env` 的 VITE_API_URL 指向 /openmeter/api/v1 避免未改写模块 CORS。
> 已知限制：订阅中途修改/行项目 CRUD/发票 PDF/定时取消等 OM 无通路的方法明确报错（决策表见各代理报告与代码注释）。

## Goal

用户目标：「完全走 OpenMeter 后端」。flexprice-front 的所有 `src/api/` 模块分三类处理：

| 类别 | 模块 | 实现 |
|---|---|---|
| **A. OpenMeter 承载** | Customer、Plan、Subscription、Invoice、Feature、Addon、Entitlement、CreditGrant(部分)、Meter、Events、Price(读) | 改写 Api 模块内部 → `@openmeter/sdk` + DTO 映射，返回原 Flexprice DTO 形状，页面零改动 |
| **B. 平台垫片** | Auth、User、Tenant、Environment、Rbac、Settings、Onboarding、Dashboard | 本地确定性数据（无网络），保证启动链与 onboarding 流程可用 |
| **C. 空态垫片** | Wallet、Coupon、CreditNote、Workflow、Task、Alert、Integrations、Payment、Tax、Group、Webhook、SupportChat、UsageRecord、Export、Connection、SecretKeys、OAuth、RevenueDashboard、ai/*、其余 | 返回空列表/固定空对象/明确 no-op，UI 呈现空态 |

## Architecture

```
src/core/services/openmeter/           # 既有：SDK 单例 + 遥测（保持）
src/core/services/openmeter/mappers/   # 新增：Flexprice DTO ↔ OM 模型 双向映射（纯函数）
  customer.ts  plan.ts  price.ts  subscription.ts  invoice.ts
  feature.ts  addon.ts  entitlement.ts  creditGrant.ts  event.ts  meter.ts
src/core/services/platform/            # 新增：B 类本地垫片（auth/users/me、tenant、environment、rbac、settings）
src/api/*Api.ts                        # 逐模块改写内部实现（类签名/返回类型不变）
```

- **不动页面与 hooks**：`useCustomer` 等业务 hooks 照旧调用 `CustomerApi.xxx()`；AxiosClient 保留但 A/B/C 全部改完后不再有调用方（axios 拦截器的 token/环境头门禁随之失效，属预期）。
- **OM 客户端获取**：`getOpenMeterClient()`（config.openmeter.enabled 门控）+ `requireOpenMeterClient()`（写操作）。`.env`：`VITE_OPENMETER_ENABLED=true`、`VITE_OPENMETER_URL=/openmeter`、`VITE_APP_ENV=self-hosted`（登录走 AuthApi.Login 本地垫片，任意账密可进）。
- **映射纪律**：映射器为纯函数、无 React；类型从两侧现成类型派生，禁止 `any`；tenant_id/environment_id/created_by 等 OM 无对应字段填常量（`''`）；OM 无对应的能力**必须显式降级**（空数组/明确 throw 带 toast 的错误信息），禁止假数据。
- **分页**：OM `{items,totalCount,page,pageSize}` → Flexprice `{items,pagination:{limit,offset,count,total}}`。

## 启动硬门禁（B 类必须先就位）

1. `POST /auth/login` → `{token:'local-openmeter-session', user_id, tenant_id}`（写 localStorage `token`，LoginForm 即可 navigate('/')）
2. `GET /users/me`（UserApi.me）→ 固定 user：`{id:'local-user', email, roles:['super_admin'], tenant:{id:'openmeter-local', name:'OpenMeter', metadata:{onboarding_completed:'true'}}}`（onboarding_completed=true 直接进 dashboard；onboarding 页面另留可用垫片）
3. `GET /environments`（getAllEnvironments）→ `[{id:'openmeter', name:'OpenMeter'}]`（useEnvironment 自动写 `active_environment_id`）
4. `GET /rbac/roles` → 含 `super_admin` 定义 `{"*":["*"]}`（RouteGuard 全放行；SUPER_ADMIN_ROLE_ID 常量见 RbacApi.ts）
5. `GET /tenants/{id}` + `PUT /tenants/update` → 本地固定租户/内存 upsert
6. `EnvironmentApi.waitForActiveEnvironment()` → 立即 resolve

## 域映射要点（A 类）

| 域 | 读 | 写 | 显式降级 |
|---|---|---|---|
| Customer | list/get→OM customers（key↔external_id、address 嵌套↔打平） | create/update/delete→OM | integrations、tax_rate_overrides、dashboard session（throw 明确错误） |
| Plan | list/get→OM plans（planCard/committedCard/usageCard→Plan+Price 双形状；status draft→?、published→published、archived→archived） | create（planCard 最小）/delete/publish/archive→OM | clonePlan→前端复制 create；display_order/price_sync_status→缺省 |
| Price | 由 OM plan 卡片合成：usageCard→USAGE 价、planCard fee→RECURRING 价 | create/update→PATCH OM plan 对应卡片 | 不支持的结构 throw |
| Subscription | list/get→OM subscriptions + 组装 plan/customer/line_items（从 plan 卡片合成，quantity 默认 1） | create（plan_id+customer）/cancel→OM | executeSubscriptionModify/line_items CRUD/preview→throw 明确「OpenMeter 暂不支持」或映射到 cancel+create |
| Invoice | list/get→OM billing/invoices（status: draft→DRAFT、issued→FINALIZED、voided→VOIDED；payment: paid→SUCCEEDED） | void→OM；finalize/approve→OM | PDF/CSV 下载→若 OM 无端点则 throw |
| Feature | list/get→OM features（key↔lookup_key、meterSlug↔meter_id） | create（含内嵌 meter 两步建）/update/delete→OM | alert_settings、group_id→metadata |
| Addon | List/Get→OM addons（prices/entitlements 展开） | Create/Update/Delete/publish/archive→OM | — |
| Entitlement | search：entity_type=SUBSCRIPTION→OM subject entitlements；PLAN/ADDON→从 OM plan/addon 卡合成 | create/delete→OM grants 或卡片 | static_value/config_value 部分映射 |
| CreditGrant | list→OM entitlement grants（feature 额度） | create→OM grant；delete→void | cadence/priority/conversion_rate→缺省；scope PLAN/ADDON→空 |
| Meter | getMeterById→OM meters.get | create/update/delete→OM meters | reset_usage、WEIGHTED_SUM 聚合→缺省 |
| Events | getRawEvents→OM events.listV2（type↔event_name、subject↔customer_id） | fireEvents→OM ingest | monitoring/analytics→空/聚合近似；debug_tracker→空 |
| Dashboard | /dashboard/revenues→OM invoices 聚合（月度 sum） | — | 无 |

## Slices（每片收口：vitest 相关文件绿 + eslint 绿；关键片浏览器验证）

0. 基建：npm install、.env、SDK 冒烟（curl 列表）
1. **B 类平台垫片**（上面 6 项）→ 浏览器：任意账密登录直达 dashboard
2. **Customer 域** → 浏览器：列表显示 OM 真实 5 客户、详情、新建、编辑
3. **Plan+Price 读** + plan 删除/发布归档 → 浏览器验证
4. **Subscription 域**（list/get/cancel/create）→ 浏览器验证
5. **Invoice 域** + dashboard 聚合 → 浏览器验证
6. Feature/Addon/Entitlement/CreditGrant
7. Meter/Events/Usage
8. **C 类空态垫片扫尾**（全部剩余模块）→ grep 断言：src/api 无 AxiosClient 调用残留
9. 全量 `npx vitest run` + `npm run build` + Playwright/浏览器 E2E + 提交

## Verification

- 单测：mappers 纯函数往返测试 + 改写后 Api 模块（mock SDK client）保持既有 `*.test.ts(x)` 全绿
- 静态：`npx eslint src/` 零错误；`grep -rn "AxiosClient" src/api/` 零命中（收尾时）
- 构建：`npm run build` 通过
- 端到端：真实浏览器驱动 localhost:3000（vite 代理→:8888），验证登录→dashboard→customers/plans/subscriptions/invoices 真实 OM 数据
- 后端事实以 http://localhost:8888 实测为准（社区版无鉴权；容器 openmeter-admin-openmeter-1 已发布 127.0.0.1:8888）
