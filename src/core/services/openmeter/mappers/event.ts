// src/core/services/openmeter/mappers/event.ts
// OM IngestedEvent ↔ Flexprice Event 双向映射 + 事件列表查询构造。
// 事实源：GET /api/v2/events（filter 为 JSON 字符串，字段 {id,type,source,subject,from,to}，
// 字符串字段用 {"$eq": ...} 形态；cursor/limit 游标分页，实测可用；v1 /api/v1/events 无游标且
// 本机实测易超时，故事件列表统一走 v2）。
import type { OpenMeterClient } from '@/core/services/openmeter';
import { ENTITY_STATUS } from '@/models';
import type { Event } from '@/models';
import type { GetEventsResponse, GetEventDebugResponse, EventDebugTracker } from '@/types/dto/Events';
import { iso } from './common';

export type OmIngestedEvent = NonNullable<Awaited<ReturnType<OpenMeterClient['events']['list']>>>[number];
export type OmEvent = OmIngestedEvent['event'];
export type OmEventsV2Page = NonNullable<Awaited<ReturnType<OpenMeterClient['events']['listV2']>>>;
export type OmEventsV2Query = NonNullable<Parameters<OpenMeterClient['events']['listV2']>[0]>;

/** OM v2 filter 中的事件时间字段：start/end 为 RFC 3339 字符串，其余为 {"$eq": ...}。 */
interface EventsV2Filter {
	id?: { $eq: string };
	type?: { $eq: string };
	source?: { $eq: string };
	subject?: { $eq: string };
	from?: string;
	to?: string;
}

/** Flexprice 事件列表入参的公共子集（GetEventsPayload 与 GetEventsRequest 共有字段）。 */
export interface FlexpriceEventsQuery {
	external_customer_id?: string;
	event_name?: string;
	event_id?: string;
	start_time?: string;
	end_time?: string;
	iter_last_key?: string;
	page_size?: number;
	source?: string;
	/** GET 侧为 "k:v;k:v;" 字符串，POST 侧为 Record；统一在客户端按事件属性精确匹配。 */
	property_filters?: string | Record<string, string[]>;
}

/** OM 已摄取事件 → Flexprice Event。customer_id 取 OM 归属解析结果，external_customer_id 即 subject。 */
export function mapOmIngestedEvent(ingested: OmIngestedEvent): Event {
	const ev = ingested.event;
	return {
		id: ev.id ?? '',
		timestamp: iso(ev.time ?? ingested.ingestedAt),
		customer_id: ingested.customerId ?? '',
		event_name: ev.type,
		external_customer_id: ev.subject ?? '',
		// CloudEvents id 即 OM 去重键，对应 Flexprice 幂等键语义。
		idempotency_key: ev.id,
		properties: (ev.data as Record<string, unknown> | null) ?? {},
		source: ev.source ?? '',
		created_at: iso(ingested.ingestedAt),
		updated_at: iso(ingested.storedAt),
		created_by: '',
		updated_by: '',
		tenant_id: '',
		status: ENTITY_STATUS.PUBLISHED,
		environment_id: '',
	};
}

/**
 * Flexprice 事件查询 → OM listV2 查询。
 * event_name/external_customer_id/event_id/source 全部下推 v2 filter（$eq 精确匹配）；
 * property_filters OM filter 不支持事件 data 字段，由调用方在返回集上客户端过滤。
 */
export function buildEventsV2Query(query: FlexpriceEventsQuery): OmEventsV2Query {
	const filter: EventsV2Filter = {};
	if (query.event_id) filter.id = { $eq: query.event_id };
	if (query.event_name) filter.type = { $eq: query.event_name };
	if (query.source) filter.source = { $eq: query.source };
	if (query.external_customer_id) filter.subject = { $eq: query.external_customer_id };
	if (query.start_time) filter.from = query.start_time;
	if (query.end_time) filter.to = query.end_time;
	return {
		...(query.page_size ? { limit: query.page_size } : {}),
		...(query.iter_last_key ? { cursor: query.iter_last_key } : {}),
		...(Object.keys(filter).length ? { filter: JSON.stringify(filter) } : {}),
	};
}

/** property_filters 归一为键值对列表：GET 的 "k:v;k:v;" 字符串与 POST 的 Record 同构处理。 */
export function parsePropertyFilters(propertyFilters?: string | Record<string, string[]>): Array<[string, string]> {
	if (!propertyFilters) return [];
	if (typeof propertyFilters !== 'string') {
		return Object.entries(propertyFilters).flatMap(([key, values]) => (values ?? []).map((value) => [key, value] as [string, string]));
	}
	return propertyFilters
		.split(';')
		.map((pair) => pair.trim())
		.filter(Boolean)
		.map((pair) => {
			const separator = pair.indexOf(':');
			return separator > 0 ? [pair.slice(0, separator), pair.slice(separator + 1)] : null;
		})
		.filter((pair): pair is [string, string] => pair !== null);
}

function matchesPropertyFilters(event: Event, pairs: Array<[string, string]>): boolean {
	return pairs.every(([key, value]) => String(event.properties?.[key] ?? '') === value);
}

/**
 * OM v2 游标分页 → Flexprice GetEventsResponse。
 * iter_last_key 回传 OM nextCursor（UI 的「加载更多」把它原样带回 query.cursor），
 * iter_first_key 仅作展示用的首页事件 id；has_more 以 nextCursor 是否存在为准
 * （property_filters 客户端过滤后可能偏乐观，属已知近似）。
 */
export function toFlexpriceEventsPage(page: OmEventsV2Page, propertyFilters?: string | Record<string, string[]>): GetEventsResponse {
	const pairs = parsePropertyFilters(propertyFilters);
	let events = (page.items ?? []).map(mapOmIngestedEvent);
	if (pairs.length) events = events.filter((event) => matchesPropertyFilters(event, pairs));
	return {
		events,
		has_more: Boolean(page.nextCursor),
		iter_first_key: events[0]?.id,
		iter_last_key: page.nextCursor ?? events[events.length - 1]?.id,
	};
}

/** OM 无 Flexprice 归属调试链（customer/meter/price/line-item 查找），各段固定返回 unprocessed。 */
export function buildEmptyEventDebugTracker(): EventDebugTracker {
	return {
		customer_lookup: { status: 'unprocessed' },
		meter_matching: { status: 'unprocessed' },
		price_lookup: { status: 'unprocessed' },
		subscription_line_item_lookup: { status: 'unprocessed' },
	};
}

/** 单事件调试响应：event 来自 OM 落库原样，validationError 视为 failed，归属链全空。 */
export function toFlexpriceEventDebug(ingested: OmIngestedEvent): GetEventDebugResponse {
	return {
		event: mapOmIngestedEvent(ingested),
		status: ingested.validationError ? 'failed' : 'processed',
		processed_events: [],
		debug_tracker: buildEmptyEventDebugTracker(),
	};
}
