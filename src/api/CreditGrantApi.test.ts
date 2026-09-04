import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@/core/services/openmeter', () => ({
	getOpenMeterClient: vi.fn(),
	requireOpenMeterClient: vi.fn(),
}));

import { getOpenMeterClient, requireOpenMeterClient } from '@/core/services/openmeter';
import CreditGrantApi from '@/api/CreditGrantApi';
import type { OmGrantV2 } from '@/core/services/openmeter/mappers/creditGrant';
import { CREDIT_GRANT_CADENCE, CREDIT_GRANT_SCOPE } from '@/models';

const OM_GRANT: OmGrantV2 = {
	id: 'grant-01',
	amount: 100,
	priority: 1,
	effectiveAt: '2026-08-30T11:48:50.562497Z',
	expiration: { duration: 'YEAR', count: 100 },
	expiresAt: '2126-09-04T10:40:58.993978Z',
	metadata: {
		'flexprice.name': 'Signup bonus',
		'flexprice.scope': 'SUBSCRIPTION',
		'flexprice.subscription_id': 'sub-01',
		promo: 'summer',
	},
	createdAt: '2026-08-30T11:48:50.562498Z',
	updatedAt: '2026-08-30T11:48:50.562498Z',
} as unknown as OmGrantV2;

const OM_SUBSCRIPTION = {
	id: 'sub-01',
	name: 'Drill subscription',
	status: 'active',
	customerId: 'cust-01',
	plan: { id: 'plan-01', key: 'drill_plan_220', version: 1 },
	currency: 'USD',
	billingCadence: 'P1M',
	createdAt: '2026-08-30T11:51:18.104009Z',
	updatedAt: '2026-08-30T11:51:18.104010Z',
};

const OM_METERED_ENTITLEMENT = {
	type: 'metered',
	id: 'ent-01',
	customerId: 'cust-01',
	customerKey: 'tenant-a',
	featureId: 'feat-01',
	featureKey: 'platform_credits',
	issue: { amount: 0 },
	createdAt: '2026-08-30T11:48:50.216029Z',
	updatedAt: '2026-08-30T11:48:50.216029Z',
};

function mockClient(overrides: Record<string, unknown> = {}) {
	const client = {
		subscriptions: {
			get: vi.fn().mockResolvedValue(OM_SUBSCRIPTION),
		},
		entitlements: {
			get: vi.fn(),
			list: vi.fn().mockResolvedValue({ items: [OM_METERED_ENTITLEMENT], totalCount: 1, page: 1, pageSize: 100 }),
			grants: {
				list: vi.fn().mockResolvedValue({ items: [OM_GRANT], totalCount: 1, page: 1, pageSize: 100 }),
			},
		},
		entitlementsV1: {
			grants: {
				void: vi.fn().mockResolvedValue(undefined),
			},
		},
		customers: {
			entitlements: {
				createGrant: vi.fn().mockResolvedValue(OM_GRANT),
			},
		},
		...overrides,
	};
	vi.mocked(getOpenMeterClient).mockReturnValue(client as never);
	vi.mocked(requireOpenMeterClient).mockReturnValue(client as never);
	return client;
}

