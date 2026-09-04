// src/core/services/openmeter/mappers/feature.ts
// OM feature/meter ↔ Flexprice FeatureResponse 双向映射。
// OM feature 无 description/unit/reporting_unit/group/alert/config 字段，全部以 `flexprice.*`
// 保留键收进 OM metadata（值为字符串，对象 JSON 序列化），读回时还原；用户 metadata 不受影响。
import type { OpenMeterClient } from '@/core/services/openmeter';
import {
	ENTITY_STATUS,
	FEATURE_TYPE,
	METER_AGGREGATION_TYPE,
	METER_USAGE_RESET_PERIOD,
	type AlertSettings,
	type Feature,
	type Metadata,
	type Meter,
} from '@/models';
import type { CreateFeatureRequest, FeatureFilter, ReportingUnit, UpdateFeatureRequest } from '@/types/dto';
import type { CreateMeterRequest } from '@/types/dto';
import type { JsonObject } from '@/types/common';
import { iso } from './common';

export type OmFeature = NonNullable<Awaited<ReturnType<OpenMeterClient['features']['get']>>>;
export type OmFeatureListQuery = NonNullable<Parameters<OpenMeterClient['features']['list']>[0]>;
export type OmFeatureCreate = Parameters<OpenMeterClient['features']['create']>[0];
export type OmMeter = NonNullable<Awaited<ReturnType<OpenMeterClient['meters']['get']>>>;
export type OmMeterCreate = Parameters<OpenMeterClient['meters']['create']>[0];

const META_PREFIX = 'flexprice.';
const META_DESCRIPTION = `${META_PREFIX}description`;
const META_UNIT_SINGULAR = `${META_PREFIX}unit_singular`;
const META_UNIT_PLURAL = `${META_PREFIX}unit_plural`;
const META_REPORTING_UNIT = `${META_PREFIX}reporting_unit`;
const META_GROUP_ID = `${META_PREFIX}group_id`;
const META_ALERT_SETTINGS = `${META_PREFIX}alert_settings`;
const META_CONFIG_VALUE = `${META_PREFIX}config_value`;
const META_TYPE = `${META_PREFIX}type`;

/** 解析 metadata 中的 JSON 字段；损坏或缺失返回 undefined（不抛错——旧数据可缺省）。 */
function parseJsonField<T>(metadata: Record<string, string> | undefined, key: string): T | undefined {
	const raw = metadata?.[key];
	if (!raw) return undefined;
	try {
		return JSON.parse(raw) as T;
	} catch {
		return undefined;
	}
}

/** 用户可见 metadata：剥掉 `flexprice.*` 保留键。 */
export function userMetadata(om: Record<string, string> | undefined | null): Metadata {
	const out: Metadata = {};
	for (const [k, v] of Object.entries(om ?? {})) {
		if (!k.startsWith(META_PREFIX)) out[k] = v;
	}
	return out;
}

/** OM feature 类型还原：有 meterSlug → metered；否则读保留键（保住 boolean/config），兜底 static。 */
export function featureTypeOf(om: Pick<OmFeature, 'meterSlug' | 'metadata'>): FEATURE_TYPE {
	if (om.meterSlug) return FEATURE_TYPE.METERED;
	const reserved = om.metadata?.[META_TYPE];
	if (reserved === FEATURE_TYPE.BOOLEAN || reserved === FEATURE_TYPE.CONFIG || reserved === FEATURE_TYPE.STATIC) return reserved;
	return FEATURE_TYPE.STATIC;
}

