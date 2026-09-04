import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@/core/services/openmeter', () => ({
	getOpenMeterClient: vi.fn(),
	requireOpenMeterClient: vi.fn(),
	resolveUsageSubject: vi.fn().mockReturnValue('fallback-user'),
}));

import { getOpenMeterClient, requireOpenMeterClient, resolveUsageSubject } from '@/core/services/openmeter';
import EventsApi from '@/api/EventsApi';
import type { OmIngestedEvent, OmEventsV2Page } from '@/core/services/openmeter/mappers/event';
import type { OpenMeterMeter } from '@/core/services/openmeter';

// OM 运行时样例（SDK 类型声明为 Date，实际 JSON 反序列化为字符串，测试按运行时形状构造）。
const OM_EVENT_ITEM: OmIngestedEvent = {
	event: {
		specversion: '1.0',
		id: '65624c50-832b-4157-abf6-0625781398b3',
		source: 'http://localhost:3000',
		type: 'frontend_page_views',
		subject: 'user_01M1NAZ92JJ29AE8SCRA2DH93J',
		time: '2026-09-04T06:17:32Z',
		data: { path: '/usage-tracking/events', value: 1 },
	},
	ingestedAt: '2026-09-04T06:17:32Z',
	storedAt: '2026-09-04T06:17:33Z',
	validationError: undefined,
} as unknown as OmIngestedEvent;

const OM_METER = {
	id: '01M197SSQ4D5KG7EE9RNCEMXGR',
	slug: 'agent_runs',
	name: 'agent_runs',
	description: 'Agent 逻辑执行次数',
	eventType: 'agent_runs',
	aggregation: 'SUM',
	valueProperty: '$.value',
	createdAt: '2026-08-30T11:45:12.420338Z',
	updatedAt: '2026-08-30T11:45:12.420338Z',
} as unknown as OpenMeterMeter;

function mockClient(overrides: Record<string, unknown> = {}) {
	const client = {
		events: {
			listV2: vi.fn().mockResolvedValue({ items: [OM_EVENT_ITEM], nextCursor: 'cursor-1' } satisfies OmEventsV2Page),
			ingest: vi.fn().mockResolvedValue(undefined),
		},
		meters: {
			get: vi.fn().mockResolvedValue(OM_METER),
			queryPost: vi.fn().mockResolvedValue({
				data: [{ value: 12, windowStart: '2026-09-01T00:00:00Z', windowEnd: '2026-09-02T00:00:00Z', subject: 'tenant-a', groupBy: {} }],
			}),
		},
		subscriptions: {
			get: vi.fn().mockResolvedValue({ id: 'sub-1', customerId: 'customer-1' }),
		},
		...overrides,
	};
	vi.mocked(getOpenMeterClient).mockReturnValue(client as never);
	vi.mocked(requireOpenMeterClient).mockReturnValue(client as never);
	return client;
}

