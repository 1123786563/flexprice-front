import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@/core/services/openmeter', () => ({
	getOpenMeterClient: vi.fn(),
	requireOpenMeterClient: vi.fn(),
}));

import { getOpenMeterClient, requireOpenMeterClient } from '@/core/services/openmeter';
import { PlanApi } from '@/api/PlanApi';
import type { OmPlan } from '@/core/services/openmeter/mappers/plan';
import { DataType, FilterOperator } from '@/types/common/QueryBuilder';
import { ENTITY_STATUS } from '@/models';

const OM_PLAN: OmPlan = {
	id: '01M1984JSY67Q5PYAYF47FNCXF',
	key: 'drill_plan_220',
	name: 'Drill Plan (issue-220)',
	currency: 'USD',
	billingCadence: 'P1M',
	status: 'active',
	version: 1,
	createdAt: '2026-08-30T11:51:05.790633Z',
	updatedAt: '2026-08-30T11:51:06.761254Z',
	phases: [
		{
			key: 'drill_phase',
			name: 'Drill Phase',
			duration: null,
			rateCards: [
				{
					type: 'flat_fee',
					key: 'drill_flat',
					name: 'Drill Flat Fee',
					billingCadence: 'P1M',
					price: { type: 'flat', amount: '50', paymentTerm: 'in_arrears' },
				},
			],
		},
	],
} as unknown as OmPlan;

const OM_PLAN_ARCHIVED: OmPlan = {
	...OM_PLAN,
	id: '01MARCHIVED0000000000000000',
	key: 'archived_plan',
	name: 'Archived Plan',
	status: 'archived',
} as unknown as OmPlan;

function mockClient(overrides: Record<string, unknown> = {}) {
	const client = {
		plans: {
			get: vi.fn().mockResolvedValue(OM_PLAN),
			list: vi.fn().mockResolvedValue({ items: [OM_PLAN, OM_PLAN_ARCHIVED], totalCount: 2, page: 1, pageSize: 10 }),
			create: vi.fn().mockResolvedValue(OM_PLAN),
			update: vi.fn().mockImplementation(async (_id: string, payload: Record<string, unknown>) => ({ ...OM_PLAN, ...payload })),
			delete: vi.fn().mockResolvedValue(undefined),
		},
		...overrides,
	};
	vi.mocked(getOpenMeterClient).mockReturnValue(client as never);
	vi.mocked(requireOpenMeterClient).mockReturnValue(client as never);
	return client;
}

