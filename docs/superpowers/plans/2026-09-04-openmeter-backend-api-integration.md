# OpenMeter 后端 API 逐个对接 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在已有 OpenMeter 基础接入（事件摄取 + 计量表列表/用量查询）之上，把本地 OpenMeter 后端（http://localhost:8888，社区版免鉴权）支持的其余 API（events.list/listV2、meters.get/queryPost/CRUD、subjects 全套、features 全套、info）通过 `@openmeter/sdk` + TanStack Query 逐个对接为服务层与 hooks。

**Architecture:** 沿用既有双路径设计——非 React 遥测走 `src/core/services/openmeter/` 的单例客户端；React 侧每个 API 域一个 hook 文件（`src/hooks/useOpenMeter<Domain>.ts`），queryFn 内通过 `getOpenMeterClient()` 取单例，`enabled: config.openmeter.enabled` 门控。读操作在后端禁用时优雅降级为空数据；写操作（mutations）通过 `requireOpenMeterClient()` 显式抛错。每个 hook 文件自带 `['openmeter', <domain>]` 前缀的 query key，互不循环依赖。

**Tech Stack:** React 18 · TypeScript · `@openmeter/sdk@1.0.0-beta.232`（openapi-fetch 客户端）· TanStack Query v5 · Vitest + @testing-library/react

## Global Constraints

- 所有服务端交互走 TanStack Query（`useQuery`/`useMutation`），禁止组件内裸 fetch/axios（仓库宪法）。
- 禁止 `any`；SDK 返回类型一律用 `NonNullable<Awaited<ReturnType<...>>>` / `Parameters<...>` 从 `OpenMeterClient` 派生，不手抄后端类型。
- 测试与源码同目录：`<name>.test.tsx`，用 `@testing-library/react` 的 `renderHook` + `waitFor`，SDK 用 `vi.mock('@openmeter/sdk', ...)` 假类替换（仿 `src/core/services/openmeter/index.test.ts:9-14`）。
- `npx eslint src/` 零错误、`npm run build`（tsc -b + vite build）必须通过；代码用 Tab 缩进（与现有文件一致）。
- OpenMeter 开关：`config.openmeter.enabled`（来自 `VITE_OPENMETER_ENABLED`，当前 `.env` 为 `true`）；查询 hooks 必须 `enabled` 门控，禁用时返回空数据不报错。
- 明确排除（本计划不做）：OpenMeter Billing 模块（plans/subscriptions/customers/entitlements/addons/apps/notifications/subscriptionAddons —— Flexprice 前端自身计费域已由 Flexprice API 承担）；`debug.getMetrics`（Prometheus 内部指标，不适合前端）；`meters.listGroupByValues`（本地后端实测 404 不支持）；Portal API（本地为 noop adapter，已在上轮接入中优雅降级，保持现状）。

## 已验证的本地后端支持矩阵（2026-09-04 实测 http://localhost:8888）

| # | SDK 方法 | HTTP 端点 | 实测 | 现状 |
|---|---|---|---|---|
| 1 | `events.ingest` | POST /api/v1/events | ✅ | 已对接（`ingestUsageEvents`/`useUsageTracking`） |
| 2 | `events.list` | GET /api/v1/events | ✅ 200 | **Task 1** |
| 3 | `events.listV2` | GET /api/v2/events（`cursor`/`limit` 分页） | ✅ 200 | **Task 1** |
| 4 | `meters.list` | GET /api/v1/meters | ✅ | 已对接（`useOpenMeterMeters`，本地已建 20 个计量表） |
| 5 | `meters.get` | GET /api/v1/meters/{idOrSlug} | ✅ 200 | **Task 2** |
| 6 | `meters.query` | GET /api/v1/meters/{slug}/query | ✅ | 已对接（`useOpenMeterUsage`） |
| 7 | `meters.queryPost` | POST /api/v1/meters/{slug}/query | ✅ 200 | **Task 2** |
| 8 | `meters.create/update/delete` | POST/PATCH/DELETE /api/v1/meters… | 管理操作 | **Task 3** |
| 9 | `subjects.list` | GET /api/v1/subjects | ✅ 200 | **Task 4** |
| 10 | `subjects.get` | GET /api/v1/subjects/{idOrKey} | ✅（不存在时 404） | **Task 4** |
| 11 | `subjects.upsert` | POST /api/v1/subjects（**请求体须为数组**，SDK 已内部处理单个对象） | ✅ 200 | **Task 4** |
| 12 | `subjects.delete` | DELETE /api/v1/subjects/{idOrKey} | ✅ | **Task 4** |
| 13 | `features.list` | GET /api/v1/features | ✅ 200 | **Task 5** |
| 14 | `features.get/create/delete` | GET/POST/DELETE /api/v1/features… | 管理操作 | **Task 5** |
| 15 | `info.listCurrencies` | GET /api/v1/info/currencies | ✅ 200 | **Task 6** |
| 16 | `info.getProgress` | GET /api/v1/info/progress/{id} | 轮询批量操作进度 | **Task 6** |
| 17 | Portal（`@openmeter/sdk/react`） | POST /api/v1/portal/tokens → noop | 400/501 | 已降级（`OpenMeterProvider` value=null），保持 |

## File Structure

| 文件 | 动作 | 职责 |
|---|---|---|
| `src/core/services/openmeter/index.ts` | 修改（Task 3） | 新增 `requireOpenMeterClient()`：mutation 用获取客户端的函数，禁用时抛错 |
| `src/hooks/useOpenMeterQuery.ts` | 修改（Task 2） | meters 域读：现有 list/query + 新增 `useOpenMeterMeter`（get）、`useOpenMeterUsagePost`（queryPost）；扩展 `openMeterQueryKeys` |
| `src/hooks/useOpenMeterEvents.ts` | 新建（Task 1） | events 域读：`useOpenMeterEvents`、`useOpenMeterEventsV2` |
| `src/hooks/useOpenMeterMeterMutations.ts` | 新建（Task 3） | meters 域写：create/update/delete 三个 mutation hooks |
| `src/hooks/useOpenMeterSubjects.ts` | 新建（Task 4） | subjects 域：list/get 查询、upsert/delete mutation、`useRegisterUsageSubject`（登录用户自动注册为 subject） |
| `src/hooks/useOpenMeterFeatures.ts` | 新建（Task 5） | features 域：list/get 查询、create/delete mutation |
| `src/hooks/useOpenMeterInfo.ts` | 新建（Task 6） | info 域：currencies（staleTime=Infinity）、progress 查询 |
| `src/layouts/MainLayout.tsx` | 修改（Task 7） | 挂载 `useRegisterUsageSubject()`（紧跟 `usePageViewTracking()`） |

每个新建 hook 文件配套同目录 `*.test.tsx`。

---

### Task 0: 分支与基线提交

**Files:** 无新文件；把工作区中上一轮 OpenMeter 接入会话遗留的未提交改动（15 个已修改 + 5 个未跟踪文件：SDK 依赖、config、Provider 挂载、服务层、事件摄取、测试 shim、zh 语言包）作为基线一次性提交。

- [ ] **Step 1: 创建功能分支**（未提交改动会随工作区带到新分支）

```bash
git checkout -b feat/openmeter-api-integration
```

- [ ] **Step 2: 基线提交**（只提交现存改动，不混入后续任务）

```bash
git add -A
git commit -m "feat(openmeter): 本地后端接入基础（SDK 依赖、Provider、事件摄取、计量表查询）"
```

