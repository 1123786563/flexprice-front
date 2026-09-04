// src/core/services/openmeter/mappers/entitlement.ts
// OM entitlement ↔ Flexprice EntitlementResponse 映射 + 目录级（plan/addon）rate card 手术。
//
// 概念错位：Flexprice entitlement 是目录定义型（entity_type=PLAN/ADDON/SUBSCRIPTION + entity_id），
// OM 是 subject 实例型（客户挂 entitlement）。映射策略：
// - SUBSCRIPTION 查询 → OM customers.entitlements（客户的实例 entitlement 视为订阅 entitlement）；
// - PLAN/ADDON 查询 → 从 OM plans.phases[].rateCards / addons.rateCards 的 entitlementTemplate 合成；
//   合成 id 采用 `plan:<planId>:<featureKey>` / `addon:<addonId>:<featureKey>`，写路径按 id 反解做手术。
// - 写：SUBSCRIPTION 走 customers.entitlements.create / entitlementsV1.override；PLAN/ADDON 走
//   plan/addon update 的 rate card 整体替换（追加/改写 entitlementTemplate，不动价格卡）。
import type { OpenMeterClient } from '@/core/services/openmeter';
import {
	ENTITY_STATUS,
	ENTITLEMENT_ENTITY_TYPE,
	ENTITLEMENT_USAGE_RESET_PERIOD,
	FEATURE_TYPE,
	type Feature,
	type Plan,
	type Addon,
} from '@/models';
import type { EntitlementResponse, CreateEntitlementRequest } from '@/types/dto/Entitlement';
import type { JsonObject } from '@/types/common';
import { iso } from './common';
import { mapOmFeature, type OmFeature } from './feature';

export type OmEntitlementV2 = NonNullable<Awaited<ReturnType<OpenMeterClient['customers']['entitlements']['list']>>>['items'][number];
export type OmPlan = NonNullable<Awaited<ReturnType<OpenMeterClient['plans']['get']>>>;
export type OmPlanReplaceUpdate = Parameters<OpenMeterClient['plans']['update']>[1];
export type OmRateCard = OmPlan['phases'][number]['rateCards'][number];
export type OmEntitlementTemplate = NonNullable<OmRateCard['entitlementTemplate']>;
export type OmSubjectEntitlementCreate = Parameters<OpenMeterClient['customers']['entitlements']['create']>[1];
export type OmOverrideInput = Parameters<OpenMeterClient['entitlementsV1']['override']>[2];

/** 由我们追加的纯 entitlement 卡片（无价格）用此前缀标记，删除时可整卡移除。 */
export const ENTITLEMENT_CARD_KEY_PREFIX = 'flexprice-entitlement-';

const RESET_PERIOD_BY_INTERVAL: Record<string, ENTITLEMENT_USAGE_RESET_PERIOD> = {
	DAY: ENTITLEMENT_USAGE_RESET_PERIOD.DAILY,
	P1D: ENTITLEMENT_USAGE_RESET_PERIOD.DAILY,
	WEEK: ENTITLEMENT_USAGE_RESET_PERIOD.WEEKLY,
	P1W: ENTITLEMENT_USAGE_RESET_PERIOD.WEEKLY,
	MONTH: ENTITLEMENT_USAGE_RESET_PERIOD.MONTHLY,
	P1M: ENTITLEMENT_USAGE_RESET_PERIOD.MONTHLY,
	YEAR: ENTITLEMENT_USAGE_RESET_PERIOD.ANNUAL,
	P1Y: ENTITLEMENT_USAGE_RESET_PERIOD.ANNUAL,
	P3M: ENTITLEMENT_USAGE_RESET_PERIOD.QUARTERLY,
	P6M: ENTITLEMENT_USAGE_RESET_PERIOD.HALF_YEARLY,
};

