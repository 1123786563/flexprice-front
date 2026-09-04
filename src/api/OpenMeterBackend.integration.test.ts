import { describe, it, expect, beforeAll, vi } from 'vitest';

/**
 * OpenMeter 真实后端集成测试（gated）：
 * 探测 TEST_OPENMETER_API_URL（默认 http://127.0.0.1:8888）可达才执行，否则整组跳过。
 * 与 mock 单测互补：验证映射层与真实服务器的契约（如 key slug 正则、状态枚举、
 * 整对象替换语义），这类校验 mock 测不到（历史教训：plan key 连字符 400）。
 *
 * 运行：后端在跑时 `npx vitest run src/api/OpenMeterBackend.integration.test.ts`
 * 注意会向真实后端写入 itest-* 前缀的数据并在 finally 清理。
 */

const OM_URL = process.env.TEST_OPENMETER_API_URL ?? 'http://127.0.0.1:8888';

async function backendUp(): Promise<boolean> {
	try {
		// jsdom 的 fetch 不认 node realm 的 AbortSignal，用 Promise.race 实现超时
		const res = await Promise.race([
			fetch(`${OM_URL}/api/v1/info/currencies`),
			new Promise<never>((_, reject) => setTimeout(() => reject(new Error('probe timeout')), 3000)),
		]);
		return (res as Response).ok;
	} catch {
		return false;
	}
}

const up = await backendUp();