describe('EventsApi（OpenMeter 承载）', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('getRawEvents：event_name/subject/时间下推 v2 filter，游标与 limit 透传，映射回 Flexprice 事件', async () => {
		const client = mockClient();
		const res = await EventsApi.getRawEvents({
			event_name: 'frontend_page_views',
			external_customer_id: 'user_01M1NAZ92JJ29AE8SCRA2DH93J',
			start_time: '2026-09-04T00:00:00Z',
			end_time: '2026-09-04T23:59:59Z',
			iter_last_key: 'prev-cursor',
			page_size: 20,
		});
		expect(client.events.listV2).toHaveBeenCalledWith({
			limit: 20,
			cursor: 'prev-cursor',
			filter: JSON.stringify({
				type: { $eq: 'frontend_page_views' },
				subject: { $eq: 'user_01M1NAZ92JJ29AE8SCRA2DH93J' },
				from: '2026-09-04T00:00:00Z',
				to: '2026-09-04T23:59:59Z',
			}),
		});
		expect(res.has_more).toBe(true);
		expect(res.iter_last_key).toBe('cursor-1');
		expect(res.iter_first_key).toBe(OM_EVENT_ITEM.event.id);
		expect(res.events).toHaveLength(1);
		const event = res.events[0];
		expect(event.id).toBe('65624c50-832b-4157-abf6-0625781398b3');
		expect(event.event_name).toBe('frontend_page_views');
		expect(event.external_customer_id).toBe('user_01M1NAZ92JJ29AE8SCRA2DH93J');
		expect(event.timestamp).toBe('2026-09-04T06:17:32Z');
		expect(event.source).toBe('http://localhost:3000');
		expect(event.properties).toEqual({ path: '/usage-tracking/events', value: 1 });
		expect(event.idempotency_key).toBe('65624c50-832b-4157-abf6-0625781398b3');
		expect(event.status).toBe('published');
	});

	it('getRawEvents：property_filters（GET 分号串）在客户端精确过滤', async () => {
		const other = { ...OM_EVENT_ITEM, event: { ...OM_EVENT_ITEM.event, data: { path: '/other', value: 2 } } } as unknown as OmIngestedEvent;
		mockClient({ events: { listV2: vi.fn().mockResolvedValue({ items: [OM_EVENT_ITEM, other] }) } });
		const res = await EventsApi.getRawEvents({ property_filters: 'path:/usage-tracking/events;' });
		expect(res.events).toHaveLength(1);
		expect(res.events[0].properties.path).toBe('/usage-tracking/events');
		// 无 nextCursor 时 has_more 为 false，iter_last_key 回退为末条事件 id
		expect(res.has_more).toBe(false);
		expect(res.iter_last_key).toBe(OM_EVENT_ITEM.event.id);
	});

	it('queryEvents：POST 形状入参走同一通路，Record 型 property_filters 同样客户端过滤', async () => {
		mockClient({ events: { listV2: vi.fn().mockResolvedValue({ items: [OM_EVENT_ITEM] }) } });
		const res = await EventsApi.queryEvents({ event_name: 'frontend_page_views', property_filters: { path: ['/nope'] } });
		expect(res.events).toHaveLength(0);
	});

	it('getEventDebug：落库事件映射 + 归属调试链各段 unprocessed；validationError 视为 failed', async () => {
		const client = mockClient();
		const res = await EventsApi.getEventDebug('65624c50-832b-4157-abf6-0625781398b3');
		expect(client.events.listV2).toHaveBeenCalledWith({
			limit: 1,
			filter: JSON.stringify({ id: { $eq: '65624c50-832b-4157-abf6-0625781398b3' } }),
		});
		expect(res.status).toBe('processed');
		expect(res.processed_events).toEqual([]);
		expect(res.debug_tracker?.customer_lookup.status).toBe('unprocessed');
		expect(res.debug_tracker?.meter_matching.status).toBe('unprocessed');
		expect(res.event.id).toBe('65624c50-832b-4157-abf6-0625781398b3');

		mockClient({
			events: {
				listV2: vi.fn().mockResolvedValue({
					items: [{ ...OM_EVENT_ITEM, validationError: 'no customer found for event subject' } as unknown as OmIngestedEvent],
				}),
			},
		});
		const failed = await EventsApi.getEventDebug('65624c50-832b-4157-abf6-0625781398b3');
		expect(failed.status).toBe('failed');

		mockClient({ events: { listV2: vi.fn().mockResolvedValue({ items: [] }) } });
		await expect(EventsApi.getEventDebug('missing')).rejects.toThrow(/不存在/);
	});

	it('getUsageByMeter：payload 映射 MeterQueryRequest 走 queryPost，窗口起点作为 results.window_size', async () => {
		const client = mockClient();
		const res = await EventsApi.getUsageByMeter({
			meter_id: '01M197SSQ4D5KG7EE9RNCEMXGR',
			start_time: '2026-09-01T00:00:00Z',
			end_time: '2026-09-03T00:00:00Z',
			external_customer_id: 'tenant-a',
			filters: { region: ['cn'] },
			window_size: 'DAY',
		});
		expect(client.meters.get).toHaveBeenCalledWith('01M197SSQ4D5KG7EE9RNCEMXGR');
		expect(client.meters.queryPost).toHaveBeenCalledWith('01M197SSQ4D5KG7EE9RNCEMXGR', {
			from: new Date('2026-09-01T00:00:00Z'),
			to: new Date('2026-09-03T00:00:00Z'),
			subject: ['tenant-a'],
			filterGroupBy: { region: ['cn'] },
			windowSize: 'DAY',
		});
		expect(res.type).toBe('SUM');
		expect(res.event_name).toBe('agent_runs');
		expect(res.results).toEqual([{ window_size: '2026-09-01T00:00:00Z', value: 12 }]);
	});

	it('fireEvents：组装 CloudEvent 走 ingest，subject 优先 customer_id、缺省回退订阅客户', async () => {
		const client = mockClient();
		await EventsApi.fireEvents({ customer_id: 'tenant-a', feature_id: 'api_calls', amount: 3 });
		expect(client.events.ingest).toHaveBeenCalledTimes(1);
		const ev = client.events.ingest.mock.calls[0][0] as Record<string, unknown>;
		expect(ev.type).toBe('api_calls');
		expect(ev.subject).toBe('tenant-a');
		expect(ev.specversion).toBe('1.0');
		expect(ev.data).toEqual({ value: 3 });

		// 无 customer_id（DebugMenu 场景）：经订阅解析出客户
		await EventsApi.fireEvents({ subscription_id: 'sub-1', duration: 5 });
		expect(client.subscriptions.get).toHaveBeenCalledWith('sub-1');
		const ev2 = client.events.ingest.mock.calls[1][0] as Record<string, unknown>;
		expect(ev2.subject).toBe('customer-1');
		expect(ev2.type).toBe('usage');
		expect(ev2.data).toEqual({ value: 1, duration: 5 });

		// 订阅解析也失败：回退当前用户 subject
		client.subscriptions.get = vi.fn().mockRejectedValue(new Error('boom'));
		await EventsApi.fireEvents({ subscription_id: 'sub-x' });
		const ev3 = client.events.ingest.mock.calls[2][0] as Record<string, unknown>;
		expect(ev3.subject).toBe(resolveUsageSubject());
	});

	it('getUsage/getMonitoringData/getUsageAnalytics/getHuggingFaceBillingData：OM 无对应，返回空态', async () => {
		mockClient();
		await expect(EventsApi.getUsage({ event_name: 'x', aggregation_type: 'SUM' })).resolves.toEqual({
			results: [],
			value: 0,
			event_name: 'x',
			type: 'SUM',
		});
		await expect(EventsApi.getMonitoringData({})).resolves.toEqual({
			total_count: 0,
			consumption_lag: 0,
			post_processing_lag: 0,
			points: [],
		});
		for (const fn of [EventsApi.getUsageAnalytics, EventsApi.getUsageAnalyticsV2]) {
			await expect(fn({})).resolves.toEqual({ total_cost: 0, currency: 'USD', items: [], custom_analytics: [] });
		}
		await expect(EventsApi.getHuggingFaceBillingData({ requestIds: ['1'] })).resolves.toEqual({ requests: [] });
	});

	it('后端禁用时列表优雅降级为空', async () => {
		vi.mocked(getOpenMeterClient).mockReturnValue(null);
		const res = await EventsApi.getRawEvents({ page_size: 10 });
		expect(res.events).toEqual([]);
		expect(res.has_more).toBe(false);
		await expect(EventsApi.getUsageByMeter({ meter_id: 'm' })).resolves.toEqual({ type: '', event_name: '', results: [] });
	});
});
