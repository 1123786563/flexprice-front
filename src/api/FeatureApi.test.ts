import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@/core/services/openmeter', () => ({
	getOpenMeterClient: vi.fn(),
	requireOpenMeterClient: vi.fn(),
}));

import { getOpenMeterClient, requireOpenMeterClient } from '@/core/services/openmeter';
import FeatureApi from '@/api/FeatureApi';
import type { OmFeature } from '@/core/services/openmeter/mappers/feature';
import { FEATURE_TYPE, METER_AGGREGATION_TYPE, METER_USAGE_RESET_PERIOD } from '@/models';
import { DataType } from '@/types/common/QueryBuilder';

const OM_FEATURE: OmFeature = {
	id: '01M1980E1V9WREV6K3F1J8ZPEK',
	key: 'platform_credits',
	name: 'Platform Credits (drill)',
	meterSlug: 'platform_credits_consumed',
	metadata: {
		'flexprice.description': 'Credits feature',
		'flexprice.unit_singular': 'credit',
		'flexprice.unit_plural': 'credits',
		'flexprice.reporting_unit': JSON.stringify({ unit_singular: 'credit', unit_plural: 'credits', conversion_rate: '0.01' }),
		'flexprice.group_id': 'grp-1',
		tier: 'pro',
	},
	createdAt: '2026-08-30T11:48:49.851474Z',
	updatedAt: '2026-08-30T11:48:49.851474Z',
} as unknown as OmFeature;

const OM_STATIC_FEATURE: OmFeature = {
	id: 'feat-static-1',
	key: 'sso_access',
	name: 'SSO Access',
	metadata: { 'flexprice.type': 'boolean' },
	createdAt: '2026-08-30T11:48:49.851474Z',
	updatedAt: '2026-08-30T11:48:49.851474Z',
} as unknown as OmFeature;

function mockClient(overrides: Record<string, unknown> = {}) {
	const client = {
		features: {
			get: vi.fn().mockImplementation((id: string) => (id === 'feat-static-1' ? OM_STATIC_FEATURE : OM_FEATURE)),
			list: vi.fn().mockResolvedValue([OM_FEATURE, OM_STATIC_FEATURE]),
			create: vi.fn().mockResolvedValue(OM_FEATURE),
			delete: vi.fn().mockResolvedValue(undefined),
		},
		meters: {
			get: vi.fn().mockResolvedValue({
				id: 'meter-1',
				slug: 'platform_credits_consumed',
				name: 'Platform Credits Consumed',
				aggregation: 'SUM',
				eventType: 'credit_consumed',
				valueProperty: '$.credits',
				createdAt: '2026-08-30T11:48:49.851474Z',
				updatedAt: '2026-08-30T11:48:49.851474Z',
			}),
			create: vi.fn().mockResolvedValue({ id: 'meter-1', slug: 'platform_credits_consumed' }),
		},
		...overrides,
	};
	vi.mocked(getOpenMeterClient).mockReturnValue(client as never);
	vi.mocked(requireOpenMeterClient).mockReturnValue(client as never);
	return client;
}

