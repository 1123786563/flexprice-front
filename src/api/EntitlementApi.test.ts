import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@/core/services/openmeter', () => ({
	getOpenMeterClient: vi.fn(),
	requireOpenMeterClient: vi.fn(),
}));

import { getOpenMeterClient, requireOpenMeterClient } from '@/core/services/openmeter';
import EntitlementApi from '@/api/EntitlementApi';
import type { OmEntitlementV2, OmPlan } from '@/core/services/openmeter/mappers/entitlement';
import { ENTITLEMENT_ENTITY_TYPE, ENTITLEMENT_USAGE_RESET_PERIOD, FEATURE_TYPE } from '@/models';
import { DataType } from '@/types/common/QueryBuilder';

const OM_PLAN: OmPlan = {
	id: 'plan-01',
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
				{
					type: 'usage_based',
					key: 'flexprice-entitlement-platform_credits',
					name: 'Platform Credits (drill)',
					featureKey: 'platform_credits',
					billingCadence: null,
					price: null,
					entitlementTemplate: { type: 'metered', issueAfterReset: 1000, isSoftLimit: false, usagePeriod: 'P1M' },
				},
			],
		},
	],
} as unknown as OmPlan;

const OM_SUBSCRIPTION = {
	id: 'sub-01',
	name: 'Drill subscription',
	status: 'active',
	customerId: 'cust-01',
	plan: { id: 'plan-01', key: 'drill_plan_220', version: 1 },
	currency: 'USD',
	billingCadence: 'P1M',
	billingAnchor: '2026-08-30T11:51:18.095986Z',
	activeFrom: '2026-08-30T11:51:18.095986Z',
	createdAt: '2026-08-30T11:51:18.104009Z',
	updatedAt: '2026-08-30T11:51:18.104010Z',
};

const OM_ENTITLEMENT_V2 = {
	type: 'metered',
	id: 'ent-01',
	customerId: 'cust-01',
	customerKey: 'tenant-a',
	featureId: 'feat-01',
	featureKey: 'platform_credits',
	isSoftLimit: false,
	issue: { amount: 100 },
	issueAfterReset: 100,
	usagePeriod: { interval: 'MONTH', anchor: '2026-08-30T11:48:00Z' },
	activeFrom: '2026-08-30T11:48:50.20324Z',
	createdAt: '2026-08-30T11:48:50.216029Z',
	updatedAt: '2026-08-30T11:48:50.216029Z',
} as unknown as OmEntitlementV2;

const OM_FEATURES = [
	{
		id: 'feat-01',
		key: 'platform_credits',
		name: 'Platform Credits (drill)',
		meterSlug: 'platform_credits_consumed',
		createdAt: '2026-08-30T11:48:49.851474Z',
		updatedAt: '2026-08-30T11:48:49.851474Z',
	},
];

function mockClient(overrides: Record<string, unknown> = {}) {
	const client = {
		features: {
			get: vi.fn().mockResolvedValue(OM_FEATURES[0]),
			list: vi.fn().mockResolvedValue(OM_FEATURES),
			create: vi.fn(),
			delete: vi.fn(),
		},
		plans: {
			get: vi.fn().mockResolvedValue(OM_PLAN),
			list: vi.fn().mockResolvedValue({ items: [OM_PLAN], totalCount: 1, page: 1, pageSize: 100 }),
			update: vi.fn().mockResolvedValue(OM_PLAN),
		},
		addons: {
			get: vi.fn(),
			list: vi.fn().mockResolvedValue({ items: [], totalCount: 0, page: 1, pageSize: 100 }),
			update: vi.fn(),
		},
		subscriptions: {
			get: vi.fn().mockResolvedValue(OM_SUBSCRIPTION),
		},
		entitlements: {
			get: vi.fn().mockResolvedValue(OM_ENTITLEMENT_V2),
			list: vi.fn(),
			grants: { list: vi.fn() },
		},
		entitlementsV1: {
			override: vi.fn(),
			grants: { void: vi.fn() },
		},
		customers: {
			entitlements: {
				list: vi.fn().mockResolvedValue({ items: [OM_ENTITLEMENT_V2], totalCount: 1, page: 1, pageSize: 100 }),
				create: vi.fn().mockResolvedValue(OM_ENTITLEMENT_V2),
				delete: vi.fn().mockResolvedValue(undefined),
			},
		},
		...overrides,
	};
	vi.mocked(getOpenMeterClient).mockReturnValue(client as never);
	vi.mocked(requireOpenMeterClient).mockReturnValue(client as never);
	return client;
}