/** Flexprice usage_reset_period → OM ISO-8601 duration（NEVER/缺省按月，metered entitlement 必须有周期）。 */
export function resetPeriodToIsoDuration(period: ENTITLEMENT_USAGE_RESET_PERIOD | null | undefined): string {
	switch (period) {
		case ENTITLEMENT_USAGE_RESET_PERIOD.DAILY:
			return 'P1D';
		case ENTITLEMENT_USAGE_RESET_PERIOD.WEEKLY:
			return 'P1W';
		case ENTITLEMENT_USAGE_RESET_PERIOD.QUARTERLY:
			return 'P3M';
		case ENTITLEMENT_USAGE_RESET_PERIOD.HALF_YEARLY:
			return 'P6M';
		case ENTITLEMENT_USAGE_RESET_PERIOD.ANNUAL:
			return 'P1Y';
		default:
			return 'P1M';
	}
}

/** OM usagePeriod（enum 名或 ISO duration）→ Flexprice usage_reset_period；识别不了返回 null。 */
export function omUsagePeriodToResetPeriod(usagePeriod: { interval: string } | undefined | null): ENTITLEMENT_USAGE_RESET_PERIOD | null {
	if (!usagePeriod?.interval) return null;
	const raw = String(usagePeriod.interval).toUpperCase();
	const known = RESET_PERIOD_BY_INTERVAL[raw];
	if (known) return known;
	// 非固定档位的 ISO duration 按月数归档
	const iso = /^P(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)W)?(?:(\d+)D)?$/.exec(raw);
	if (!iso) return null;
	const [years, months, weeks, days] = [Number(iso[1] ?? 0), Number(iso[2] ?? 0), Number(iso[3] ?? 0), Number(iso[4] ?? 0)];
	const totalMonths = years * 12 + months;
	if (totalMonths === 12) return ENTITLEMENT_USAGE_RESET_PERIOD.ANNUAL;
	if (totalMonths === 6) return ENTITLEMENT_USAGE_RESET_PERIOD.HALF_YEARLY;
	if (totalMonths === 3) return ENTITLEMENT_USAGE_RESET_PERIOD.QUARTERLY;
	if (totalMonths === 1) return ENTITLEMENT_USAGE_RESET_PERIOD.MONTHLY;
	if (weeks === 1 || days === 7) return ENTITLEMENT_USAGE_RESET_PERIOD.WEEKLY;
	if (days === 1) return ENTITLEMENT_USAGE_RESET_PERIOD.DAILY;
	return null;
}

// ============================================
// 合成 id：目录型 entitlement 无 OM 实体，id 由 entity + featureKey 组合而成
// ============================================

export function syntheticEntitlementId(entityType: ENTITLEMENT_ENTITY_TYPE, entityId: string, featureKey: string): string {
	const prefix = entityType === ENTITLEMENT_ENTITY_TYPE.ADDON ? 'addon' : 'plan';
	return `${prefix}:${entityId}:${featureKey}`;
}

export interface ParsedSyntheticEntitlementId {
	entityType: ENTITLEMENT_ENTITY_TYPE.PLAN | ENTITLEMENT_ENTITY_TYPE.ADDON;
	entityId: string;
	featureKey: string;
}

export function parseSyntheticEntitlementId(id: string): ParsedSyntheticEntitlementId | null {
	const [prefix, entityId, featureKey] = id.split(':');
	if (!entityId || !featureKey) return null;
	if (prefix === 'plan') return { entityType: ENTITLEMENT_ENTITY_TYPE.PLAN, entityId, featureKey };
	if (prefix === 'addon') return { entityType: ENTITLEMENT_ENTITY_TYPE.ADDON, entityId, featureKey };
	return null;
}

/** featureKey 兜底骨架（feature 已被删除/搜索时不在列表中的降级展示）。 */
export function stubFeature(featureKey: string, type: 'metered' | 'static' | 'boolean' = 'static'): Feature {
	const featureType = type === 'metered' ? FEATURE_TYPE.METERED : type === 'boolean' ? FEATURE_TYPE.BOOLEAN : FEATURE_TYPE.STATIC;
	return {
		id: featureKey,
		name: featureKey,
		description: '',
		lookup_key: featureKey,
		meter_id: '',
		metadata: {},
		type: featureType,
		tenant_id: '',
		unit_singular: '',
		unit_plural: '',
		status: ENTITY_STATUS.PUBLISHED,
		environment_id: '',
		created_by: '',
		updated_by: '',
		created_at: '',
		updated_at: '',
	};
}