describe('FeatureApi（OpenMeter 承载）', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('getFeatureById：key→lookup_key、meterSlug→meter_id/type、metadata 保留键还原、meter 展开', async () => {
		const client = mockClient();
		const f = await FeatureApi.getFeatureById('01M1980E1V9WREV6K3F1J8ZPEK');
		expect(client.features.get).toHaveBeenCalledWith('01M1980E1V9WREV6K3F1J8ZPEK');
		expect(client.meters.get).toHaveBeenCalledWith('platform_credits_consumed');
		expect(f.lookup_key).toBe('platform_credits');
		expect(f.meter_id).toBe('platform_credits_consumed');
		expect(f.type).toBe(FEATURE_TYPE.METERED);
		expect(f.description).toBe('Credits feature');
		expect(f.unit_singular).toBe('credit');
		expect(f.unit_plural).toBe('credits');
		expect(f.reporting_unit).toEqual({ unit_singular: 'credit', unit_plural: 'credits', conversion_rate: '0.01' });
		expect(f.group_id).toBe('grp-1');
		expect(f.metadata).toEqual({ tier: 'pro' });
		expect(f.status).toBe('published');
		expect(f.meter?.event_name).toBe('credit_consumed');
		expect(f.meter?.aggregation.type).toBe('SUM');
	});

	it('getFeatureById：无 meter 的 feature 按 metadata 保留键还原 boolean 类型', async () => {
		mockClient();
		const f = await FeatureApi.getFeatureById('feat-static-1');
		expect(f.type).toBe(FEATURE_TYPE.BOOLEAN);
		expect(f.meter_id).toBe('');
	});

	it('listFeatures：meter_ids 下推 OM、lookup_keys/name_contains 客户端过滤、pagination', async () => {
		const client = mockClient();
		const res = await FeatureApi.listFeatures({
			limit: 10,
			offset: 0,
			meter_ids: ['platform_credits_consumed'],
			name_contains: 'credits',
		});
		expect(client.features.list).toHaveBeenCalledWith({ limit: 10, offset: 0, meterSlug: ['platform_credits_consumed'] });
		expect(res.items).toHaveLength(1);
		expect(res.items[0].name).toBe('Platform Credits (drill)');
		expect(res.pagination).toEqual({ limit: 10, offset: 0, total: 1 });
	});

	it('createFeature：内嵌 meter 先建表再建 feature（两步）', async () => {
		const client = mockClient();
		await FeatureApi.createFeature({
			name: 'Tokens',
			lookup_key: 'tokens',
			type: FEATURE_TYPE.METERED,
			meter: {
				name: 'Tokens Total',
				event_name: 'prompt_tokens',
				aggregation: { type: METER_AGGREGATION_TYPE.SUM, field: 'tokens' },
				reset_usage: METER_USAGE_RESET_PERIOD.NEVER,
			},
		});
		expect(client.meters.create).toHaveBeenCalledWith(
			expect.objectContaining({ slug: 'prompt_tokens', eventType: 'prompt_tokens', aggregation: 'SUM', valueProperty: '$.tokens' }),
		);
		expect(client.features.create).toHaveBeenCalledWith(
			expect.objectContaining({ key: 'tokens', name: 'Tokens', meterSlug: 'platform_credits_consumed' }),
		);
	});

	it('createFeature：metered 无 meter 报错（禁止假成功）', async () => {
		mockClient();
		await expect(FeatureApi.createFeature({ name: 'X', type: FEATURE_TYPE.METERED })).rejects.toThrow(/meter/);
	});

	it('updateFeature：OM 无 update → delete+create 重建，保 key/meterSlug/未覆盖 metadata', async () => {
		const client = mockClient();
		const updated = await FeatureApi.updateFeature('01M1980E1V9WREV6K3F1J8ZPEK', { name: 'Renamed', unit_singular: 'pt' });
		expect(client.features.get).toHaveBeenCalledWith('01M1980E1V9WREV6K3F1J8ZPEK');
		expect(client.features.delete).toHaveBeenCalledWith('01M1980E1V9WREV6K3F1J8ZPEK');
		expect(client.features.create).toHaveBeenCalledWith(
			expect.objectContaining({
				key: 'platform_credits',
				name: 'Renamed',
				meterSlug: 'platform_credits_consumed',
			}),
		);
		const metadata = vi.mocked(client.features.create).mock.calls[0][0].metadata ?? {};
		// 未覆盖的保留键沿用现值，更新的字段生效
		expect(metadata['flexprice.description']).toBe('Credits feature');
		expect(metadata['flexprice.unit_singular']).toBe('pt');
		expect(metadata['flexprice.reporting_unit']).toContain('0.01');
		expect(updated.name).toBe('Platform Credits (drill)');
	});

	it('deleteFeature：透传 OM delete', async () => {
		const client = mockClient();
		await FeatureApi.deleteFeature('01M1980E1V9WREV6K3F1J8ZPEK');
		expect(client.features.delete).toHaveBeenCalledWith('01M1980E1V9WREV6K3F1J8ZPEK');
	});

	it('getFeaturesByFilter：TypedBackendFilter(name equals) 客户端过滤', async () => {
		mockClient();
		const res = await FeatureApi.getFeaturesByFilter({
			limit: 50,
			offset: 0,
			filters: [{ field: 'name', operator: 'eq' as never, data_type: DataType.STRING, value: { string: 'sso access' } }],
			sort: [],
		});
		expect(res.items).toHaveLength(1);
		expect(res.items[0].id).toBe('feat-static-1');
	});

	it('后端禁用时列表优雅降级为空', async () => {
		vi.mocked(getOpenMeterClient).mockReturnValue(null);
		const res = await FeatureApi.listFeatures({});
		expect(res.items).toEqual([]);
	});
});