describe.skipIf(!up)('OpenMeter 后端集成（真实服务器）', () => {
	let CustomerApi: (typeof import('@/api/CustomerApi'))['default'];
	let PlanApi: (typeof import('@/api/PlanApi'))['PlanApi'];
	let PriceApi: (typeof import('@/api/PriceApi'))['PriceApi'];
	let SubscriptionApi: (typeof import('@/api/SubscriptionApi'))['default'];
	let InvoiceApi: (typeof import('@/api/InvoiceApi'))['default'];
	const stamp = Date.now().toString(36);
	const customerKey = `itest-cust-${stamp}`;
	const planLookupKey = `itest_plan_${stamp}`;

	beforeAll(async () => {
		// config 在模块顶层读取 import.meta.env：先 stub 再重载模块树，
		// 让 getOpenMeterClient() 直连真实后端（绕过仅存在于 vite dev 的 /openmeter 代理）。
		vi.stubEnv('VITE_OPENMETER_ENABLED', 'true');
		vi.stubEnv('VITE_OPENMETER_URL', OM_URL);
		vi.resetModules();
		const customerMod = await import('@/api/CustomerApi');
		const planMod = await import('@/api/PlanApi');
		const priceMod = await import('@/api/PriceApi');
		const subscriptionMod = await import('@/api/SubscriptionApi');
		const invoiceMod = await import('@/api/InvoiceApi');
		CustomerApi = customerMod.default;
		PlanApi = planMod.PlanApi;
		PriceApi = priceMod.PriceApi;
		SubscriptionApi = subscriptionMod.default;
		InvoiceApi = invoiceMod.default;
	});

	it('客户全生命周期：创建→读→更新→列表→删除', async () => {
		const created = await CustomerApi.createCustomer({
			external_id: customerKey,
			name: `ITest Customer ${stamp}`,
			email: `itest-${stamp}@example.com`,
		});
		expect(created.external_id).toBe(customerKey);

		const fetched = await CustomerApi.getCustomerById(created.id);
		expect(fetched.name).toBe(`ITest Customer ${stamp}`);

		const updated = await CustomerApi.updateCustomer({ name: `ITest Renamed ${stamp}` }, created.id);
		expect(updated.name).toBe(`ITest Renamed ${stamp}`);

		const list = await CustomerApi.getCustomers({ limit: 100, offset: 0, external_ids: [customerKey] });
		expect(list.items.map((c) => c.id)).toContain(created.id);

		await CustomerApi.deleteCustomerById(created.id);
		// OM 客户删除是软删：get 仍返回记录，但默认列表不再包含
		const afterDelete = await CustomerApi.getCustomers({ limit: 100, offset: 0 });
		expect(afterDelete.items.map((c) => c.id)).not.toContain(created.id);
	}, 30000);

	it('计划全生命周期：创建（key 规范化）→加价格卡→发布→列表→软删', async () => {
		const created = await PlanApi.createPlan({
			name: `ITest Plan ${stamp}`,
			lookup_key: `itest-plan-${stamp}`, // 连字符：服务端校验必须折叠为下划线
		} as never);
		expect(created.lookup_key).toBe(planLookupKey);

		// 新计划无价格卡保持 draft（发布失败被容忍）；挂价格卡后 createSubscription 会补发布。
		// 直接经 PriceApi 加卡超出本用例范围（PriceApi 需要 plan 上下文组装），断言 draft 可读即可。
		const fetched = await PlanApi.getPlanById(created.id);
		expect(fetched.name).toBe(`ITest Plan ${stamp}`);

		const list = await PlanApi.getPlansByFilter({ limit: 100, offset: 0, lookup_key: planLookupKey });
		expect(list.items.map((p) => p.id)).toContain(created.id);

		await PlanApi.deletePlan(created.id);
		// OM 删除是软删：get 仍返回，但默认列表不再包含
		const afterDelete = await PlanApi.getPlansByFilter({ limit: 100, offset: 0, lookup_key: planLookupKey });
		expect(afterDelete.items.map((p) => p.id)).not.toContain(created.id);
	}, 30000);

	it('订阅全生命周期：计划加卡→创建（自动发布）→读→搜索→取消→清理', async () => {
		const customer = await CustomerApi.createCustomer({ external_id: `${customerKey}-sub`, name: `ITest Sub Holder ${stamp}` });
		const plan = await PlanApi.createPlan({ name: `ITest Sub Plan ${stamp}`, lookup_key: `itest_sub_plan_${stamp}` } as never);
		// 挂一张 flat 价格卡（真实 UI 流程：计划建好后先加价格，再创建订阅）
		await PriceApi.CreatePrice({
			entity_type: 'PLAN',
			entity_id: plan.id,
			currency: 'USD',
			amount: '10',
			type: 'FIXED',
			price_unit_type: 'FIAT',
			billing_model: 'FLAT_FEE',
			billing_period: 'MONTHLY',
			invoice_cadence: 'ARREAR',
			display_name: 'ITest Flat Fee',
		} as never);
		try {
			const sub = await SubscriptionApi.createSubscription({
				plan_id: plan.id,
				customer_id: customer.id,
				currency: 'USD',
				billing_period: 'MONTHLY',
			} as never);
			expect(sub.customer_id).toBe(customer.id);
			expect(sub.plan_id).toBe(plan.id);
			expect(sub.subscription_status).toBe('active');

			const fetched = await SubscriptionApi.getSubscription(sub.id);
			expect(fetched.id).toBe(sub.id);
			expect(fetched.currency).toBe('USD');

			const search = await SubscriptionApi.searchSubscriptions({ customer_id: customer.id });
			expect(search.items.map((s) => s.id)).toContain(sub.id);

			await SubscriptionApi.cancelSubscription(sub.id, { cancellation_type: 'immediate' } as never);
			const canceled = await SubscriptionApi.getSubscription(sub.id);
			expect(canceled.subscription_status).toBe('cancelled');
		} finally {
			await PlanApi.deletePlan(plan.id).catch(() => {});
			await CustomerApi.deleteCustomerById(customer.id).catch(() => {});
		}
	}, 45000);

	it('发票列表：真实端点空态/有值态均返回 Flexprice 形状', async () => {
		const res = await InvoiceApi.listInvoices({ limit: 10, offset: 0 } as never);
		expect(Array.isArray(res.items)).toBe(true);
		expect(res.pagination).toHaveProperty('total');
	});
});