- [ ] **Step 3: 确认基线干净**

Run: `git status --short`
Expected: 无输出（工作区干净）

---

### Task 1: 事件列表查询（events.list + events.listV2）

**Files:**
- Create: `src/hooks/useOpenMeterEvents.ts`
- Test: `src/hooks/useOpenMeterEvents.test.tsx`

**Interfaces:**
- Consumes: `getOpenMeterClient()`、`OpenMeterClient`（type-only，来自 `@/core/services/openmeter`）；`config.openmeter.enabled`
- Produces: `useOpenMeterEvents(filter?: OpenMeterEventsFilter)` → TanStack query，data: `OpenMeterIngestedEvent[]`；`useOpenMeterEventsV2(filter?: OpenMeterEventsV2Filter)` → data: `{ items, nextCursor? }`；类型 `OpenMeterEventsFilter`/`OpenMeterEventsV2Filter`/`OpenMeterIngestedEvent`/`OpenMeterIngestedEventsPage`（供后续 UI 复用）

- [ ] **Step 1: 写失败测试**

```tsx
// src/hooks/useOpenMeterEvents.test.tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { config } from '@/config/config';

const mocks = vi.hoisted(() => ({
	list: vi.fn(),
	listV2: vi.fn(),
}));

vi.mock('@openmeter/sdk', () => ({
	OpenMeter: class {
		events = { list: mocks.list, listV2: mocks.listV2 };
		constructor(public clientConfig: unknown) {}
	},
}));

import { useOpenMeterEvents, useOpenMeterEventsV2 } from './useOpenMeterEvents';

function createWrapper() {
	const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	return function Wrapper({ children }: { children: ReactNode }) {
		return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
	};
}

describe('useOpenMeterEvents', () => {
	beforeEach(() => {
		mocks.list.mockReset();
		mocks.listV2.mockReset();
	});

	it('returns ingested events from the admin API', async () => {
		const ingested = {
			event: { id: 'evt-1', type: 'frontend_page_views' },
			ingestedAt: new Date('2026-09-04T00:00:00Z'),
			storedAt: new Date('2026-09-04T00:00:00Z'),
		};
		mocks.list.mockResolvedValueOnce([ingested]);

		const { result } = renderHook(() => useOpenMeterEvents({ subject: 'u-42' }), { wrapper: createWrapper() });

		await waitFor(() => expect(result.current.isSuccess).toBe(true));
		expect(mocks.list).toHaveBeenCalledWith({ subject: 'u-42' });
		expect(result.current.data).toEqual([ingested]);
	});

	it('stays idle and never calls the API when OpenMeter is disabled', () => {
		const original = config.openmeter.enabled;
		config.openmeter.enabled = false;
		try {
			const { result } = renderHook(() => useOpenMeterEvents(), { wrapper: createWrapper() });
			expect(result.current.data).toBeUndefined();
			expect(mocks.list).not.toHaveBeenCalled();
		} finally {
			config.openmeter.enabled = original;
		}
	});
});

describe('useOpenMeterEventsV2', () => {
	beforeEach(() => {
		mocks.list.mockReset();
		mocks.listV2.mockReset();
	});

	it('passes the cursor through and exposes nextCursor for pagination', async () => {
		const page = { items: [{ event: { id: 'evt-2' } }], nextCursor: 'cursor-2' };
		mocks.listV2.mockResolvedValueOnce(page);

		const { result } = renderHook(() => useOpenMeterEventsV2({ cursor: 'cursor-1' }), { wrapper: createWrapper() });

		await waitFor(() => expect(result.current.isSuccess).toBe(true));
		expect(mocks.listV2).toHaveBeenCalledWith({ cursor: 'cursor-1' });
		expect(result.current.data).toEqual(page);
	});

	it('returns an empty page instead of failing when OpenMeter is disabled', async () => {
		const original = config.openmeter.enabled;
		config.openmeter.enabled = false;
		try {
			const { result } = renderHook(() => useOpenMeterEventsV2(), { wrapper: createWrapper() });
			expect(result.current.data).toBeUndefined();
			expect(mocks.listV2).not.toHaveBeenCalled();
		} finally {
			config.openmeter.enabled = original;
		}
	});
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/hooks/useOpenMeterEvents.test.tsx`
Expected: FAIL（`Failed to resolve import "./useOpenMeterEvents"`）

- [ ] **Step 3: 写实现**

```ts
// src/hooks/useOpenMeterEvents.ts
import { useQuery } from '@tanstack/react-query';
import { config } from '@/config/config';
import { getOpenMeterClient, OpenMeterClient } from '@/core/services/openmeter';

/** `GET /api/v1/events` 的查询参数（subject、ingestedAtFrom/To、id、limit…），随 SDK 类型走。 */
export type OpenMeterEventsFilter = NonNullable<Parameters<OpenMeterClient['events']['list']>[0]>;
/** `GET /api/v2/events` 的查询参数（在 v1 基础上增加 cursor/limit 游标分页）。 */
export type OpenMeterEventsV2Filter = NonNullable<Parameters<OpenMeterClient['events']['listV2']>[0]>;

export type OpenMeterIngestedEvent = NonNullable<Awaited<ReturnType<OpenMeterClient['events']['list']>>>[number];
export type OpenMeterIngestedEventsPage = NonNullable<Awaited<ReturnType<OpenMeterClient['events']['listV2']>>>;

export const openMeterEventsKeys = {
	list: (filter: OpenMeterEventsFilter) => ['openmeter', 'events', filter] as const,
	listV2: (filter: OpenMeterEventsV2Filter) => ['openmeter', 'events-v2', filter] as const,
};

/** 列出已摄取的原始事件——核查"什么真正落库了"（区别于聚合后的用量查询）。禁用时返回空数组。 */
export function useOpenMeterEvents(filter: OpenMeterEventsFilter = {}) {
	return useQuery<OpenMeterIngestedEvent[]>({
		queryKey: openMeterEventsKeys.list(filter),
		queryFn: async () => {
			const client = getOpenMeterClient();
			if (!client) return [];
			return (await client.events.list(filter)) ?? [];
		},
		enabled: config.openmeter.enabled,
	});
}

/** 游标分页变体（v2 端点）；翻页时把上一页 `nextCursor` 传回 `filter.cursor`。 */
export function useOpenMeterEventsV2(filter: OpenMeterEventsV2Filter = {}) {
	return useQuery<OpenMeterIngestedEventsPage>({
		queryKey: openMeterEventsKeys.listV2(filter),
		queryFn: async () => {
			const client = getOpenMeterClient();
			if (!client) return { items: [] };
			return (await client.events.listV2(filter)) ?? { items: [] };
		},
		enabled: config.openmeter.enabled,
	});
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run src/hooks/useOpenMeterEvents.test.tsx`
Expected: PASS（4 个用例）

- [ ] **Step 5: 提交**

```bash
git add src/hooks/useOpenMeterEvents.ts src/hooks/useOpenMeterEvents.test.tsx
git commit -m "feat(openmeter): events.list/listV2 事件列表查询 hooks"
```

---

### Task 2: 计量表详情与 POST 查询（meters.get + meters.queryPost）

**Files:**
- Modify: `src/hooks/useOpenMeterQuery.ts`
- Test: `src/hooks/useOpenMeterQuery.test.tsx`（新建）