/** 按目录形态解析 feature：OM feature 列表按 id/key 命中则映射真实档案，否则骨架兜底。 */
export function resolveFeature(features: OmFeature[], featureKey: string, fallbackType: 'metered' | 'static' | 'boolean'): Feature {
	const om = features.find((f) => f.key === featureKey || f.id === featureKey);
	return om ? mapOmFeature(om) : stubFeature(featureKey, fallbackType);
}

// ============================================
// static config 的编解码：OM static entitlement 的 config 必须是 JSON 对象
// ============================================

function encodeStaticConfig(req: Pick<CreateEntitlementRequest, 'static_value' | 'config_value'>): string {
	if (req.config_value !== undefined) return JSON.stringify(req.config_value);
	return JSON.stringify({ value: req.static_value ?? 'true' });
}

function decodeStaticConfig(config: string): { static_value: string; config_value: JsonObject | undefined } {
	try {
		const parsed = JSON.parse(config) as JsonObject;
		const inlineValue = typeof parsed.value === 'string' ? parsed.value : undefined;
		return { static_value: inlineValue ?? JSON.stringify(parsed), config_value: parsed };
	} catch {
		return { static_value: config, config_value: undefined };
	}
}

// ============================================
// 创建体：rate card 模板（目录）与 subject entitlement（实例）
// ============================================

/** Flexprice entitlement 定义 → OM rate card entitlementTemplate。 */
export function buildEntitlementTemplate(req: CreateEntitlementRequest): OmEntitlementTemplate {
	switch (req.feature_type) {
		case FEATURE_TYPE.METERED:
			return {
				type: 'metered',
				...(req.usage_limit != null ? { issueAfterReset: req.usage_limit } : {}),
				...(req.is_soft_limit ? { isSoftLimit: true } : {}),
				...(req.usage_reset_period && req.usage_reset_period !== ENTITLEMENT_USAGE_RESET_PERIOD.NEVER
					? { usagePeriod: resetPeriodToIsoDuration(req.usage_reset_period) }
					: {}),
			};
		case FEATURE_TYPE.BOOLEAN:
			return { type: 'boolean' };
		default:
			// STATIC 与 CONFIG（OM 无 config 型 entitlement，用 static config 承载）
			return { type: 'static', config: encodeStaticConfig(req) };
	}
}

/** Flexprice entitlement 定义 → OM customer entitlement 创建体（挂 subject 实例）。 */
export function buildOmSubjectEntitlementCreate(featureKey: string, req: CreateEntitlementRequest): OmSubjectEntitlementCreate {
	switch (req.feature_type) {
		case FEATURE_TYPE.METERED:
			return {
				featureKey,
				type: 'metered',
				usagePeriod: { interval: resetPeriodToIsoDuration(req.usage_reset_period) },
				...(req.usage_limit != null ? { issueAfterReset: req.usage_limit } : {}),
				...(req.is_soft_limit ? { isSoftLimit: true } : {}),
			};
		case FEATURE_TYPE.BOOLEAN:
			return { featureKey, type: 'boolean' };
		default:
			return { featureKey, type: 'static', config: encodeStaticConfig(req) };
	}
}

// ============================================
// rate card 手术：在不动价格卡的前提下增/删 entitlement 模板
// ============================================

/** upsert：已有该 feature 的卡则改写 entitlementTemplate，否则追加一张免费的纯 entitlement 卡。 */
export function upsertEntitlementRateCards(
	cards: OmRateCard[],
	featureKey: string,
	template: OmEntitlementTemplate,
	featureName: string,
): OmRateCard[] {
	const idx = cards.findIndex((c) => c.featureKey === featureKey);
	if (idx === -1) {
		return [
			...cards,
			{
				type: 'flat_fee' as const,
				key: `${ENTITLEMENT_CARD_KEY_PREFIX}${featureKey}`,
				name: featureName,
				featureKey,
				billingCadence: null,
				price: null,
				entitlementTemplate: template,
			},
		];
	}
	const next = [...cards];
	next[idx] = { ...cards[idx], entitlementTemplate: template };
	return next;
}

/**
 * remove：我们追加的纯 entitlement 卡（前缀标记 + 无价格）整卡移除；
 * 带价格的卡只摘掉 entitlementTemplate，价格保留。找不到该 feature 时抛错（删除语义要求存在）。
 */
