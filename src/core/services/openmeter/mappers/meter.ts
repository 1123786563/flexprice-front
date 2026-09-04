// src/core/services/openmeter/mappers/meter.ts
// OM meter ↔ Flexprice MeterResponse 双向映射 + 用量查询构造。
// OM 无对应概念：reset_usage（无账期重置）、meter 级事件过滤（filters 仅查询期 filterGroupBy）、
// multiplier/加权聚合（SUM_WITH_MULTIPLIER/WEIGHTED_SUM 退化为 SUM）。
import type { OpenMeterClient, OpenMeterMeter } from '@/core/services/openmeter';
import { ENTITY_STATUS, METER_AGGREGATION_TYPE, METER_USAGE_RESET_PERIOD } from '@/models';
import type { CreateMeterRequest, MeterResponse, GetUsageByMeterPayload, GetUsageByMeterResponse } from '@/types/dto';
import { iso } from './common';

export type OmMeterCreate = Parameters<OpenMeterClient['meters']['create']>[0];
export type OmMeterAggregation = OpenMeterMeter['aggregation'];
export type OmMeterQueryPostBody = NonNullable<Parameters<OpenMeterClient['meters']['queryPost']>[1]>;
export type OmMeterQueryRow = NonNullable<Awaited<ReturnType<OpenMeterClient['meters']['query']>>>['data'][number];

/** Flexprice → OM 聚合枚举：OM 无 multiplier/加权，SUM_WITH_MULTIPLIER 与 WEIGHTED_SUM 退化为 SUM。 */
export function mapAggregationToOm(type: METER_AGGREGATION_TYPE): OmMeterAggregation {
	switch (type) {
		case METER_AGGREGATION_TYPE.COUNT:
			return 'COUNT';
		case METER_AGGREGATION_TYPE.COUNT_UNIQUE:
			return 'UNIQUE_COUNT';
		case METER_AGGREGATION_TYPE.AVG:
			return 'AVG';
		case METER_AGGREGATION_TYPE.MAX:
			return 'MAX';
		case METER_AGGREGATION_TYPE.LATEST:
			return 'LATEST';
		default:
			return 'SUM';
	}
}

/** OM → Flexprice 聚合枚举：UNIQUE_COUNT↔COUNT_UNIQUE；OM 的 MIN 在 Flexprice 枚举中不存在，近似为 AVG。 */
export function mapOmAggregation(om: OmMeterAggregation): METER_AGGREGATION_TYPE {
	switch (om) {
		case 'COUNT':
			return METER_AGGREGATION_TYPE.COUNT;
		case 'UNIQUE_COUNT':
			return METER_AGGREGATION_TYPE.COUNT_UNIQUE;
		case 'AVG':
			return METER_AGGREGATION_TYPE.AVG;
		case 'MAX':
			return METER_AGGREGATION_TYPE.MAX;
		case 'LATEST':
			return METER_AGGREGATION_TYPE.LATEST;
		case 'MIN':
			return METER_AGGREGATION_TYPE.AVG;
		default:
			return METER_AGGREGATION_TYPE.SUM;
	}
}

/** Flexprice 聚合字段名（如 tokens）→ OM JSONPath（$.tokens）；已是 $ 开头则原样保留。 */
function toJsonProperty(field: string): string {
	return field.startsWith('$') ? field : `$.${field}`;
}

/** OM meter slug 仅允许字母数字下划线；从 name 派生，非法字符折叠为单个下划线，空值回退 event_name。 */
export function meterSlugFrom(name: string, eventName: string): string {
	const slugify = (input: string) =>
		input
			.toLowerCase()
			.replace(/[^a-z0-9_]+/g, '_')
			.replace(/_+/g, '_')
			.replace(/^_|_$/g, '');
	return slugify(name) || slugify(eventName) || 'meter';
}

/** OM meter → Flexprice MeterResponse。groupBy 只保留首个键（Flexprice 聚合仅单 group_by 字段）。 */
export function mapOmMeter(om: OpenMeterMeter): MeterResponse {
	const groupByKeys = Object.keys(om.groupBy ?? {});
	return {
		id: om.id,
		name: om.name ?? om.slug,
		event_name: om.eventType,
		aggregation: {
			type: mapOmAggregation(om.aggregation),
			field: om.valueProperty ?? '',
			...(groupByKeys.length ? { group_by: groupByKeys[0] } : {}),
		},
		// OM meter 定义不支持事件级过滤（过滤发生在查询期 filterGroupBy），读回恒为空。
		filters: [],
		reset_usage: METER_USAGE_RESET_PERIOD.NEVER,
		created_at: iso(om.createdAt),
		updated_at: iso(om.updatedAt),
		created_by: '',
		updated_by: '',
		tenant_id: '',
		status: ENTITY_STATUS.PUBLISHED,
		environment_id: '',
	};
}

/** Flexprice CreateMeterRequest → OM MeterCreate（slug 由 name 派生；reset_usage/filters 丢弃，见文件头）。 */
export function buildOmMeterCreate(req: CreateMeterRequest): OmMeterCreate {
	const create: OmMeterCreate = {
		slug: meterSlugFrom(req.name, req.event_name),
		name: req.name,
		aggregation: mapAggregationToOm(req.aggregation.type),
		eventType: req.event_name,
	};
	if (req.aggregation.field) create.valueProperty = toJsonProperty(req.aggregation.field);
	if (req.aggregation.group_by) {
		create.groupBy = { [req.aggregation.group_by]: toJsonProperty(req.aggregation.group_by) };
	}
	return create;
}

/** OM 查询 windowSize 仅支持 MINUTE/HOUR/DAY/MONTH，其余（15MIN 等）不传由服务端整段聚合。 */
function isOmWindowSize(windowSize?: string): windowSize is NonNullable<OmMeterQueryPostBody['windowSize']> {
	return windowSize === 'MINUTE' || windowSize === 'HOUR' || windowSize === 'DAY' || windowSize === 'MONTH';
}

/** Flexprice GetUsageByMeterPayload → OM MeterQueryRequest（subject 即 external_customer_id；filters 即 filterGroupBy；group_by 透传 OM 维度分析）。 */
export function buildOmMeterQueryBody(payload: GetUsageByMeterPayload): OmMeterQueryPostBody {
	const body: OmMeterQueryPostBody = {};
	if (payload.start_time) body.from = new Date(payload.start_time);
	if (payload.end_time) body.to = new Date(payload.end_time);
	if (payload.external_customer_id) body.subject = [payload.external_customer_id];
	if (payload.filters && Object.keys(payload.filters).length) body.filterGroupBy = payload.filters;
	if (isOmWindowSize(payload.window_size)) body.windowSize = payload.window_size;
	if (payload.group_by?.length) body.groupBy = payload.group_by;
	return body;
}

/** OM 查询结果 → Flexprice GetUsageByMeterResponse；window_size 为窗口起点 ISO（UI 按时间轴渲染），groupBy 维度值随行透出。 */
export function toUsageByMeterResponse(meter: OpenMeterMeter, rows: OmMeterQueryRow[]): GetUsageByMeterResponse {
	return {
		type: mapOmAggregation(meter.aggregation),
		event_name: meter.eventType,
		results: rows.map((row) => {
			const groupByEntries: [string, string][] = Object.entries(row.groupBy ?? {}).filter(
				(entry): entry is [string, string] => entry[1] !== null && entry[1] !== undefined,
			);
			return {
				window_size: iso(row.windowStart),
				value: row.value,
				...(groupByEntries.length ? { group_by: Object.fromEntries(groupByEntries) } : {}),
			};
		}),
	};
}