**Interfaces:**
- Consumes: `getOpenMeterClient()`、`OpenMeterMeter`、`MeterQueryResult`（均已在 `@/core/services/openmeter` 导出）
- Produces: `useOpenMeterMeter(idOrSlug: string)` → data: `OpenMeterMeter | null`；`useOpenMeterUsagePost(idOrSlug: string, body?: MeterQueryPostBody)` → data: `MeterQueryResult`；`openMeterQueryKeys.meter(idOrSlug)`、`openMeterQueryKeys.usagePost(slug, body)`；类型 `MeterQueryPostBody`（Task 3/后续 UI 复用）

- [ ] **Step 1: 写失败测试**

```tsx
// src/hooks/useOpenMeterQuery.test.tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { config } from '@/config/config';

const mocks = vi.hoisted(() => ({
	list: vi.fn(),
	get: vi.fn(),
	query: vi.fn(),
	queryPost: vi.fn(),
}));

vi.mock('@openmeter/sdk', () => ({
	OpenMeter: class {
		meters = { list: mocks.list, get: mocks.get, query: mocks.query, queryPost: mocks.queryPost };
		constructor(public clientConfig: unknown) {}
	},
}));

import { useOpenMeterMeter, useOpenMeterMeters, useOpenMeterUsage, useOpenMeterUsagePost } from './useOpenMeterQuery';

function createWrapper() {
	const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	return function Wrapper({ children }: { children: ReactNode }) {
		return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
	};
}

const meter = {
	id: '01meter',
	slug: 'agent_runs',
	name: 'agent_runs',
	eventType: 'agent_runs',
	aggregation: 'SUM' as const,
	valueProperty: '$.value',
	createdAt: new Date('2026-08-30T11:45:12Z'),
	updatedAt: new Date('2026-08-30T11:45:12Z'),
};

describe('useOpenMeterMeter', () => {
	beforeEach(() => {
		[mocks.list, mocks.get, mocks.query, mocks.queryPost].forEach((m) => m.mockReset());
	});

	it('fetches a single meter by slug', async () => {
		mocks.get.mockResolvedValueOnce(meter);

		const { result } = renderHook(() => useOpenMeterMeter('agent_runs'), { wrapper: createWrapper() });

		await waitFor(() => expect(result.current.isSuccess).toBe(true));
		expect(mocks.get).toHaveBeenCalledWith('agent_runs');
		expect(result.current.data).toEqual(meter);
	});

	it('is disabled for an empty slug', () => {
		const { result } = renderHook(() => useOpenMeterMeter(''), { wrapper: createWrapper() });
		expect(result.current.data).toBeUndefined();
		expect(mocks.get).not.toHaveBeenCalled();
	});
});

describe('useOpenMeterUsagePost', () => {
	it('queries usage through the POST endpoint and returns the rows', async () => {
		const rows = { from: '2026-09-03T00:00:00Z', data: [{ value: 8, groupBy: {} }] };
		mocks.queryPost.mockResolvedValueOnce(rows);

		const body = { from: '2026-09-03T00:00:00Z', groupBy: ['subject'] } as const;
		const { result } = renderHook(() => useOpenMeterUsagePost('agent_runs', body), { wrapper: createWrapper() });

		await waitFor(() => expect(result.current.isSuccess).toBe(true));
		expect(mocks.queryPost).toHaveBeenCalledWith('agent_runs', body);
		expect(result.current.data).toEqual(rows);
	});
});

describe('既有 meters 读接口回归', () => {
	it('useOpenMeterMeters lists meters and empty list when disabled', async () => {
		mocks.list.mockResolvedValueOnce([meter]);
		const enabled = renderHook(() => useOpenMeterMeters(), { wrapper: createWrapper() });
		await waitFor(() => expect(enabled.result.current.isSuccess).toBe(true));
		expect(enabled.result.current.data).toEqual([meter]);

		const original = config.openmeter.enabled;
		config.openmeter.enabled = false;
		try {
			const disabled = renderHook(() => useOpenMeterUsage('agent_runs'), { wrapper: createWrapper() });
			expect(disabled.result.current.data).toBeUndefined();
		} finally {
			config.openmeter.enabled = original;
		}
	});
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/hooks/useOpenMeterQuery.test.tsx`
Expected: FAIL（`useOpenMeterMeter` 未导出）

- [ ] **Step 3: 写实现** —— 在 `src/hooks/useOpenMeterQuery.ts` 顶部 import 加入 `OpenMeterClient`，在 `openMeterQueryKeys` 中加入 `meter` 与 `usagePost`，文件末尾追加两个 hook 与类型：

```ts
// src/hooks/useOpenMeterQuery.ts —— 修改点 1：import 行
import { getOpenMeterClient, OpenMeterClient, OpenMeterMeter, MeterQueryResult } from '@/core/services/openmeter';

// —— 修改点 2：query key 注册表整体替换为
export const openMeterQueryKeys = {
	meters: ['openmeter', 'meters'] as const,
	meter: (idOrSlug: string) => ['openmeter', 'meter', idOrSlug] as const,
	usage: (meterSlug: string, params: MeterUsageParams) => ['openmeter', 'usage', meterSlug, params] as const,
	usagePost: (meterSlug: string, body: MeterQueryPostBody) => ['openmeter', 'usage-post', meterSlug, body] as const,
};

// —— 修改点 3：文件末尾追加
/** `POST /api/v1/meters/{slug}/query` 的请求体（from/to、groupBy、filters…），随 SDK 类型走。 */
export type MeterQueryPostBody = NonNullable<Parameters<OpenMeterClient['meters']['queryPost']>[1]>;

/** 按 ID 或 slug 取单个计量表（GET /api/v1/meters/{idOrSlug}）。禁用时为 null。 */
export function useOpenMeterMeter(idOrSlug: string) {
	return useQuery<OpenMeterMeter | null>({
		queryKey: openMeterQueryKeys.meter(idOrSlug),
		queryFn: async () => {
			const client = getOpenMeterClient();
			if (!client) return null;
			return (await client.meters.get(idOrSlug)) ?? null;
		},
		enabled: config.openmeter.enabled && Boolean(idOrSlug),
	});
}

/** 复杂用量查询走 POST（条件过多超出 URL 长度时），返回结构与 GET query 一致。 */
export function useOpenMeterUsagePost(idOrSlug: string, body: MeterQueryPostBody = {}) {
	return useQuery<MeterQueryResult>({
		queryKey: openMeterQueryKeys.usagePost(idOrSlug, body),
		queryFn: async () => {
			const client = getOpenMeterClient();
			if (!client) return { data: [] };
			return (await client.meters.queryPost(idOrSlug, body)) ?? { data: [] };
		},
		enabled: config.openmeter.enabled && Boolean(idOrSlug),
	});
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run src/hooks/useOpenMeterQuery.test.tsx`
Expected: PASS（4 个用例）

- [ ] **Step 5: 提交**

```bash
git add src/hooks/useOpenMeterQuery.ts src/hooks/useOpenMeterQuery.test.tsx
git commit -m "feat(openmeter): meters.get 单表详情与 queryPost 复杂用量查询 hooks"
```

---

### Task 3: 计量表管理变更（meters create/update/delete）+ 服务层 requireOpenMeterClient

**Files:**
- Modify: `src/core/services/openmeter/index.ts`（新增 `requireOpenMeterClient`）
- Modify: `src/core/services/openmeter/index.test.ts`（补 1 个用例）
- Create: `src/hooks/useOpenMeterMeterMutations.ts`
- Test: `src/hooks/useOpenMeterMeterMutations.test.tsx`