export function mapOmFeature(om: OmFeature): Feature & { meter?: Meter } {
	const metadata = om.metadata ?? {};
	const reportingUnit = parseJsonField<ReportingUnit>(metadata, META_REPORTING_UNIT);
	const alertSettings = parseJsonField<AlertSettings>(metadata, META_ALERT_SETTINGS);
	const configValue = parseJsonField<JsonObject>(metadata, META_CONFIG_VALUE);
	return {
		id: om.id,
		name: om.name,
		description: metadata[META_DESCRIPTION] ?? '',
		lookup_key: om.key,
		meter_id: om.meterSlug ?? '',
		metadata: userMetadata(metadata),
		type: featureTypeOf(om),
		tenant_id: '',
		unit_singular: metadata[META_UNIT_SINGULAR] ?? '',
		unit_plural: metadata[META_UNIT_PLURAL] ?? '',
		...(reportingUnit ? { reporting_unit: reportingUnit } : {}),
		...(alertSettings ? { alert_settings: alertSettings } : {}),
		...(metadata[META_GROUP_ID] ? { group_id: metadata[META_GROUP_ID] } : {}),
		...(configValue !== undefined ? { config_value: configValue } : {}),
		status: ENTITY_STATUS.PUBLISHED,
		environment_id: '',
		created_by: '',
		updated_by: '',
		created_at: iso(om.createdAt),
		updated_at: iso(om.updatedAt),
	};
}

/** Flexprice Create/Update 字段 → OM metadata（含保留键）。已有值不覆盖未提供的可选字段。 */
export function buildOmFeatureMetadata(
	req: Pick<
		CreateFeatureRequest & UpdateFeatureRequest,
		'description' | 'metadata' | 'unit_singular' | 'unit_plural' | 'reporting_unit' | 'group_id' | 'alert_settings' | 'config_value'
	> & { type?: FEATURE_TYPE },
	current?: Record<string, string> | null,
): Record<string, string> {
	const merged: Record<string, string> = { ...(current ?? {}) };
	for (const [k, v] of Object.entries(req.metadata ?? {})) merged[k] = v;
	if (req.description !== undefined) merged[META_DESCRIPTION] = req.description;
	if (req.unit_singular !== undefined) merged[META_UNIT_SINGULAR] = req.unit_singular;
	if (req.unit_plural !== undefined) merged[META_UNIT_PLURAL] = req.unit_plural;
	if (req.reporting_unit !== undefined) merged[META_REPORTING_UNIT] = JSON.stringify(req.reporting_unit);
	if (req.group_id !== undefined) {
		// Flexprice 约定：空串清除分组。
		if (req.group_id === '') delete merged[META_GROUP_ID];
		else merged[META_GROUP_ID] = req.group_id;
	}
	if (req.alert_settings !== undefined) merged[META_ALERT_SETTINGS] = JSON.stringify(req.alert_settings);
	if (req.config_value !== undefined) merged[META_CONFIG_VALUE] = JSON.stringify(req.config_value);
	// boolean/config 类型没有 meterSlug 可推断，写保留键保住 UI 类型。
	if (req.type === FEATURE_TYPE.BOOLEAN || req.type === FEATURE_TYPE.CONFIG || req.type === FEATURE_TYPE.STATIC)
		merged[META_TYPE] = req.type;
	return merged;
}

/** Flexprice CreateFeatureRequest → OM FeatureCreateInputs（meterSlug 由调用方解析：内嵌 meter 先建表或直接引用 meter_id）。 */
export function buildOmFeatureCreate(req: CreateFeatureRequest, meterSlug?: string): OmFeatureCreate {
	const metadata = buildOmFeatureMetadata(req);
	return {
		key: req.lookup_key || slugify(req.name),
		name: req.name,
		metadata,
		...(meterSlug ? { meterSlug } : {}),
	};
}

/**
 * Flexprice FeatureFilter（GET 与 POST /search 共用）→ OM listFeatures 查询。
 * 服务端可下推 meter_ids + 分页（OM 该端点用 limit/offset）；其余（feature_ids/lookup_key/
 * name_contains/status）由 FeatureApi 在客户端过滤。
 */
export function buildOmFeatureListQuery(filter: FeatureFilter & { limit?: number | null; offset?: number }): OmFeatureListQuery {
	return {
		limit: filter.limit ?? 100,
		offset: filter.offset ?? 0,
		...(filter.meter_ids?.length ? { meterSlug: filter.meter_ids } : {}),
	};
}

