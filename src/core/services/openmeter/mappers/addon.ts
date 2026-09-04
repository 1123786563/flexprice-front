// src/core/services/openmeter/mappers/addon.ts
// OM addon（rateCards 计费模型）→ Flexprice AddonResponse。
// OM addon 无独立 entitlement 实体：entitlements 由 rateCards 上带 featureKey+entitlementTemplate
// 的卡片合成（synthEntitlementFromCard）；prices 由带价格的 flat_fee 卡尽力映射，其余跳过。
import type { OpenMeterClient } from '@/core/services/openmeter';
import {
	ENTITY_STATUS,
	ENTITLEMENT_ENTITY_TYPE,
	PRICE_ENTITY_TYPE,
	PRICE_TYPE,
	PRICE_UNIT_TYPE,
	TIER_MODE,
	BILLING_MODEL,
	type Addon,
	type Price,
} from '@/models';
import { BILLING_CADENCE, INVOICE_CADENCE } from '@/models/Invoice';
import type { AddonResponse, CreateAddonRequest, UpdateAddonRequest } from '@/types/dto/Addon';
import { userMetadata, type OmFeature } from './feature';
import { isEntitlementCard, resolveFeature, synthEntitlementFromCard } from './entitlement';
import { cadenceToBillingPeriod, iso } from './common';

export type OmAddon = NonNullable<Awaited<ReturnType<OpenMeterClient['addons']['get']>>>;
export type OmAddonPage = NonNullable<Awaited<ReturnType<OpenMeterClient['addons']['list']>>>;
export type OmAddonCreate = Parameters<OpenMeterClient['addons']['create']>[0];
export type OmAddonReplaceUpdate = Parameters<OpenMeterClient['addons']['update']>[1];

/** OM addon 状态（由 effectiveFrom/To 推导）→ Flexprice ENTITY_STATUS；draft/active 均可见。 */
export function mapAddonStatus(status: OmAddon['status']): ENTITY_STATUS {
	return status === 'archived' ? ENTITY_STATUS.ARCHIVED : ENTITY_STATUS.PUBLISHED;
}

/** OM rate card（带价格的 flat_fee）→ Flexprice Price；无价格的卡跳过（返回 undefined）。 */
function mapRateCardToPrice(card: OmAddon['rateCards'][number], addon: OmAddon): Price | undefined {
	if (card.type !== 'flat_fee' || !card.price) return undefined;
	return {
		id: `${addon.id}:${card.key}`,
		amount: String(card.price.amount),
		display_amount: String(card.price.amount),
		currency: addon.currency,
		entity_type: PRICE_ENTITY_TYPE.ADDON,
		entity_id: addon.id,
		type: PRICE_TYPE.FIXED,
		price_unit_type: PRICE_UNIT_TYPE.FIAT,
		billing_period: cadenceToBillingPeriod(card.billingCadence ?? undefined),
		billing_period_count: 1,
		billing_model: BILLING_MODEL.FLAT_FEE,
		display_name: card.name,
		billing_cadence: card.billingCadence ? BILLING_CADENCE.RECURRING : BILLING_CADENCE.ONETIME,
		tier_mode: TIER_MODE.VOLUME,
		tiers: null,
		meter_id: '',
		filter_values: null,
		lookup_key: card.key,
		description: card.description ?? '',
		transform_quantity: null,
		invoice_cadence: (card.price.paymentTerm ?? 'in_advance') === 'in_arrears' ? INVOICE_CADENCE.ARREAR : INVOICE_CADENCE.ADVANCE,
		tenant_id: '',
		status: mapAddonStatus(addon.status),
		environment_id: '',
		created_by: '',
		updated_by: '',
		created_at: iso(addon.createdAt),
		updated_at: iso(addon.updatedAt),
		metadata: {},
	};
}

/**
 * OM addon → Flexprice AddonResponse。features 用于把卡片 featureKey 解析成完整 Feature
 * （缺席时以 featureKey 骨架兜底）；OM rateCards 对不上的价格细节跳过。
 */
export function mapOmAddon(om: OmAddon, features: OmFeature[] = []): AddonResponse {
	const base = { created_at: iso(om.createdAt), updated_at: iso(om.updatedAt) };
	return {
		id: om.id,
		name: om.name,
		description: om.description ?? '',
		lookup_key: om.key,
		metadata: userMetadata(om.metadata),
		tenant_id: '',
		status: mapAddonStatus(om.status),
		environment_id: '',
		created_by: '',
		updated_by: '',
		created_at: base.created_at,
		updated_at: base.updated_at,
		prices: om.rateCards.map((card) => mapRateCardToPrice(card, om)).filter((p): p is Price => p !== undefined),
		entitlements: om.rateCards
			.filter(isEntitlementCard)
			.map((card) =>
				synthEntitlementFromCard(
					card,
					ENTITLEMENT_ENTITY_TYPE.ADDON,
					om.id,
					resolveFeature(features, card.featureKey, card.entitlementTemplate?.type ?? 'static'),
					base,
				),
			),
	};
}

/** OM addon → Flexprice Addon（列表/表格用，丢弃 prices/entitlements 展开）。 */
export function mapOmAddonToModel(om: OmAddon): Addon {
	return {
		id: om.id,
		name: om.name,
		description: om.description ?? '',
		lookup_key: om.key,
		metadata: userMetadata(om.metadata),
		tenant_id: '',
		status: mapAddonStatus(om.status),
		environment_id: '',
		created_by: '',
		updated_by: '',
		created_at: iso(om.createdAt),
		updated_at: iso(om.updatedAt),
	};
}

/** Flexprice CreateAddonRequest → OM AddonCreate；OM 必填的 instanceType/currency/rateCards 取安全缺省。 */
export function buildOmAddonCreate(req: CreateAddonRequest): OmAddonCreate {
	return {
		name: req.name,
		key: req.lookup_key,
		...(req.description !== undefined ? { description: req.description } : {}),
		...(req.metadata && Object.keys(req.metadata).length ? { metadata: { ...req.metadata } } : {}),
		// Flexprice addon 无多实例/币种概念；single + USD + 空价格卡为最小可创建组合
		instanceType: 'single',
		currency: 'USD',
		rateCards: [],
	};
}

/**
 * Flexprice UpdateAddonRequest → OM AddonReplaceUpdate（整对象替换）。
 * 未提供的字段取现值；rateCards/instanceType/currency 不可经 Flexprice 修改，原样保留。
 */
export function buildOmAddonUpdate(current: OmAddon, req: UpdateAddonRequest): OmAddonReplaceUpdate {
	const description = req.description !== undefined ? req.description : current.description;
	const metadata =
		req.metadata !== undefined ? (Object.keys(req.metadata).length ? { ...req.metadata } : null) : (current.metadata ?? null);
	return {
		name: req.name ?? current.name,
		...(description !== undefined ? { description } : {}),
		...(metadata !== null ? { metadata } : {}),
		instanceType: current.instanceType,
		rateCards: current.rateCards,
	};
}

/** entitlement 手术用：只替换 rateCards，其余取现值。 */
export function buildAddonReplaceUpdateWithCards(addon: OmAddon, rateCards: OmAddon['rateCards']): OmAddonReplaceUpdate {
	return {
		name: addon.name,
		...(addon.description !== undefined ? { description: addon.description } : {}),
		...(addon.metadata !== undefined && addon.metadata !== null ? { metadata: addon.metadata } : {}),
		instanceType: addon.instanceType,
		rateCards,
	};
}