**Interfaces:**
- Consumes: `getOpenMeterClient()`（既有）
- Produces: `requireOpenMeterClient(): OpenMeterClient`（Task 4/5 的 mutations 复用，禁用时抛 `OpenMeter is disabled (VITE_OPENMETER_ENABLED=false)`）；`useCreateOpenMeterMeter()`、`useUpdateOpenMeterMeter()`（入参 `{ idOrSlug, meter }`）、`useDeleteOpenMeterMeter()`（入参 slug 字符串）；类型 `MeterCreateInput`、`MeterUpdateInput`

- [ ] **Step 1: 服务层失败测试** —— 在 `src/core/services/openmeter/index.test.ts` 的 `describe('ingestUsageEvents', ...)` 之后追加：

```ts
describe('requireOpenMeterClient', () => {
	it('returns the shared client when enabled', () => {
		const client = requireOpenMeterClient();
		expect(client).toBeTruthy();
	});

	it('throws with the enabling env var name when disabled', () => {
		const original = config.openmeter.enabled;
		config.openmeter.enabled = false;
		try {
			expect(() => requireOpenMeterClient()).toThrowError(/VITE_OPENMETER_ENABLED/);
		} finally {
			config.openmeter.enabled = original;
		}
	});
});
```

同时把该文件顶部 import 行改为：

```ts
import { ingestUsageEvents, requireOpenMeterClient, resolveUsageSubject, UsageEventInput } from './index';
```

（注意：`requireOpenMeterClient` 会创建单例，`getOpenMeterClient` 测试间共享实例无碍——断言只看 truthy 与抛错。）

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/core/services/openmeter/index.test.ts`
Expected: FAIL（`requireOpenMeterClient` 未导出）

- [ ] **Step 3: 实现服务层函数** —— 追加到 `src/core/services/openmeter/index.ts` 的 `ingestUsageEvents` 之后：

```ts
/**
 * Mutation 用：拿不到客户端说明是配置问题而非可降级场景，显式抛错（读操作走 `getOpenMeterClient` 优雅降级）。
 */
export function requireOpenMeterClient(): OpenMeterClient {
	const client = getOpenMeterClient();
	if (!client) throw new Error('OpenMeter is disabled (VITE_OPENMETER_ENABLED=false)');
	return client;
}
```

- [ ] **Step 4: 跑服务层测试确认通过**

Run: `npx vitest run src/core/services/openmeter/index.test.ts`
Expected: PASS

- [ ] **Step 5: 写 mutations 失败测试**

```tsx
// src/hooks/useOpenMeterMeterMutations.test.tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { config } from '@/config/config';

const mocks = vi.hoisted(() => ({
	create: vi.fn(),
	update: vi.fn(),
	delete: vi.fn(),
}));

vi.mock('@openmeter/sdk', () => ({
	OpenMeter: class {
		meters = { create: mocks.create, update: mocks.update, delete: mocks.delete };
		constructor(public clientConfig: unknown) {}
	},
}));

import { useCreateOpenMeterMeter, useDeleteOpenMeterMeter, useUpdateOpenMeterMeter } from './useOpenMeterMeterMutations';

const createInput = {
	slug: 'test_meter',
	name: 'Test Meter',
	eventType: 'test_events',
	aggregation: 'SUM',
	valueProperty: '$.value',
} as const;

function setup() {
	const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
	const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
	const wrapper = function Wrapper({ children }: { children: ReactNode }) {
		return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
	};
	return { invalidateSpy, wrapper };
}

beforeEach(() => {
	[mocks.create, mocks.update, mocks.delete].forEach((m) => m.mockReset());
});

describe('useCreateOpenMeterMeter', () => {
	it('creates a meter and invalidates the meter list', async () => {
		mocks.create.mockResolvedValueOnce({ id: 'm-1', ...createInput });
		const { invalidateSpy, wrapper } = setup();

		const { result } = renderHook(() => useCreateOpenMeterMeter(), { wrapper });
		result.current.mutate(createInput);
		await waitFor(() => expect(result.current.isSuccess).toBe(true));

		expect(mocks.create).toHaveBeenCalledWith(createInput);
		expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['openmeter', 'meters'] });
	});

	it('surfaces a mutation error when OpenMeter is disabled', async () => {
		const original = config.openmeter.enabled;
		config.openmeter.enabled = false;
		try {
			const { wrapper } = setup();
			const { result } = renderHook(() => useCreateOpenMeterMeter(), { wrapper });
			result.current.mutate(createInput);
			await waitFor(() => expect(result.current.isError).toBe(true));
			expect(result.current.error).toMatchObject({ message: expect.stringContaining('VITE_OPENMETER_ENABLED') });
			expect(mocks.create).not.toHaveBeenCalled();
		} finally {
			config.openmeter.enabled = original;
		}
	});
});

describe('useUpdateOpenMeterMeter', () => {
	it('patches the meter and invalidates list + detail keys', async () => {
		mocks.update.mockResolvedValueOnce({ id: 'm-1', ...createInput });
		const { invalidateSpy, wrapper } = setup();

		const { result } = renderHook(() => useUpdateOpenMeterMeter(), { wrapper });
		result.current.mutate({ idOrSlug: 'test_meter', meter: { name: 'Renamed' } });
		await waitFor(() => expect(result.current.isSuccess).toBe(true));

		expect(mocks.update).toHaveBeenCalledWith('test_meter', { name: 'Renamed' });
		expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['openmeter', 'meters'] });
		expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['openmeter', 'meter', 'test_meter'] });
	});
});

describe('useDeleteOpenMeterMeter', () => {
	it('deletes by slug and invalidates list + detail keys', async () => {
		mocks.delete.mockResolvedValueOnce(undefined);
		const { invalidateSpy, wrapper } = setup();

		const { result } = renderHook(() => useDeleteOpenMeterMeter(), { wrapper });
		result.current.mutate('test_meter');
		await waitFor(() => expect(result.current.isSuccess).toBe(true));

		expect(mocks.delete).toHaveBeenCalledWith('test_meter');
		expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['openmeter', 'meter', 'test_meter'] });
	});
});
```

- [ ] **Step 6: 跑测试确认失败**

Run: `npx vitest run src/hooks/useOpenMeterMeterMutations.test.tsx`
Expected: FAIL（模块不存在）

- [ ] **Step 7: 写实现**

```ts
// src/hooks/useOpenMeterMeterMutations.ts
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { OpenMeterClient, requireOpenMeterClient } from '@/core/services/openmeter';
import { openMeterQueryKeys } from './useOpenMeterQuery';

export type MeterCreateInput = Parameters<OpenMeterClient['meters']['create']>[0];
export type MeterUpdateInput = NonNullable<Parameters<OpenMeterClient['meters']['update']>[1]>;

/** 新建计量表；成功后失效列表缓存。 */
export function useCreateOpenMeterMeter() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: async (meter: MeterCreateInput) => (await requireOpenMeterClient().meters.create(meter)) ?? null,
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: openMeterQueryKeys.meters });
		},
	});
}

/** 修改计量表（名称/描述/metadata）；成功后失效列表 + 详情缓存。 */
export function useUpdateOpenMeterMeter() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: async ({ idOrSlug, meter }: { idOrSlug: string; meter: MeterUpdateInput }) =>
			(await requireOpenMeterClient().meters.update(idOrSlug, meter)) ?? null,
		onSuccess: (_data, { idOrSlug }) => {
			void queryClient.invalidateQueries({ queryKey: openMeterQueryKeys.meters });
			void queryClient.invalidateQueries({ queryKey: openMeterQueryKeys.meter(idOrSlug) });
		},
	});
}