/** 客户端兜底过滤：OM 不支持的 FeatureFilter 字段在返回集上执行。 */
export function filterFeaturesClientSide(
	items: Array<Feature & { meter?: Meter }>,
	filter: FeatureFilter,
): Array<Feature & { meter?: Meter }> {
	let result = items;
	if (filter.feature_ids?.length) {
		const ids = new Set(filter.feature_ids);
		result = result.filter((f) => ids.has(f.id));
	}
	if (filter.lookup_key) {
		result = result.filter((f) => f.lookup_key === filter.lookup_key);
	}
	if (filter.lookup_keys?.length) {
		const keys = new Set(filter.lookup_keys);
		result = result.filter((f) => f.lookup_key && keys.has(f.lookup_key));
	}
	if (filter.name_contains) {
		const q = filter.name_contains.toLowerCase();
		result = result.filter((f) => f.name.toLowerCase().includes(q));
	}
	if (filter.status) {
		result = result.filter((f) => f.status === filter.status);
	}
	return result;
}

// ============================================
// Meter：CreateFeatureRequest 可内嵌 meter（Flexprice 一步建表），
// OM 需两步——先 meters.create 再 features.create，此处负责 meter 的双向映射。
// ============================================

/** Flexprice 聚合类型 → OM 聚合枚举；无对应的（带乘数/加权）降级 SUM，乘数丢弃（已知限制）。 */
function toOmAggregation(type: METER_AGGREGATION_TYPE | undefined): NonNullable<OmMeterCreate['aggregation']> {
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

/** OM 聚合枚举 → Flexprice 聚合类型。 */
function fromOmAggregation(om: OmMeter['aggregation']): METER_AGGREGATION_TYPE {
	switch (om) {
		case 'COUNT':
			return METER_AGGREGATION_TYPE.COUNT;
		case 'UNIQUE_COUNT':
			return METER_AGGREGATION_TYPE.COUNT_UNIQUE;
		case 'AVG':
			return METER_AGGREGATION_TYPE.AVG;
		case 'MIN':
		case 'MAX':
			return METER_AGGREGATION_TYPE.MAX;
		case 'LATEST':
			return METER_AGGREGATION_TYPE.LATEST;
		default:
			return METER_AGGREGATION_TYPE.SUM;
	}
}

/** slug 化（OM meter slug 仅允许字母数字下划线）。 */
export function slugify(input: string): string {
	const slug = input
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9_]+/g, '_')
		.replace(/^_+|_+$/g, '');
	return slug || `meter_${Date.now()}`;
}

/**
 * Flexprice CreateMeterRequest → OM MeterCreate。
 * OM meter 无 filters/expression/multiplier/reset_usage：filters 与 expression 丢弃（已知限制），
 * group_by 字段名映射为 `$.<field>` JSONPath。
 */
export function buildOmMeterCreate(req: CreateMeterRequest): OmMeterCreate {
	return {
		slug: slugify(req.event_name || req.name),
		...(req.name ? { name: req.name } : {}),
		aggregation: toOmAggregation(req.aggregation?.type),
		eventType: req.event_name,
		...(req.aggregation?.field ? { valueProperty: `$.${req.aggregation.field.replace(/^\$?\./, '')}` } : {}),
		...(req.aggregation?.group_by ? { groupBy: { [req.aggregation.group_by]: `$.${req.aggregation.group_by}` } } : {}),
	};
}

/** OM meter → Flexprice Meter（reset_usage OM 无对应，固定 NEVER）。 */
export function mapOmMeter(om: OmMeter): Meter {
	return {
		id: om.id,
		name: om.name ?? om.slug,
		event_name: om.eventType,
		aggregation: {
			type: fromOmAggregation(om.aggregation),
			field: om.valueProperty ? om.valueProperty.replace(/^\$?\./, '') : '',
		},
		filters: Object.entries(om.groupBy ?? {}).map(([key]) => ({ key, values: [] })),
		reset_usage: METER_USAGE_RESET_PERIOD.NEVER,
		tenant_id: '',
		status: ENTITY_STATUS.PUBLISHED,
		environment_id: '',
		created_by: '',
		updated_by: '',
		created_at: iso(om.createdAt),
		updated_at: iso(om.updatedAt),
	};
}
