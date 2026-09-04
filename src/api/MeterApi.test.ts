import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@/core/services/openmeter', () => ({
	getOpenMeterClient: vi.fn(),
	requireOpenMeterClient: vi.fn(),
}));

import { getOpenMeterClient, requireOpenMeterClient } from '@/core/services/openmeter';
import type { OpenMeterMeter } from '@/core/services/openmeter';
import { MeterApi } from '@/api/MeterApi';
import { METER_AGGREGATION_TYPE, METER_USAGE_RESET_PERIOD } from '@/models';

// OM 运行时样例（SDK 类型声明为 Date，实际 JSON 反序列化为字符串）。
const OM_METER = (overrides: Partial<OpenMeterMeter> = {}): OpenMeterMeter =>
	({
		id: '01M197SSQ4D5KG7EE9RNCEMXGR',
		slug: 'agent_runs',
		name: 'agent_runs',
		description: 'Agent 逻辑执行次数',
		eventType: 'agent_runs',
		aggregation: 'SUM',
		valueProperty: '$.value',
		createdAt: '2026-08-30T11:45:12.420338Z',
		updatedAt: '2026-08-30T11:45:12.420338Z',
		...overrides,
	}) as unknown as OpenMeterMeter;

function mockClient(meters: OpenMeterMeter[] = [OM_METER()], overrides: Record<string, unknown> = {}) {
	const client = {
		meters: {
			get: vi.fn().mockImplementation(async (id: string) => meters.find((m) => m.id === id || m.slug === id)),
			list: vi.fn().mockResolvedValue(meters),
			create: vi.fn().mockResolvedValue(meters[0]),
			update: vi.fn().mockResolvedValue(meters[0]),
			delete: vi.fn().mockResolvedValue(undefined),
		},
		...overrides,
	};
	vi.mocked(getOpenMeterClient).mockReturnValue(client as never);
	vi.mocked(requireOpenMeterClient).mockReturnValue(client as never);
	return client;
}

describe('MeterApi（OpenMeter 承载）', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('createMeter：slug 派生、聚合/字段/groupBy 映射为 MeterCreate', async () => {
		const client = mockClient();
		await MeterApi.createMeter({
			name: 'API Calls Total',
			event_name: 'api_calls',
			reset_usage: METER_USAGE_RESET_PERIOD.BILLING_PERIOD,
			aggregation: { type: METER_AGGREGATION_TYPE.COUNT_UNIQUE, field: 'request_id', group_by: 'region' },
			filters: [{ key: 'env', values: ['prod'] }],
		});
		expect(client.meters.create).toHaveBeenCalledWith({
			slug: 'api_calls_total',
			name: 'API Calls Total',
			aggregation: 'UNIQUE_COUNT',
			eventType: 'api_calls',
			valueProperty: '$.request_id',
			groupBy: { region: '$.region' },
		});
	});

	it('createMeter：SUM_WITH_MULTIPLIER 退化为 SUM，无 field 不传 valueProperty，name 非法字符折叠 slug', async () => {
		const client = mockClient();
		await MeterApi.createMeter({
			name: 'Weighted 用量!',
			event_name: 'w',
			reset_usage: METER_USAGE_RESET_PERIOD.NEVER,
			aggregation: { type: METER_AGGREGATION_TYPE.WEIGHTED_SUM },
		});
		expect(client.meters.create).toHaveBeenCalledWith({
			slug: 'weighted',
			name: 'Weighted 用量!',
			aggregation: 'SUM',
			eventType: 'w',
		});
	});

	it('getMeterById/listMeters：OM meter 映射回 Flexprice Meter（UNIQUE_COUNT↔COUNT_UNIQUE、filters 恒空、reset NEVER）', async () => {
		mockClient([OM_METER({ aggregation: 'UNIQUE_COUNT', groupBy: { region: '$.region' } })]);
		const meter = await MeterApi.getMeterById('01M197SSQ4D5KG7EE9RNCEMXGR');
		expect(meter.id).toBe('01M197SSQ4D5KG7EE9RNCEMXGR');
		expect(meter.event_name).toBe('agent_runs');
		expect(meter.aggregation.type).toBe(METER_AGGREGATION_TYPE.COUNT_UNIQUE);
		expect(meter.aggregation.field).toBe('$.value');
		expect(meter.aggregation.group_by).toBe('region');
		expect(meter.filters).toEqual([]);
		expect(meter.reset_usage).toBe(METER_USAGE_RESET_PERIOD.NEVER);
		expect(meter.status).toBe('published');
		expect(meter.created_at).toBe('2026-08-30T11:45:12.420338Z');

		const list = await MeterApi.listMeters({ limit: 10, offset: 0 });
		expect(list.items).toHaveLength(1);
		expect(list.pagination).toEqual({ limit: 10, offset: 0, total: 1 });
	});

	it('getAllMeters：OM 无服务端分页，limit/offset 客户端切片', async () => {
		const many = Array.from({ length: 5 }, (_, i) => OM_METER({ id: `m-${i}`, slug: `slug-${i}` }));
		mockClient(many);
		const page = await MeterApi.getAllMeters({ limit: 2, offset: 2 });
		expect(page.items.map((m) => m.id)).toEqual(['m-2', 'm-3']);
		expect(page.pagination).toEqual({ limit: 2, offset: 2, total: 5 });
	});

	it('getAllActiveMeters：OM 无 status，全部视为活跃', async () => {
		mockClient([OM_METER(), OM_METER({ id: 'm-2' })]);
		const res = await MeterApi.getAllActiveMeters();
		expect(res.items).toHaveLength(2);
		expect(res.pagination.total).toBe(2);
	});

	it('getMeterById：不存在时抛错；deleteMeter 透传 idOrSlug', async () => {
		const client = mockClient();
		await expect(MeterApi.getMeterById('missing')).rejects.toThrow(/不存在/);
		await MeterApi.deleteMeter('agent_runs');
		expect(client.meters.delete).toHaveBeenCalledWith('agent_runs');
	});

	it('updateMeter/disableMeter：OM 无对应能力，明确报错', async () => {
		mockClient();
		await expect(MeterApi.updateMeter('m-1', { filters: [] })).rejects.toThrow(/不支持/);
		await expect(MeterApi.disableMeter('m-1')).rejects.toThrow(/不支持/);
	});

	it('后端禁用时列表优雅降级为空', async () => {
		vi.mocked(getOpenMeterClient).mockReturnValue(null);
		const res = await MeterApi.listMeters({ limit: 10, offset: 0 });
		expect(res.items).toEqual([]);
		expect(res.pagination.total).toBe(0);
	});
});
