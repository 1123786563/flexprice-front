// src/api/EventsApi.ts
// OpenMeter 承载：事件列表走 /api/v2/events（filter JSON + 游标分页，iter_last_key↔nextCursor）、
// 按表用量走 meters.queryPost、事件补发走 events.ingest（CloudEvents）。
// OM 无对应能力（归属调试链/监控滞后/分析聚合/HF 计费）返回空态结构。
import {
	GetEventDebugResponse,
	GetEventsPayload,
	GetEventsRequest,
	GetEventsResponse,
	GetUsageByMeterPayload,
	GetUsageByMeterResponse,
	FireEventsPayload,
	GetUsageAnalyticsRequest,
	GetUsageAnalyticsResponse,
	GetMonitoringDataRequest,
	GetMonitoringDataResponse,
	GetUsageRequest,
	GetUsageResponse,
	GetHuggingFaceBillingDataRequest,
	GetHuggingFaceBillingDataResponse,
} from '@/types/dto';
import { getOpenMeterClient, requireOpenMeterClient, resolveUsageSubject } from '@/core/services/openmeter';
import type { MeterQueryResult } from '@/core/services/openmeter';
import { buildEventsV2Query, toFlexpriceEventsPage, toFlexpriceEventDebug } from '@/core/services/openmeter/mappers/event';
import { buildOmMeterQueryBody, toUsageByMeterResponse } from '@/core/services/openmeter/mappers/meter';

class EventsApi {
	private static async listEvents(query: {
		external_customer_id?: string;
		event_name?: string;
		event_id?: string;
		start_time?: string;
		end_time?: string;
		iter_last_key?: string;
		page_size?: number;
		source?: string;
		property_filters?: string | Record<string, string[]>;
	}): Promise<GetEventsResponse> {
		const client = getOpenMeterClient();
		if (!client) return { events: [], has_more: false };
		const page = await client.events.listV2(buildEventsV2Query(query));
		return toFlexpriceEventsPage(page ?? { items: [] }, query.property_filters);
	}

	public static async getRawEvents(payload: GetEventsPayload): Promise<GetEventsResponse> {
		return await this.listEvents(payload);
	}

	/**
	 * Event debugger response for a single event
	 * OM 侧按事件 id 精确取落库原样事件；归属调试链（customer/meter/price/line-item）
	 * 为 Flexprice 计费管线概念，OM 无对应，各段固定 unprocessed。
	 */
	public static async getEventDebug(eventId: string): Promise<GetEventDebugResponse> {
		const client = requireOpenMeterClient();
		const page = await client.events.listV2(buildEventsV2Query({ event_id: eventId, page_size: 1 }));
		const ingested = page?.items?.[0];
		if (!ingested) throw new Error(`事件 ${eventId} 不存在`);
		return toFlexpriceEventDebug(ingested);
	}

	/**
	 * Query events with POST request (for complex filtering)
	 * 与 getRawEvents 同一 OM v2 通路；sort/order 由 OM 固定新事件在前，offset 不支持（游标分页）。
	 */
	public static async queryEvents(payload: GetEventsRequest): Promise<GetEventsResponse> {
		return await this.listEvents(payload);
	}

	/** meter 用量查询：payload 映射 MeterQueryRequest 后走 meters.queryPost，meter 档案补全 type/event_name。 */
	public static async getUsageByMeter(payload: GetUsageByMeterPayload): Promise<GetUsageByMeterResponse> {
		const client = getOpenMeterClient();
		if (!client) return { type: '', event_name: '', results: [] };
		const meter = await client.meters.get(payload.meter_id);
		if (!meter) throw new Error(`计量表 ${payload.meter_id} 不存在`);
		const result = (await client.meters.queryPost(payload.meter_id, buildOmMeterQueryBody(payload))) as MeterQueryResult;
		return toUsageByMeterResponse(meter, result.data ?? []);
	}

	/**
	 * Get usage statistics
	 * OM 聚合由 meter 定义承载，无按事件类型的即席聚合端点；未建对应 meter 时返回空结果。
	 */
	public static async getUsage(payload: GetUsageRequest): Promise<GetUsageResponse> {
		return { results: [], value: 0, event_name: payload.event_name, type: payload.aggregation_type };
	}

	/**
	 * @deprecated Use OnboardingApi.generateEvents instead
	 * OM 承载：组装 CloudEvent 走 events.ingest；subject 优先 customer_id，缺省回退订阅客户，再回退当前用户。
	 */
	public static async fireEvents(payload: FireEventsPayload): Promise<void> {
		const client = requireOpenMeterClient();
		let subject = payload.customer_id;
		if (!subject && payload.subscription_id) {
			try {
				subject = (await client.subscriptions.get(payload.subscription_id))?.customerId;
			} catch {
				// 订阅解析失败不阻断补发，落到默认 subject
			}
		}
		await client.events.ingest({
			specversion: '1.0',
			id: crypto.randomUUID(),
			source: 'flexprice-frontend',
			type: payload.feature_id || 'usage',
			subject: subject || resolveUsageSubject(),
			time: new Date(),
			data: {
				value: payload.amount ?? 1,
				...(payload.duration !== undefined ? { duration: payload.duration } : {}),
			},
		});
	}

	/**
	 * Get usage analytics (v1/v2)
	 * Flexprice 分析管线（按 feature/price 聚合成本）OM 无对应，返回零值空态。
	 */
	public static async getUsageAnalytics(_payload: GetUsageAnalyticsRequest): Promise<GetUsageAnalyticsResponse> {
		return { total_cost: 0, currency: 'USD', items: [], custom_analytics: [] };
	}

	/** 同 getUsageAnalytics（v2 直连后端在 OM 模式下同样无对应）。 */
	public static async getUsageAnalyticsV2(_payload: GetUsageAnalyticsRequest): Promise<GetUsageAnalyticsResponse> {
		return { total_cost: 0, currency: 'USD', items: [], custom_analytics: [] };
	}

	/**
	 * Get monitoring data
	 * 消费滞后/后处理滞后为 Flexprice Kafka 管线指标，OM 无对应，返回零值空态。
	 */
	public static async getMonitoringData(_payload: GetMonitoringDataRequest): Promise<GetMonitoringDataResponse> {
		return { total_count: 0, consumption_lag: 0, post_processing_lag: 0, points: [] };
	}

	/**
	 * Get HuggingFace billing data
	 * HF 请求级计费明细为 Flexprice 专属集成，OM 无对应，返回空列表。
	 */
	public static async getHuggingFaceBillingData(_payload: GetHuggingFaceBillingDataRequest): Promise<GetHuggingFaceBillingDataResponse> {
		return { requests: [] };
	}
}

export default EventsApi;