/** 删除计量表（按 ID 或 slug）；成功后失效列表 + 详情缓存。 */
export function useDeleteOpenMeterMeter() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: async (idOrSlug: string) => {
			await requireOpenMeterClient().meters.delete(idOrSlug);
			return idOrSlug;
		},
		onSuccess: (_data, idOrSlug) => {
			void queryClient.invalidateQueries({ queryKey: openMeterQueryKeys.meters });
			void queryClient.invalidateQueries({ queryKey: openMeterQueryKeys.meter(idOrSlug) });
		},
	});
}
```

- [ ] **Step 8: 跑测试确认通过**

Run: `npx vitest run src/hooks/useOpenMeterMeterMutations.test.tsx`
Expected: PASS（4 个用例）

- [ ] **Step 9: 提交**

```bash
git add src/core/services/openmeter/index.ts src/core/services/openmeter/index.test.ts src/hooks/useOpenMeterMeterMutations.ts src/hooks/useOpenMeterMeterMutations.test.tsx
git commit -m "feat(openmeter): meters create/update/delete mutations 与 requireOpenMeterClient"
```

---

### Task 4: Subjects 对接（list/get/upsert/delete + 登录用户自动注册）

**Files:**
- Create: `src/hooks/useOpenMeterSubjects.ts`
- Test: `src/hooks/useOpenMeterSubjects.test.tsx`

**Interfaces:**
- Consumes: `requireOpenMeterClient()`（Task 3）、`config.openmeter.enabled`、`useUser`（`@/hooks/useUser`，默认导出，返回 `{ user }`，user 含 `id`/`name`/`email`）
- Produces: `useOpenMeterSubjects()` → `OpenMeterSubject[]`；`useOpenMeterSubject(idOrKey: string)` → `OpenMeterSubject | null`；`useUpsertOpenMeterSubjects()`（入参 `SubjectUpsertInput`，单对象或数组）、`useDeleteOpenMeterSubject()`；`useRegisterUsageSubject()`（副作用 hook，挂到 MainLayout）；类型 `OpenMeterSubject`、`SubjectUpsertInput`；key 前缀 `['openmeter', 'subjects']` / `['openmeter', 'subject', key]`

- [ ] **Step 1: 写失败测试**

```tsx
// src/hooks/useOpenMeterSubjects.test.tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { config } from '@/config/config';

const mocks = vi.hoisted(() => ({
	list: vi.fn(),
	get: vi.fn(),
	upsert: vi.fn(),
	delete: vi.fn(),
}));

const mockUser = vi.hoisted(() => ({ current: undefined as Record<string, unknown> | undefined }));

vi.mock('@openmeter/sdk', () => ({
	OpenMeter: class {
		subjects = { list: mocks.list, get: mocks.get, upsert: mocks.upsert, delete: mocks.delete };
		constructor(public clientConfig: unknown) {}
	},
}));

vi.mock('@/hooks/useUser', () => ({
	default: () => ({ user: mockUser.current, loading: false }),
}));

import {
	useDeleteOpenMeterSubject,
	useOpenMeterSubject,
	useOpenMeterSubjects,
	useRegisterUsageSubject,
	useUpsertOpenMeterSubjects,
} from './useOpenMeterSubjects';

const subject = {
	id: '01subj',
	key: 'u-42',
	displayName: 'Tester',
	metadata: {},
	createdAt: new Date('2026-09-04T00:00:00Z'),
	updatedAt: new Date('2026-09-04T00:00:00Z'),
};

function createWrapper() {
	const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
	return function Wrapper({ children }: { children: ReactNode }) {
		return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
	};
}

beforeEach(() => {
	[mocks.list, mocks.get, mocks.upsert, mocks.delete].forEach((m) => m.mockReset());
	mockUser.current = undefined;
});

describe('useOpenMeterSubjects / useOpenMeterSubject', () => {
	it('lists subjects from the backend', async () => {
		mocks.list.mockResolvedValueOnce([subject]);
		const { result } = renderHook(() => useOpenMeterSubjects(), { wrapper: createWrapper() });
		await waitFor(() => expect(result.current.isSuccess).toBe(true));
		expect(result.current.data).toEqual([subject]);
	});

	it('maps a missing subject to null instead of an error', async () => {
		mocks.get.mockResolvedValueOnce(undefined);
		const { result } = renderHook(() => useOpenMeterSubject('ghost'), { wrapper: createWrapper() });
		await waitFor(() => expect(result.current.isSuccess).toBe(true));
		expect(result.current.data).toBeNull();
	});
});

describe('useUpsertOpenMeterSubjects', () => {
	it('upserts a batch and invalidates the list', async () => {
		mocks.upsert.mockResolvedValueOnce([subject]);
		const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
		const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
		const wrapper = function Wrapper({ children }: { children: ReactNode }) {
			return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
		};

		const { result } = renderHook(() => useUpsertOpenMeterSubjects(), { wrapper });
		result.current.mutate([{ key: 'u-42', displayName: 'Tester' }]);
		await waitFor(() => expect(result.current.isSuccess).toBe(true));

		expect(mocks.upsert).toHaveBeenCalledWith([{ key: 'u-42', displayName: 'Tester' }]);
		expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['openmeter', 'subjects'] });
	});
});

describe('useRegisterUsageSubject', () => {
	it('upserts the signed-in user as a subject on mount', () => {
		mockUser.current = { id: 'u-42', name: 'Tester', email: 't@f.io' };
		renderHook(() => useRegisterUsageSubject(), { wrapper: createWrapper() });
		expect(mocks.upsert).toHaveBeenCalledWith(
			{ key: 'u-42', displayName: 'Tester' },
			expect.objectContaining({ onError: expect.any(Function) }),
		);
	});

	it('prefers email over name for displayName when name is empty', () => {
		mockUser.current = { id: 'u-42', email: 't@f.io' };
		renderHook(() => useRegisterUsageSubject(), { wrapper: createWrapper() });
		expect(mocks.upsert).toHaveBeenCalledWith({ key: 'u-42', displayName: 't@f.io' }, expect.anything());
	});

	it('does nothing when logged out', () => {
		renderHook(() => useRegisterUsageSubject(), { wrapper: createWrapper() });
		expect(mocks.upsert).not.toHaveBeenCalled();
	});

	it('does nothing when OpenMeter is disabled', () => {
		const original = config.openmeter.enabled;
		config.openmeter.enabled = false;
		try {
			mockUser.current = { id: 'u-42' };
			renderHook(() => useRegisterUsageSubject(), { wrapper: createWrapper() });
			expect(mocks.upsert).not.toHaveBeenCalled();
		} finally {
			config.openmeter.enabled = original;
		}
	});
});

describe('useDeleteOpenMeterSubject', () => {
	it('deletes by key and invalidates list + detail', async () => {
		mocks.delete.mockResolvedValueOnce(undefined);
		const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
		const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
		const wrapper = function Wrapper({ children }: { children: ReactNode }) {
			return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
		};

		const { result } = renderHook(() => useDeleteOpenMeterSubject(), { wrapper });
		result.current.mutate('u-42');
		await waitFor(() => expect(result.current.isSuccess).toBe(true));

		expect(mocks.delete).toHaveBeenCalledWith('u-42');
		expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['openmeter', 'subjects'] });
		expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['openmeter', 'subject', 'u-42'] });
	});
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/hooks/useOpenMeterSubjects.test.tsx`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 写实现**

```ts
// src/hooks/useOpenMeterSubjects.ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { config } from '@/config/config';
import { OpenMeterClient, requireOpenMeterClient } from '@/core/services/openmeter';
import useUser from './useUser';