export function removeEntitlementFromRateCards(cards: OmRateCard[], featureKey: string): OmRateCard[] {
	const idx = cards.findIndex((c) => c.featureKey === featureKey);
	if (idx === -1) throw new Error(`entitlement（featureKey=${featureKey}）不存在`);
	const card = cards[idx];
	if (card.key.startsWith(ENTITLEMENT_CARD_KEY_PREFIX) && card.price == null) {
		return cards.filter((_, i) => i !== idx);
	}
	const next = [...cards];
	const rest: OmRateCard = { ...card };
	// 带价格的卡保留计费，仅摘除 entitlement 模板
	delete rest.entitlementTemplate;
	next[idx] = rest;
	return next;
}

/** 取卡上的 entitlementTemplate；无则 null。 */
export function entitlementTemplateOf(card: OmRateCard): OmEntitlementTemplate | null {
	return card.entitlementTemplate ?? null;
}

// ============================================
// OM → Flexprice 映射
// ============================================

interface SynthBaseFields {
	created_at: string;
	updated_at: string;
}

/** OM rate card entitlementTemplate → Flexprice EntitlementResponse（目录合成）。 */
export function synthEntitlementFromCard(
	card: OmRateCard,
	entityType: ENTITLEMENT_ENTITY_TYPE,
	entityId: string,
	feature: Feature,
	base: SynthBaseFields,
	extra?: { plan?: Plan; addon?: Addon },
): EntitlementResponse {
	const template = entitlementTemplateOf(card);
	const featureKey = card.featureKey ?? feature.lookup_key ?? feature.id;
	const staticDecoded = template?.type === 'static' ? decodeStaticConfig(template.config) : undefined;
	return {
		id: syntheticEntitlementId(entityType, entityId, featureKey),
		feature,
		feature_id: feature.id,
		feature_type: template?.type ?? 'static',
		is_enabled: true,
		is_soft_limit: template?.type === 'metered' ? (template.isSoftLimit ?? false) : false,
		entity_type: entityType,
		entity_id: entityId,
		static_value: staticDecoded?.static_value ?? '',
		tenant_id: '',
		usage_limit: template?.type === 'metered' ? (template.issueAfterReset ?? null) : null,
		usage_reset_period:
			template?.type === 'metered' && template.usagePeriod ? omUsagePeriodToResetPeriod({ interval: template.usagePeriod }) : null,
		...(staticDecoded?.config_value !== undefined ? { config_value: staticDecoded.config_value } : {}),
		status: ENTITY_STATUS.PUBLISHED,
		environment_id: '',
		created_by: '',
		updated_by: '',
		created_at: base.created_at,
		updated_at: base.updated_at,
		...(extra?.plan ? { plan: extra.plan } : {}),
		...(extra?.addon ? { addon: extra.addon } : {}),
	};
}

/** OM 客户 entitlement（v2 实例）→ Flexprice EntitlementResponse（entity 挂 SUBSCRIPTION，由调用方传入）。 */
export function mapOmSubjectEntitlement(
	om: OmEntitlementV2,
	entity_type: ENTITLEMENT_ENTITY_TYPE,
	entity_id: string,
	feature: Feature,
): EntitlementResponse {
	const staticDecoded = om.type === 'static' ? decodeStaticConfig(om.config) : undefined;
	return {
		id: om.id,
		feature,
		feature_id: om.featureId,
		feature_type: om.type,
		// OM entitlement 只有 active 状态（无停用开关），实例存在即视为启用
		is_enabled: true,
		is_soft_limit: om.type === 'metered' ? (om.isSoftLimit ?? false) : false,
		entity_type,
		entity_id,
		static_value: staticDecoded?.static_value ?? '',
		tenant_id: '',
		usage_limit: om.type === 'metered' ? (om.issue?.amount ?? om.issueAfterReset ?? null) : null,
		usage_reset_period: omUsagePeriodToResetPeriod(om.usagePeriod ?? null),
		...(staticDecoded?.config_value !== undefined ? { config_value: staticDecoded.config_value } : {}),
		status: ENTITY_STATUS.PUBLISHED,
		environment_id: '',
		created_by: '',
		updated_by: '',
		created_at: iso(om.createdAt),
		updated_at: iso(om.updatedAt),
		start_date: iso(om.activeFrom),
		end_date: iso(om.activeTo),
	};
}