describe('EntitlementApi（OpenMeter 承载，目录/实例双通路）', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('search（PLAN）：plan rateCard entitlementTemplate 合成目录 entitlement', async () => {
		const client = mockClient();
		const res = await EntitlementApi.search({
			entity_type: ENTITLEMENT_ENTITY_TYPE.PLAN,
			entity_ids: ['plan-01'],
		});
		expect(client.plans.get).toHaveBeenCalledWith('plan-01');
		expect(res.items).toHaveLength(1);
		const ent = res.items[0];
		expect(ent.entity_type).toBe(ENTITLEMENT_ENTITY_TYPE.PLAN);
		expect(ent.entity_id).toBe('plan-01');
		expect(ent.id).toBe('plan:plan-01:platform_credits');
		expect(ent.feature_type).toBe('metered');
		expect(ent.usage_limit).toBe(1000);
		expect(ent.usage_reset_period).toBe(ENTITLEMENT_USAGE_RESET_PERIOD.MONTHLY);
		expect(ent.is_soft_limit).toBe(false);
		expect(ent.feature.name).toBe('Platform Credits (drill)');
		expect(ent.feature_id).toBe('feat-01');
	});

	it('search（PLAN，TypedBackendFilter 形式）：filters 里的 entity_type/entity_id 同样生效', async () => {
		const client = mockClient();
		const res = await EntitlementApi.search({
			limit: 100,
			filters: [
				{ field: 'entity_type', operator: 'eq' as never, data_type: DataType.STRING, value: { string: 'PLAN' } },
				{ field: 'entity_id', operator: 'eq' as never, data_type: DataType.STRING, value: { string: 'plan-01' } },
			],
			sort: [],
		});
		expect(client.plans.get).toHaveBeenCalledWith('plan-01');
		expect(res.items).toHaveLength(1);
	});

	it('search（SUBSCRIPTION）：订阅 → 客户实例 entitlement 映射', async () => {
		const client = mockClient();
		const res = await EntitlementApi.search({
			entity_type: ENTITLEMENT_ENTITY_TYPE.SUBSCRIPTION,
			entity_ids: ['sub-01'],
		});
		expect(client.subscriptions.get).toHaveBeenCalledWith('sub-01');
		expect(client.customers.entitlements.list).toHaveBeenCalledWith('cust-01', { query: { pageSize: 100 } });
		expect(res.items).toHaveLength(1);
		const ent = res.items[0];
		expect(ent.id).toBe('ent-01');
		expect(ent.entity_id).toBe('sub-01');
		expect(ent.usage_limit).toBe(100);
		expect(ent.usage_reset_period).toBe(ENTITLEMENT_USAGE_RESET_PERIOD.MONTHLY);
	});

	it('search：无法判定 entity_type → 空列表（不猜）', async () => {
		mockClient();
		const res = await EntitlementApi.search({ limit: 100 });
		expect(res.items).toEqual([]);
	});

	it('search：feature_ids 过滤（id ↔ key 双向匹配）', async () => {
		mockClient();
		const res = await EntitlementApi.search({
			entity_type: ENTITLEMENT_ENTITY_TYPE.PLAN,
			entity_ids: ['plan-01'],
			feature_ids: ['platform_credits'],
		});
		expect(res.items).toHaveLength(1);
		const miss = await EntitlementApi.search({
			entity_type: ENTITLEMENT_ENTITY_TYPE.PLAN,
			entity_ids: ['plan-01'],
			feature_ids: ['other-feature'],
		});
		expect(miss.items).toHaveLength(0);
	});

	it('create（PLAN）：rate card 手术——已有 feature 卡则改写模板，价格卡不动', async () => {
		const client = mockClient();
		const res = await EntitlementApi.create({
			entity_type: ENTITLEMENT_ENTITY_TYPE.PLAN,
			entity_id: 'plan-01',
			feature_id: 'feat-01',
			feature_type: FEATURE_TYPE.METERED,
			is_enabled: true,
			usage_limit: 5000,
			usage_reset_period: ENTITLEMENT_USAGE_RESET_PERIOD.ANNUAL,
			is_soft_limit: true,
		});
		expect(client.plans.update).toHaveBeenCalledTimes(1);
		const [, body] = vi.mocked(client.plans.update).mock.calls[0];
		const phase = body.phases[0];
		expect(phase.rateCards).toHaveLength(2);
		const card = phase.rateCards.find((c: { featureKey?: string }) => 'featureKey' in c && c.featureKey === 'platform_credits');
		expect(card?.entitlementTemplate).toEqual({ type: 'metered', issueAfterReset: 5000, isSoftLimit: true, usagePeriod: 'P1Y' });
		// 价格卡原样保留
		const priceCard = phase.rateCards.find((c: { key?: string }) => c.key === 'drill_flat');
		expect(priceCard?.entitlementTemplate).toBeUndefined();
		expect(res.id).toBe('plan:plan-01:platform_credits');
	});

	it('create（SUBSCRIPTION）：挂客户 entitlement，metered 周期映射', async () => {
		const client = mockClient();
		const res = await EntitlementApi.create({
			entity_type: ENTITLEMENT_ENTITY_TYPE.SUBSCRIPTION,
			entity_id: 'sub-01',
			feature_id: 'feat-01',
			feature_type: FEATURE_TYPE.METERED,
			is_enabled: true,
			usage_limit: 100,
			usage_reset_period: ENTITLEMENT_USAGE_RESET_PERIOD.MONTHLY,
		});
		expect(client.customers.entitlements.create).toHaveBeenCalledWith(
			'cust-01',
			expect.objectContaining({ featureKey: 'platform_credits', type: 'metered', usagePeriod: { interval: 'P1M' }, issueAfterReset: 100 }),
		);
		expect(res.entity_id).toBe('sub-01');
	});

	it('createBulk：逐条透传并汇总', async () => {
		const client = mockClient();
		const res = await EntitlementApi.createBulk({
			items: [
				{
					entity_type: ENTITLEMENT_ENTITY_TYPE.PLAN,
					entity_id: 'plan-01',
					feature_id: 'feat-01',
					feature_type: FEATURE_TYPE.METERED,
					is_enabled: true,
					usage_limit: 1,
				},
				{
					entity_type: ENTITLEMENT_ENTITY_TYPE.PLAN,
					entity_id: 'plan-01',
					feature_id: 'feat-01',
					feature_type: FEATURE_TYPE.METERED,
					is_enabled: true,
					usage_limit: 2,
				},
			],
		});
		expect(client.plans.update).toHaveBeenCalledTimes(2);
		expect(res.items).toHaveLength(2);
	});

	it('delete（目录合成 id）：纯 entitlement 卡整卡移除，价格卡只摘模板', async () => {
		const client = mockClient({
			plans: {
				get: vi.fn().mockResolvedValue(OM_PLAN),
				list: vi.fn(),
				update: vi.fn().mockResolvedValue(OM_PLAN),
			},
		});
		await EntitlementApi.delete('plan:plan-01:platform_credits');
		const [, body] = vi.mocked(client.plans.update).mock.calls[0];
		const cards = body.phases[0].rateCards;
		expect(cards.find((c: { key?: string }) => c.key === 'flexprice-entitlement-platform_credits')).toBeUndefined();
		expect(cards.find((c: { key?: string }) => c.key === 'drill_flat')).toBeDefined();
	});

	it('delete（实例 id）：先查归属客户再走 customer entitlement 删除', async () => {
		const client = mockClient();
		await EntitlementApi.delete('ent-01');
		expect(client.entitlements.get).toHaveBeenCalledWith('ent-01');
		expect(client.customers.entitlements.delete).toHaveBeenCalledWith('tenant-a', 'ent-01');
	});

	it('update（实例 id）：OM 不可改 → override 通路', async () => {
		const client = mockClient({
			entitlementsV1: {
				override: vi.fn().mockResolvedValue({ ...OM_ENTITLEMENT_V2, subjectKey: 'tenant-a' }),
				grants: { void: vi.fn() },
			},
		});
		const res = await EntitlementApi.update('ent-01', { usage_limit: 999 });
		expect(client.entitlementsV1.override).toHaveBeenCalledWith(
			'tenant-a',
			'ent-01',
			expect.objectContaining({ type: 'metered', issueAfterReset: 999 }),
		);
		expect(res.usage_limit).toBe(100);
	});

	it('后端禁用时 search 优雅降级为空', async () => {
		vi.mocked(getOpenMeterClient).mockReturnValue(null);
		const res = await EntitlementApi.search({ entity_type: ENTITLEMENT_ENTITY_TYPE.PLAN, entity_ids: ['plan-01'] });
		expect(res.items).toEqual([]);
	});
});