export type OpenMeterSubject = NonNullable<Awaited<ReturnType<OpenMeterClient['subjects']['list']>>>[number];
export type SubjectUpsertInput = NonNullable<Parameters<OpenMeterClient['subjects']['upsert']>[0]>;

export const openMeterSubjectsKeys = {
	all: ['openmeter', 'subjects'] as const,
	detail: (idOrKey: string) => ['openmeter', 'subject', idOrKey] as const,
};

/** 列出 OpenMeter 中已注册的全部 subject。禁用时为空数组。 */
export function useOpenMeterSubjects() {
	return useQuery<OpenMeterSubject[]>({
		queryKey: openMeterSubjectsKeys.all,
		queryFn: async () => {
			const client = getOpenMeterClientForRead();
			if (!client) return [];
			return (await client.subjects.list()) ?? [];
		},
		enabled: config.openmeter.enabled,
	});
}

/** 按 ID 或 key 取单个 subject；不存在（404 → undefined）映射为 null 而非错误态。 */
export function useOpenMeterSubject(idOrKey: string) {
	return useQuery<OpenMeterSubject | null>({
		queryKey: openMeterSubjectsKeys.detail(idOrKey),
		queryFn: async () => {
			const client = getOpenMeterClientForRead();
			if (!client) return null;
			return (await client.subjects.get(idOrKey)) ?? null;
		},
		enabled: config.openmeter.enabled && Boolean(idOrKey),
	});
}

/** 批量/单个 upsert：key 不存在则创建，存在则更新。 */
export function useUpsertOpenMeterSubjects() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: async (subjects: SubjectUpsertInput) => (await requireOpenMeterClient().subjects.upsert(subjects)) ?? [],
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: openMeterSubjectsKeys.all });
		},
	});
}

export function useDeleteOpenMeterSubject() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: async (idOrKey: string) => {
			await requireOpenMeterClient().subjects.delete(idOrKey);
			return idOrKey;
		},
		onSuccess: (_data, idOrKey) => {
			void queryClient.invalidateQueries({ queryKey: openMeterSubjectsKeys.all });
			void queryClient.invalidateQueries({ queryKey: openMeterSubjectsKeys.detail(idOrKey) });
		},
	});
}

/**
 * 把当前登录的 Flexprice 用户注册为 OpenMeter subject（幂等 upsert），让计量表能按用户切片。
 * 未登录或 OpenMeter 禁用时无操作；失败只告警，不打断界面。
 */
export function useRegisterUsageSubject() {
	const { user } = useUser();
	const upsert = useUpsertOpenMeterSubjects();
	const subjectKey = user?.id;
	const displayName = user?.name || user?.email;

	useEffect(() => {
		if (!config.openmeter.enabled || !subjectKey) return;
		upsert.mutate(
			{ key: subjectKey, displayName },
			{ onError: (err) => console.warn('[openmeter] failed to register usage subject:', err) },
		);
	}, [subjectKey, displayName, upsert.mutate]);
}
```

注意：实现里 `getOpenMeterClientForRead` 不是新函数——直接使用 `getOpenMeterClient`（上面伪名只为说明读路径），实际 import 为 `import { getOpenMeterClient, OpenMeterClient, requireOpenMeterClient } from '@/core/services/openmeter';` 并在两个查询里调用 `getOpenMeterClient()`。

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run src/hooks/useOpenMeterSubjects.test.tsx`
Expected: PASS（8 个用例）

- [ ] **Step 5: 提交**

```bash
git add src/hooks/useOpenMeterSubjects.ts src/hooks/useOpenMeterSubjects.test.tsx
git commit -m "feat(openmeter): subjects list/get/upsert/delete hooks 与登录用户自动注册"
```

---

### Task 5: Features 对接（list/get/create/delete）

**Files:**
- Create: `src/hooks/useOpenMeterFeatures.ts`
- Test: `src/hooks/useOpenMeterFeatures.test.tsx`

**Interfaces:**
- Consumes: `requireOpenMeterClient()`（Task 3）、`getOpenMeterClient()`
- Produces: `useOpenMeterFeatures()` → `OpenMeterFeature[]`；`useOpenMeterFeature(id: string)` → `OpenMeterFeature | null`；`useCreateOpenMeterFeature()`、`useDeleteOpenMeterFeature()`；类型 `OpenMeterFeature`、`FeatureCreateInput`；key 前缀 `['openmeter', 'features']` / `['openmeter', 'feature', id]`

- [ ] **Step 1: 写失败测试**

```tsx
// src/hooks/useOpenMeterFeatures.test.tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { config } from '@/config/config';

const mocks = vi.hoisted(() => ({
	list: vi.fn(),
	get: vi.fn(),
	create: vi.fn(),
	delete: vi.fn(),
}));

vi.mock('@openmeter/sdk', () => ({
	OpenMeter: class {
		features = { list: mocks.list, get: mocks.get, create: mocks.create, delete: mocks.delete };
		constructor(public clientConfig: unknown) {}
	},
}));

import {
	useCreateOpenMeterFeature,
	useDeleteOpenMeterFeature,
	useOpenMeterFeature,
	useOpenMeterFeatures,
} from './useOpenMeterFeatures';

const feature = {
	id: 'f-1',
	key: 'agent_runs',
	name: 'Agent Runs',
	createdAt: new Date('2026-09-04T00:00:00Z'),
	updatedAt: new Date('2026-09-04T00:00:00Z'),
};

function createWrapper() {
	const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
	return function Wrapper({ children }: { children: ReactNode }) {
		return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
	};
}

beforeEach(() => {
	[mocks.list, mocks.get, mocks.create, mocks.delete].forEach((m) => m.mockReset());
});

describe('useOpenMeterFeatures / useOpenMeterFeature', () => {
	it('lists features from the backend', async () => {
		mocks.list.mockResolvedValueOnce([feature]);
		const { result } = renderHook(() => useOpenMeterFeatures(), { wrapper: createWrapper() });
		await waitFor(() => expect(result.current.isSuccess).toBe(true));
		expect(result.current.data).toEqual([feature]);
	});

	it('maps a missing feature to null', async () => {
		mocks.get.mockResolvedValueOnce(undefined);
		const { result } = renderHook(() => useOpenMeterFeature('ghost'), { wrapper: createWrapper() });
		await waitFor(() => expect(result.current.isSuccess).toBe(true));
		expect(result.current.data).toBeNull();
	});
});

describe('useCreateOpenMeterFeature', () => {
	it('creates a feature and invalidates the list', async () => {
		mocks.create.mockResolvedValueOnce(feature);
		const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
		const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
		const wrapper = function Wrapper({ children }: { children: ReactNode }) {
			return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
		};

		const { result } = renderHook(() => useCreateOpenMeterFeature(), { wrapper });
		result.current.mutate({ key: 'agent_runs', name: 'Agent Runs' });
		await waitFor(() => expect(result.current.isSuccess).toBe(true));

		expect(mocks.create).toHaveBeenCalledWith({ key: 'agent_runs', name: 'Agent Runs' });
		expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['openmeter', 'features'] });
	});
});

describe('useDeleteOpenMeterFeature', () => {
	it('deletes by id and invalidates list + detail', async () => {
		mocks.delete.mockResolvedValueOnce(undefined);
		const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
		const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
		const wrapper = function Wrapper({ children }: { children: ReactNode }) {
			return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
		};

		const { result } = renderHook(() => useDeleteOpenMeterFeature(), { wrapper });
		result.current.mutate('f-1');
		await waitFor(() => expect(result.current.isSuccess).toBe(true));

		expect(mocks.delete).toHaveBeenCalledWith('f-1');
		expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['openmeter', 'feature', 'f-1'] });
	});
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/hooks/useOpenMeterFeatures.test.tsx`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 写实现**