describe('PlanApi（OpenMeter 承载）', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('getPlansByFilter：key→lookup_key、active/draft→published、archived→archived、分页换算', async () => {
		const client = mockClient();
		const res = await PlanApi.getPlansByFilter({ limit: 10, offset: 0, filters: [], sort: [] });
		expect(client.plans.list).toHaveBeenCalledWith({ pageSize: 10, page: 1 });
		expect(res.items).toHaveLength(2);
		expect(res.items[0].id).toBe('01M1984JSY67Q5PYAYF47FNCXF');
		expect(res.items[0].lookup_key).toBe('drill_plan_220');
		expect(res.items[0].name).toBe('Drill Plan (issue-220)');
		expect(res.items[0].status).toBe(ENTITY_STATUS.PUBLISHED);
		expect(res.items[1].status).toBe(ENTITY_STATUS.ARCHIVED);
		expect(res.pagination).toEqual({ limit: 10, offset: 0, total: 2 });
	});

	it('getPlansByFilter：status 与 name contains 过滤在客户端执行；lookup_key 下推 OM key', async () => {
		const client = mockClient();
		const res = await PlanApi.getPlansByFilter({
			limit: 10,
			offset: 0,
			status: ENTITY_STATUS.PUBLISHED,
			filters: [{ field: 'name', operator: FilterOperator.CONTAINS, data_type: DataType.STRING, value: { string: 'drill' } }],
			sort: [],
		});
		expect(client.plans.list).toHaveBeenCalledWith({ pageSize: 10, page: 1 });
		expect(res.items).toHaveLength(1);
		expect(res.items[0].name).toBe('Drill Plan (issue-220)');

		const byKey = await PlanApi.getPlansByFilter({ limit: 10, offset: 0, lookup_key: 'drill_plan_220' });
		expect(client.plans.list).toHaveBeenLastCalledWith({ pageSize: 10, page: 1, key: ['drill_plan_220'] });
		expect(byKey.items).toHaveLength(2); // key 过滤由 OM 服务端执行，此处断言请求形状
	});

	it('getPlanById：映射正确；不存在时明确报错', async () => {
		mockClient();
		const plan = await PlanApi.getPlanById('01M1984JSY67Q5PYAYF47FNCXF');
		expect(plan.lookup_key).toBe('drill_plan_220');
		expect(plan.description).toBe('');
		expect(plan.created_at).toBe('2026-08-30T11:51:05.790633Z');

		const client = mockClient({ plans: { get: vi.fn().mockResolvedValue(undefined) } });
		await expect(PlanApi.getPlanById('missing')).rejects.toThrow(/不存在/);
		expect(client.plans.get).toHaveBeenCalledWith('missing');
	});

	it('createPlan：v2 最小结构（key/currency/billingCadence/单空 phase）；display_order 丢弃', async () => {
		const client = mockClient();
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		await PlanApi.createPlan({ name: 'New Plan', lookup_key: 'new_plan', display_order: 3 });
		expect(client.plans.create).toHaveBeenCalledWith(
			expect.objectContaining({
				name: 'New Plan',
				key: 'new_plan',
				currency: 'USD',
				billingCadence: 'P1M',
				phases: [{ key: 'new_plan_phase', name: 'Default Phase', duration: null, rateCards: [] }],
			}),
		);
		expect(warn).toHaveBeenCalledTimes(1);
		warn.mockRestore();
	});

	it('updatePlan：整对象替换语义——先取现值，未覆盖字段（billingCadence/phases）不丢', async () => {
		const client = mockClient();
		const res = await PlanApi.updatePlan('01M1984JSY67Q5PYAYF47FNCXF', { name: 'Renamed' });
		expect(client.plans.get).toHaveBeenCalledWith('01M1984JSY67Q5PYAYF47FNCXF');
		expect(client.plans.update).toHaveBeenCalledWith(
			'01M1984JSY67Q5PYAYF47FNCXF',
			expect.objectContaining({ name: 'Renamed', billingCadence: 'P1M' }),
		);
		const payload = client.plans.update.mock.calls[0][1];
		expect(payload.phases).toEqual(OM_PLAN.phases);
		expect(res.name).toBe('Renamed');
	});

	it('deletePlan：透传 OM delete', async () => {
		const client = mockClient();
		await PlanApi.deletePlan('01M1984JSY67Q5PYAYF47FNCXF');
		expect(client.plans.delete).toHaveBeenCalledWith('01M1984JSY67Q5PYAYF47FNCXF');
	});

	it('clonePlan：get + create 复制（phases 深拷贝，换 name/key）', async () => {
		const client = mockClient();
		const res = await PlanApi.clonePlan('01M1984JSY67Q5PYAYF47FNCXF', { name: 'Copy', lookup_key: 'drill_plan_copy' });
		expect(client.plans.get).toHaveBeenCalledWith('01M1984JSY67Q5PYAYF47FNCXF');
		expect(client.plans.create).toHaveBeenCalledWith(
			expect.objectContaining({
				name: 'Copy',
				key: 'drill_plan_copy',
				currency: 'USD',
				billingCadence: 'P1M',
			}),
		);
		const created = client.plans.create.mock.calls[0][0];
		expect(created.phases).toEqual(OM_PLAN.phases);
		expect(created.phases).not.toBe(OM_PLAN.phases);
		expect(created.phases[0].rateCards).not.toBe(OM_PLAN.phases[0].rateCards);
		expect(res.id).toBe('01M1984JSY67Q5PYAYF47FNCXF');
	});

	it('synchronizePlanPricesWithSubscription：活跃订阅逐个 migrate 到计划最新版本并汇总', async () => {
		const migrate = vi.fn().mockResolvedValue({});
		mockClient({
			customers: {
				list: vi.fn().mockResolvedValue({
					items: [
						{
							id: 'cust-1',
							key: 'tenant-a',
							name: 'Tenant A',
							subscriptions: [
								{ id: 'sub-1', plan: { id: '01M1984JSY67Q5PYAYF47FNCXF', key: 'drill_plan_220', version: 1 }, status: 'active' },
								{ id: 'sub-old', plan: { id: 'other-plan', key: 'other', version: 1 }, status: 'active' },
							],
						},
						{
							id: 'cust-2',
							key: 'tenant-b',
							name: 'Tenant B',
							subscriptions: [
								{ id: 'sub-2', plan: { id: '01M1984JSY67Q5PYAYF47FNCXF', key: 'drill_plan_220', version: 1 }, status: 'canceled' },
							],
						},
					],
					totalCount: 2,
					page: 1,
					pageSize: 100,
				}),
			},
			subscriptions: {
				migrate,
			},
		});
		const res = await PlanApi.synchronizePlanPricesWithSubscription('01M1984JSY67Q5PYAYF47FNCXF');
		// 只迁移该计划的 active 订阅（sub-old 计划不符、sub-2 已取消）
		expect(migrate).toHaveBeenCalledTimes(1);
		expect(migrate).toHaveBeenCalledWith('sub-1', { targetVersion: 1, timing: 'immediate' });
		expect(res.synchronization_summary.subscriptions_processed).toBe(1);
		expect(res.message).toContain('已迁移 1 个订阅');
	});

	it('synchronizePlanPricesWithSubscription：迁移失败计数不吞错', async () => {
		const migrate = vi.fn().mockRejectedValue(new Error('boom'));
		mockClient({
			customers: {
				list: vi.fn().mockResolvedValue({
					items: [
						{
							id: 'cust-1',
							key: 'tenant-a',
							name: 'Tenant A',
							subscriptions: [
								{ id: 'sub-1', plan: { id: '01M1984JSY67Q5PYAYF47FNCXF', key: 'drill_plan_220', version: 1 }, status: 'active' },
							],
						},
					],
					totalCount: 1,
					page: 1,
					pageSize: 100,
				}),
			},
			subscriptions: {
				migrate,
			},
		});
		const res = await PlanApi.synchronizePlanPricesWithSubscription('01M1984JSY67Q5PYAYF47FNCXF');
		expect(res.synchronization_summary.line_items_failed).toBe(1);
		expect(res.message).toContain('1 个失败');
	});

	it('createPlan：lookup_key 含连字符等非法字符时规范化为 OM slug（e2e-plan-x → e2e_plan_x）', async () => {
		const client = mockClient();
		await PlanApi.createPlan({
			name: 'Probe Plan',
			lookup_key: 'E2E-Plan-X',
		} as never);
		expect(client.plans.create).toHaveBeenCalledWith(expect.objectContaining({ key: 'e2e_plan_x' }));
	});

	it('后端禁用时列表优雅降级为空', async () => {
		vi.mocked(getOpenMeterClient).mockReturnValue(null);
		const res = await PlanApi.getPlansByFilter({ limit: 10, offset: 0 });
		expect(res.items).toEqual([]);
		expect(res.pagination.total).toBe(0);
	});
});
