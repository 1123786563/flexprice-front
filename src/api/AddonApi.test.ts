import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@/core/services/openmeter', () => ({
	getOpenMeterClient: vi.fn(),
	requireOpenMeterClient: vi.fn(),
}));

import { getOpenMeterClient, requireOpenMeterClient } from '@/core/services/openmeter';
import AddonApi from '@/api/AddonApi';
import type { OmAddon } from '@/core/services/openmeter/mappers/addon';

const OM_ADDON: OmAddon = {
	id: 'addon-01',
	key: 'support_addon',
	name: 'Priority Support',
	description: '24/7 support',
	status: 'active',
	instanceType: 'single',
	currency: 'USD',
	version: 1,
	metadata: { tier: 'gold' },
	createdAt: '2026-08-30T11:48:49.851474Z',
	updatedAt: '2026-08-30T11:48:49.851474Z',
	rateCards: [
		{
			type: 'flat_fee',
			key: 'support_fee',
			name: 'Support Fee',
			featureKey: 'support',
			billingCadence: 'P1M',
			price: { type: 'flat', amount: '50', paymentTerm: 'in_arrears' },
			entitlementTemplate: { type: 'boolean' },
		},
		{
			type: 'flat_fee',
			key: 'flexprice-entitlement-seats',
			name: 'Seats',
			featureKey: 'seats',
			billingCadence: null,
			price: null,
			entitlementTemplate: { type: 'static', config: '{"value":"10"}' },
		},
	],
} as unknown as OmAddon;

const OM_FEATURES = [
	{
		id: 'feat-support',
		key: 'support',
		name: 'Support',
		createdAt: '2026-08-30T11:48:49.851474Z',
		updatedAt: '2026-08-30T11:48:49.851474Z',
	},
	{ id: 'feat-seats', key: 'seats', name: 'Seats', createdAt: '2026-08-30T11:48:49.851474Z', updatedAt: '2026-08-30T11:48:49.851474Z' },
];

function mockClient(overrides: Record<string, unknown> = {}) {
	const client = {
		addons: {
			get: vi.fn().mockResolvedValue(OM_ADDON),
			list: vi.fn().mockResolvedValue({ items: [OM_ADDON], totalCount: 1, page: 1, pageSize: 100 }),
			create: vi.fn().mockResolvedValue(OM_ADDON),
			update: vi.fn().mockResolvedValue(OM_ADDON),
			delete: vi.fn().mockResolvedValue(undefined),
		},
		features: {
			list: vi.fn().mockResolvedValue(OM_FEATURES),
			get: vi.fn(),
			create: vi.fn(),
			delete: vi.fn(),
		},
		...overrides,
	};
	vi.mocked(getOpenMeterClient).mockReturnValue(client as never);
	vi.mocked(requireOpenMeterClient).mockReturnValue(client as never);
	return client;
}

describe('AddonApi（OpenMeter 承载）', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('List：OM 分页 → 双层 pagination，rateCards 合成 prices/entitlements，feature 档案解析', async () => {
		const client = mockClient();
		const res = await AddonApi.List({ limit: 10, offset: 0 });
		expect(client.addons.list).toHaveBeenCalledWith({ pageSize: 10, page: 1 });
		expect(res.pagination).toEqual({ limit: 10, offset: 0, total: 1 });
		expect(res.limit).toBe(10);
		expect(res.total).toBe(1);
		expect(res.items).toHaveLength(1);
		const addon = res.items[0];
		expect(addon.lookup_key).toBe('support_addon');
		expect(addon.status).toBe('published');
		expect(addon.metadata).toEqual({ tier: 'gold' });
		// 带价格的卡 → price；带 entitlementTemplate 的卡 → entitlement
		expect(addon.prices).toHaveLength(1);
		expect(addon.prices[0].amount).toBe('50');
		expect(addon.prices[0].invoice_cadence).toBe('ARREAR');
		expect(addon.entitlements).toHaveLength(2);
		const seats = addon.entitlements.find((e) => e.feature.lookup_key === 'seats');
		expect(seats?.static_value).toBe('10');
		expect(seats?.id).toBe('addon:addon-01:seats');
		const support = addon.entitlements.find((e) => e.feature.lookup_key === 'support');
		expect(support?.feature_type).toBe('boolean');
		expect(support?.is_enabled).toBe(true);
	});

	it('GetByLookupKey：key 过滤，缺失时明确报错', async () => {
		const client = mockClient();
		const addon = await AddonApi.GetByLookupKey('support_addon');
		expect(client.addons.list).toHaveBeenCalledWith({ key: ['support_addon'] });
		expect(addon.id).toBe('addon-01');
	});

	it('Create：name/lookup_key → key，OM 必填项取 single/USD/空卡缺省', async () => {
		const client = mockClient();
		const addon = await AddonApi.Create({ name: 'Priority Support', lookup_key: 'support_addon', description: '24/7 support' });
		expect(client.addons.create).toHaveBeenCalledWith(
			expect.objectContaining({
				name: 'Priority Support',
				key: 'support_addon',
				description: '24/7 support',
				instanceType: 'single',
				currency: 'USD',
				rateCards: [],
			}),
		);
		expect(addon.id).toBe('addon-01');
	});

	it('Update：替换语义下未覆盖字段取现值，rateCards 原样保留', async () => {
		const client = mockClient();
		await AddonApi.Update('addon-01', { name: 'Renamed' });
		expect(client.addons.get).toHaveBeenCalledWith('addon-01');
		expect(client.addons.update).toHaveBeenCalledWith(
			'addon-01',
			expect.objectContaining({ name: 'Renamed', description: '24/7 support', instanceType: 'single', rateCards: OM_ADDON.rateCards }),
		);
	});

	it('Delete：透传 OM delete', async () => {
		const client = mockClient();
		await AddonApi.Delete('addon-01');
		expect(client.addons.delete).toHaveBeenCalledWith('addon-01');
	});

	it('GetEntitlements：addon rateCards 的 entitlement 卡片合成列表', async () => {
		mockClient();
		const res = await AddonApi.GetEntitlements('addon-01');
		expect(res.items).toHaveLength(2);
		expect(res.pagination.total).toBe(2);
		expect(res.items.every((e) => e.entity_type === 'ADDON' && e.entity_id === 'addon-01')).toBe(true);
	});

	it('archived addon 状态映射为 ARCHIVED', async () => {
		const archived = { ...OM_ADDON, status: 'archived' } as OmAddon;
		mockClient({ addons: { get: vi.fn().mockResolvedValue(archived), list: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() } });
		const addon = await AddonApi.Get('addon-01');
		expect(addon.status).toBe('archived');
	});

	it('后端禁用时列表优雅降级为空', async () => {
		vi.mocked(getOpenMeterClient).mockReturnValue(null);
		const res = await AddonApi.List();
		expect(res.items).toEqual([]);
	});
});