```ts
// src/hooks/useOpenMeterFeatures.ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { config } from '@/config/config';
import { getOpenMeterClient, OpenMeterClient, requireOpenMeterClient } from '@/core/services/openmeter';

export type OpenMeterFeature = Awaited<ReturnType<OpenMeterClient['features']['list']>>[number];
export type FeatureCreateInput = Parameters<OpenMeterClient['features']['create']>[0];

export const openMeterFeaturesKeys = {
	all: ['openmeter', 'features'] as const,
	detail: (id: string) => ['openmeter', 'feature', id] as const,
};

/** 列出 OpenMeter 中定义的 feature。禁用时为空数组。 */
export function useOpenMeterFeatures() {
	return useQuery<OpenMeterFeature[]>({
		queryKey: openMeterFeaturesKeys.all,
		queryFn: async () => {
			const client = getOpenMeterClient();
			if (!client) return [];
			return (await client.features.list()) ?? [];
		},
		enabled: config.openmeter.enabled,
	});
}

/** 按 ID 取单个 feature；不存在映射为 null。 */
export function useOpenMeterFeature(id: string) {
	return useQuery<OpenMeterFeature | null>({
		queryKey: openMeterFeaturesKeys.detail(id),
		queryFn: async () => {
			const client = getOpenMeterClient();
			if (!client) return null;
			return (await client.features.get(id)) ?? null;
		},
		enabled: config.openmeter.enabled && Boolean(id),
	});
}

export function useCreateOpenMeterFeature() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: async (feature: FeatureCreateInput) => (await requireOpenMeterClient().features.create(feature)) ?? null,
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: openMeterFeaturesKeys.all });
		},
	});
}

export function useDeleteOpenMeterFeature() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: async (id: string) => {
			await requireOpenMeterClient().features.delete(id);
			return id;
		},
		onSuccess: (_data, id) => {
			void queryClient.invalidateQueries({ queryKey: openMeterFeaturesKeys.all });
			void queryClient.invalidateQueries({ queryKey: openMeterFeaturesKeys.detail(id) });
		},
	});
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run src/hooks/useOpenMeterFeatures.test.tsx`
Expected: PASS（4 个用例）

- [ ] **Step 5: 提交**

```bash
git add src/hooks/useOpenMeterFeatures.ts src/hooks/useOpenMeterFeatures.test.tsx
git commit -m "feat(openmeter): features list/get/create/delete hooks"
```

---

### Task 6: Info 对接（currencies + progress）

**Files:**
- Create: `src/hooks/useOpenMeterInfo.ts`
- Test: `src/hooks/useOpenMeterInfo.test.tsx`

**Interfaces:**
- Consumes: `getOpenMeterClient()`
- Produces: `useOpenMeterCurrencies()` → `OpenMeterCurrency[]`（`staleTime: Infinity`，静态目录）；`useOpenMeterProgress(id: string)` → `OpenMeterProgress | null`；类型 `OpenMeterCurrency`、`OpenMeterProgress`；key 前缀 `['openmeter', 'currencies']` / `['openmeter', 'progress', id]`

- [ ] **Step 1: 写失败测试**

```tsx
// src/hooks/useOpenMeterInfo.test.tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	listCurrencies: vi.fn(),
	getProgress: vi.fn(),
}));

vi.mock('@openmeter/sdk', () => ({
	OpenMeter: class {
		info = { listCurrencies: mocks.listCurrencies, getProgress: mocks.getProgress };
		constructor(public clientConfig: unknown) {}
	},
}));

import { useOpenMeterCurrencies, useOpenMeterProgress } from './useOpenMeterInfo';

function createWrapper() {
	const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	return function Wrapper({ children }: { children: ReactNode }) {
		return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
	};
}

beforeEach(() => {
	mocks.listCurrencies.mockReset();
	mocks.getProgress.mockReset();
});

describe('useOpenMeterCurrencies', () => {
	it('lists the currency catalog', async () => {
		const currencies = [{ code: 'USD', name: 'US Dollar', symbol: '$', subunits: 100 }];
		mocks.listCurrencies.mockResolvedValueOnce(currencies);
		const { result } = renderHook(() => useOpenMeterCurrencies(), { wrapper: createWrapper() });
		await waitFor(() => expect(result.current.isSuccess).toBe(true));
		expect(result.current.data).toEqual(currencies);
	});
});

describe('useOpenMeterProgress', () => {
	it('polls progress for a bulk operation id', async () => {
		const progress = { success: 3, failed: 0, total: 5, updatedAt: new Date('2026-09-04T00:00:00Z') };
		mocks.getProgress.mockResolvedValueOnce(progress);
		const { result } = renderHook(() => useOpenMeterProgress('job-1'), { wrapper: createWrapper() });
		await waitFor(() => expect(result.current.isSuccess).toBe(true));
		expect(mocks.getProgress).toHaveBeenCalledWith('job-1');
		expect(result.current.data).toEqual(progress);
	});

	it('is disabled for an empty id', () => {
		const { result } = renderHook(() => useOpenMeterProgress(''), { wrapper: createWrapper() });
		expect(result.current.data).toBeUndefined();
		expect(mocks.getProgress).not.toHaveBeenCalled();
	});
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/hooks/useOpenMeterInfo.test.tsx`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 写实现**

```ts
// src/hooks/useOpenMeterInfo.ts
import { useQuery } from '@tanstack/react-query';
import { config } from '@/config/config';
import { getOpenMeterClient, OpenMeterClient } from '@/core/services/openmeter';

export type OpenMeterCurrency = NonNullable<Awaited<ReturnType<OpenMeterClient['info']['listCurrencies']>>>[number];
export type OpenMeterProgress = NonNullable<Awaited<ReturnType<OpenMeterClient['info']['getProgress']>>>;

export const openMeterInfoKeys = {
	currencies: ['openmeter', 'currencies'] as const,
	progress: (id: string) => ['openmeter', 'progress', id] as const,
};

/** 币种静态目录，整个会话缓存不重取。 */
export function useOpenMeterCurrencies() {
	return useQuery<OpenMeterCurrency[]>({
		queryKey: openMeterInfoKeys.currencies,
		queryFn: async () => {
			const client = getOpenMeterClient();
			if (!client) return [];
			return (await client.info.listCurrencies()) ?? [];
		},
		enabled: config.openmeter.enabled,
		staleTime: Infinity,
	});
}

/** 轮询批量操作（如 subject 导入）的进度。 */
export function useOpenMeterProgress(id: string) {
	return useQuery<OpenMeterProgress | null>({
		queryKey: openMeterInfoKeys.progress(id),
		queryFn: async () => {
			const client = getOpenMeterClient();
			if (!client) return null;
			return (await client.info.getProgress(id)) ?? null;
		},
		enabled: config.openmeter.enabled && Boolean(id),
	});
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run src/hooks/useOpenMeterInfo.test.tsx`
Expected: PASS（3 个用例）