describe('CreditGrantApi（OpenMeter 承载，最弱映射域）', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('list：grant → CreditGrant，flexprice.* 保留键还原 scope/subscription_id，用户 metadata 剥离保留键', async () => {
		const client = mockClient();
		const res = await CreditGrantApi.list({});
		expect(client.entitlements.grants.list).toHaveBeenCalledWith({ query: { pageSize: 100, page: 1 } });
		expect(res.items).toHaveLength(1);
		const grant = res.items[0];
		expect(grant.name).toBe('Signup bonus');
		expect(grant.credits).toBe(100);
		expect(grant.cadence).toBe(CREDIT_GRANT_CADENCE.ONETIME);
		expect(grant.scope).toBe(CREDIT_GRANT_SCOPE.SUBSCRIPTION);
		expect(grant.subscription_id).toBe('sub-01');
		expect(grant.priority).toBe(1);
		expect(grant.start_date).toBe('2026-08-30T11:48:50.562497Z');
		expect(grant.metadata).toEqual({ promo: 'summer' });
		expect(grant.status).toBe('published');
	});

	it('list：scope/plan_ids 过滤走保留键，目录级过滤无匹配时为空（不猜）', async () => {
		mockClient();
		const planScoped = await CreditGrantApi.list({ scope: CREDIT_GRANT_SCOPE.PLAN, plan_ids: ['plan-01'] });
		expect(planScoped.items).toHaveLength(0);
		const subScoped = await CreditGrantApi.list({ scope: CREDIT_GRANT_SCOPE.SUBSCRIPTION, subscription_ids: ['sub-01'] });
		expect(subScoped.items).toHaveLength(1);
	});

	it('create（SUBSCRIPTION）：订阅 → 客户唯一 metered entitlement 上建 grant，保留键随行', async () => {
		const client = mockClient();
		const res = await CreditGrantApi.create({
			name: 'Top-up',
			scope: CREDIT_GRANT_SCOPE.SUBSCRIPTION,
			subscription_id: 'sub-01',
			credits: 250,
			cadence: CREDIT_GRANT_CADENCE.ONETIME,
			priority: 5,
		});
		expect(client.entitlements.list).toHaveBeenCalledWith({
			query: { customerIds: ['cust-01'], entitlementType: ['metered'], pageSize: 100 },
		});
		expect(client.customers.entitlements.createGrant).toHaveBeenCalledWith(
			'cust-01',
			'ent-01',
			expect.objectContaining({ amount: 250, priority: 5 }),
		);
		const grantBody = vi.mocked(client.customers.entitlements.createGrant).mock.calls[0][2];
		expect(grantBody.metadata).toEqual(
			expect.objectContaining({ 'flexprice.name': 'Top-up', 'flexprice.scope': 'SUBSCRIPTION', 'flexprice.subscription_id': 'sub-01' }),
		);
		expect(res.credits).toBe(100);
	});

	it('create：多个 metered entitlement 归属歧义 → 明确报错', async () => {
		mockClient({
			entitlements: {
				get: vi.fn(),
				list: vi.fn().mockResolvedValue({
					items: [OM_METERED_ENTITLEMENT, { ...OM_METERED_ENTITLEMENT, id: 'ent-02', featureKey: 'api_calls' }],
					totalCount: 2,
					page: 1,
					pageSize: 100,
				}),
				grants: { list: vi.fn() },
			},
		});
		await expect(
			CreditGrantApi.create({
				name: 'X',
				scope: CREDIT_GRANT_SCOPE.SUBSCRIPTION,
				subscription_id: 'sub-01',
				credits: 1,
				cadence: CREDIT_GRANT_CADENCE.ONETIME,
			}),
		).rejects.toThrow(/歧义/);
	});

	it('create（PLAN/ADDON 目录级）：无 OM 通路 → 明确报错', async () => {
		mockClient();
		await expect(
			CreditGrantApi.create({
				name: 'Plan grant',
				scope: CREDIT_GRANT_SCOPE.PLAN,
				plan_id: 'plan-01',
				credits: 100,
				cadence: CREDIT_GRANT_CADENCE.ONETIME,
			}),
		).rejects.toThrow(/subscription_id|OpenMeter/);
	});

	it('get：按 id 在 OM grants 中查找', async () => {
		mockClient();
		const grant = await CreditGrantApi.get('grant-01');
		expect(grant.id).toBe('grant-01');
		await expect(CreditGrantApi.get('missing')).rejects.toThrow(/不存在/);
	});

	it('delete：无 effective_date 时 void 生效；带 effective_date 如实报错', async () => {
		const client = mockClient();
		await CreditGrantApi.delete('grant-01');
		expect(client.entitlementsV1.grants.void).toHaveBeenCalledWith('grant-01');
		await expect(CreditGrantApi.delete('grant-01', { effective_date: '2099-01-01T00:00:00Z' })).rejects.toThrow(/effective_date/);
	});

	it('update/cancelFuture：无 OM 通路 → 明确报错（禁止假成功）', async () => {
		mockClient();
		await expect(CreditGrantApi.update('grant-01', { name: 'renamed' })).rejects.toThrow(/不支持修改/);
		await expect(CreditGrantApi.cancelFuture({ subscription_id: 'sub-01' })).rejects.toThrow(/cancel future|OpenMeter/);
	});

	it('后端禁用时 list 优雅降级为空', async () => {
		vi.mocked(getOpenMeterClient).mockReturnValue(null);
		const res = await CreditGrantApi.list({});
		expect(res.items).toEqual([]);
	});
});