/** OM entitlementTemplate → Flexprice Create 形状字段（update 合并用；缺省字段取兜底）。 */
export function fieldsFromTemplate(
	template: OmEntitlementTemplate | null,
	fallback: { feature_id: string; entity_type: ENTITLEMENT_ENTITY_TYPE; entity_id: string },
): Pick<
	CreateEntitlementRequest,
	| 'feature_id'
	| 'feature_type'
	| 'entity_type'
	| 'entity_id'
	| 'is_enabled'
	| 'is_soft_limit'
	| 'usage_limit'
	| 'usage_reset_period'
	| 'static_value'
	| 'config_value'
> {
	if (!template) {
		return {
			feature_id: fallback.feature_id,
			feature_type: FEATURE_TYPE.STATIC,
			entity_type: fallback.entity_type,
			entity_id: fallback.entity_id,
			is_enabled: true,
			is_soft_limit: false,
			usage_limit: null,
		};
	}
	if (template.type === 'metered') {
		return {
			feature_id: fallback.feature_id,
			feature_type: FEATURE_TYPE.METERED,
			entity_type: fallback.entity_type,
			entity_id: fallback.entity_id,
			is_enabled: true,
			is_soft_limit: template.isSoftLimit ?? false,
			usage_limit: template.issueAfterReset ?? null,
			usage_reset_period: template.usagePeriod ? (omUsagePeriodToResetPeriod({ interval: template.usagePeriod }) ?? undefined) : undefined,
		};
	}
	if (template.type === 'static') {
		const decoded = decodeStaticConfig(template.config);
		return {
			feature_id: fallback.feature_id,
			feature_type: FEATURE_TYPE.STATIC,
			entity_type: fallback.entity_type,
			entity_id: fallback.entity_id,
			is_enabled: true,
			is_soft_limit: false,
			usage_limit: null,
			static_value: decoded.static_value,
			...(decoded.config_value !== undefined ? { config_value: decoded.config_value } : {}),
		};
	}
	return {
		feature_id: fallback.feature_id,
		feature_type: FEATURE_TYPE.BOOLEAN,
		entity_type: fallback.entity_type,
		entity_id: fallback.entity_id,
		is_enabled: true,
		is_soft_limit: false,
		usage_limit: null,
	};
}

/** OM plan（当前 phases）→ Flexprice PlanReplaceUpdate：只替换 phases，其余字段取现值。 */
export function buildPlanReplaceUpdateWithPhases(plan: OmPlan, phases: OmPlan['phases']): OmPlanReplaceUpdate {
	return {
		name: plan.name,
		...(plan.description !== undefined ? { description: plan.description } : {}),
		...(plan.metadata !== undefined && plan.metadata !== null ? { metadata: plan.metadata } : {}),
		...(plan.alignment !== undefined ? { alignment: plan.alignment } : {}),
		billingCadence: plan.billingCadence,
		...(plan.proRatingConfig !== undefined ? { proRatingConfig: plan.proRatingConfig } : {}),
		...(plan.settlementMode !== undefined ? { settlementMode: plan.settlementMode } : {}),
		phases,
	};
}

/** 给（可能的）空 phases 补一张默认卡占位，保证 entitlement 卡有落点。 */
export function phasesWithFirstPhaseGuard(plan: OmPlan, mutate: (cards: OmRateCard[]) => OmRateCard[]): OmPlan['phases'] {
	if (plan.phases.length === 0) {
		return [
			{
				key: 'default',
				name: plan.name,
				description: plan.description,
				metadata: plan.metadata ?? null,
				duration: null,
				rateCards: mutate([]),
			},
		];
	}
	return plan.phases.map((phase, i) => (i === 0 ? { ...phase, rateCards: mutate(phase.rateCards) } : phase));
}

/** 判定 OM plan/addon 卡片是否有 entitlement 模板（合成 entitlement 列表时过滤用）。 */
export function isEntitlementCard(card: OmRateCard): card is OmRateCard & { featureKey: string } {
	return card.featureKey != null && card.entitlementTemplate != null;
}