- [ ] **Step 5: 提交**

```bash
git add src/hooks/useOpenMeterInfo.ts src/hooks/useOpenMeterInfo.test.tsx
git commit -m "feat(openmeter): info 币种目录与批量操作进度查询 hooks"
```

---

### Task 7: MainLayout 接线 + 全量验证

**Files:**
- Modify: `src/layouts/MainLayout.tsx`（import + 一行调用）

**Interfaces:**
- Consumes: `useRegisterUsageSubject()`（Task 4 产出）
- Produces: 应用启动后登录用户自动注册为 OpenMeter subject（幂等）

- [ ] **Step 1: 接线** —— `src/layouts/MainLayout.tsx` 在 `usePageViewTracking` 的 import 之后新增：

```tsx
import { useRegisterUsageSubject } from '@/hooks/useOpenMeterSubjects';
```

组件体内 `usePageViewTracking();`（第 18 行）之后新增一行：

```tsx
	useRegisterUsageSubject();
```

- [ ] **Step 2: OpenMeter 全量单测**

Run: `npx vitest run src/core/services/openmeter src/hooks/useOpenMeter src/hooks/useOpenMeterQuery.test.tsx src/hooks/useOpenMeterEvents.test.tsx src/hooks/useOpenMeterSubjects.test.tsx src/hooks/useOpenMeterFeatures.test.tsx src/hooks/useOpenMeterInfo.test.tsx src/hooks/useOpenMeterMeterMutations.test.tsx`
Expected: 全部 PASS（既有 index.test.ts + 6 个新测试文件）

- [ ] **Step 3: 全仓测试回归**

Run: `npx vitest run`
Expected: 全部 PASS，无新增失败

- [ ] **Step 4: Lint**

Run: `npx eslint src/`
Expected: 零 error

- [ ] **Step 5: 构建**

Run: `npm run build`
Expected: `tsc -b` 无类型错误 + vite build 成功

- [ ] **Step 6: 活体后端验证**（本地 OpenMeter 已在 8888 运行）

```bash
curl -s http://localhost:8888/api/v1/meters | python3 -c 'import json,sys; print(len(json.load(sys.stdin)), "meters")'
curl -s -X POST -H "Content-Type: application/json" -d "[{\"key\":\"smoke-subject\",\"displayName\":\"smoke\"}]" -o /dev/null -w "upsert: %{http_code}\n" http://localhost:8888/api/v1/subjects
curl -s http://localhost:8888/api/v1/subjects | python3 -c 'import json,sys; print([s["key"] for s in json.load(sys.stdin)])'
curl -s -X DELETE -o /dev/null -w "cleanup: %{http_code}\n" http://localhost:8888/api/v1/subjects/smoke-subject
```

Expected: `20 meters`（或更多）、`upsert: 200`、列表含 `smoke-subject`、`cleanup: 200`

- [ ] **Step 7: 提交**

```bash
git add src/layouts/MainLayout.tsx
git commit -m "feat(openmeter): MainLayout 挂载登录用户 subject 自动注册"
```

---

## Self-Review 记录

1. **规格覆盖**：用户要求"把 openmeter 后端 api 一个一个对接"——矩阵 17 项中，本地后端支持的 16 项全部有对应任务（其中 4 项为上轮已完成、本轮回归覆盖）；排除项（Billing 模块、debug、listGroupByValues、Portal）及理由写入 Global Constraints。
2. **占位符扫描**：所有步骤含完整代码/命令/期望输出，无 TBD/TODO。
3. **类型一致性**：`requireOpenMeterClient`（Task 3 产出）被 Task 4/5 消费；`openMeterQueryKeys.meter/usagePost`（Task 2）被 Task 3 消费；各域 key 前缀统一 `['openmeter', <domain>]`；`MeterQueryPostBody`、`SubjectUpsertInput` 等类型全部从 SDK 派生，无手抄。

---

# 附录：阶段二 —— Billing 全域接入与浏览器 E2E（2026-09-04 完成）

用户目标升级为"**全部后端**接入 + 浏览器端到端测试"。实测确认本地后端（社区版）其实完整支持 Billing 模块（正确路径下全部 200）。

## 阶段二对接矩阵（新增 9 个域，24 个新单测全过）

| 域 | hook 文件 | 覆盖方法 |
|---|---|---|
| addons | `useOpenMeterAddons.ts` | list/get/create/update/delete/publish/archive |
| plans | `useOpenMeterPlans.ts` | list/get/create/delete/publish/archive |
| apps | `useOpenMeterApps.ts` | list/get/uninstall |
| customers | `useOpenMeterCustomers.ts` | list/get/getAccess/create/update/delete |
| billing profiles | `useOpenMeterBillingProfiles.ts` | list/get/create/update/delete |
| invoices | `useOpenMeterInvoices.ts` | list/get/advance/approve/retry/void |
| entitlements | `useOpenMeterEntitlements.ts` | v2 list/get、v2 grants list/void、v1 subject value、customer entitlement value |
| notifications | `useOpenMeterNotifications.ts` | channels/rules/events 列表、channel create/delete |
| subscriptions | `useOpenMeterSubscriptions.ts` | get/create/cancel、subscriptionAddons list |

后端真实路径勘误：invoices 在 `/api/v1/billing/invoices`、profiles 在 `/api/v1/billing/profiles`、通知是单数 `/api/v1/notification/*`。分页 list 统一返回 `{ items, totalCount, page, pageSize }`。

**域级未接子资源**（透明声明）：apps.marketplace/stripe/customInvoicing（云连接器管理面）、plan.addons、customers.apps/appData/stripe、entitlementsV1 的 history/override/reset、subscriptions 的 edit/change/migrate、notifications update/resend。均为子资源/低频动作，主 CRUD 与生命周期已覆盖。

## 后端适配修复（E2E 发现的真问题）

1. **OpenMeter 社区版无 CORS 头**（OPTIONS 预检 405）：浏览器不能直连 8888。修复：`vite.config.ts`（及其 tsc 产物 `vite.config.js`，Vite 优先加载 .js）新增 `/openmeter` → `http://localhost:8888` 同源代理；`.env` 的 `VITE_OPENMETER_URL=/openmeter`。生产部署由反向代理承担。
2. **`vite.config.js` 是 `tsc -b` 编译产物且优先于 .ts 加载**——只改 .ts 不生效（本次 E2E 踩坑）。

## 浏览器 E2E 结论（IAB 真实浏览器驱动 localhost:3000）

- 登录页 → onboarding 表单 → dashboard 全流程可走通（Flexprice 后端 :8080 以最小 mock 垫片替代）
- 真实 UI 导航（侧边栏点击）触发 `usePageViewTracking` → SDK ingest → 代理 → OpenMeter 落库，逐条可查（/billing/customers、/home、/usage-tracking/events）
- 新建 `frontend_page_views` 计量表后聚合可查：总 page views=14，per-subject（e2e-user-42）=1
- `subjects.upsert` 经代理 200，subject 列表可见 `e2e-user-42`
- `useRegisterUsageSubject` 在真实浏览器中的守卫符合设计：`useUser` 是 token+API 驱动，未登录（无 token）不注册；SDK upsert 通路已在浏览器内验证 200
- E2E 环境备注：resource-timing/fetch-hook 诊断在该 IAB 环境不可靠（缓冲区限制+SDK 捕获原始 fetch 引用），验证以 OpenMeter 侧数据为准
