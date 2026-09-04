// src/core/services/openmeter/mappers/price.ts
// OM plan phases[].rateCards ↔ Flexprice Price 双向映射。
// OM v2 无独立价格资源：价格挂在计划的 rate card 上，读侧从 rateCards 合成
// Flexprice Price 列表；合成价格 id 用 `${planId}:${phaseKey}:${rateCardKey}` 复合寻址，
// 写侧（增/改/删）落回「取计划 → 改首 phase 的 rateCards → 整体 update」。
import { ENTITY_STATUS } from '@/models';
import type { Metadata } from '@/models';
import type { Tier } from '@/models/Price';
import { BILLING_MODEL, PRICE_ENTITY_TYPE, PRICE_TYPE, PRICE_UNIT_TYPE, TIER_MODE, BILLING_PERIOD } from '@/models/Price';
import { BILLING_CADENCE, INVOICE_CADENCE } from '@/models/Invoice';
import type { CreatePriceRequest, PriceResponse, UpdatePriceRequest } from '@/types/dto';
import { iso } from './common';
import type { OmPlan } from './plan';

export type OmPlanPhase = OmPlan['phases'][number];
export type OmRateCard = OmPlanPhase['rateCards'][number];
export type OmFlatFeeCard = Extract<OmRateCard, { type: 'flat_fee' }>;
export type OmUsageBasedCard = Extract<OmRateCard, { type: 'usage_based' }>;

/** 复合价格 id 分隔符（ULID 与 slug key 均不含 ':'）。 */
const PRICE_ID_SEPARATOR = ':';

let warnedDroppedPriceFields = false;
/** 结构可映射但个别字段（meter_id 等）无 OM 对应：丢弃并 warn 一次。 */
function warnDroppedPriceFieldsOnce(fields: string) {
	if (warnedDroppedPriceFields) return;
	warnedDroppedPriceFields = true;
	console.warn(`[openmeter/price] OM 计划价格卡无对应字段，以下字段将被丢弃：${fields}`);
}

export function buildPriceId(planId: string, phaseKey: string, rateCardKey: string): string {
	return [planId, phaseKey, rateCardKey].join(PRICE_ID_SEPARATOR);
}

/** 解析复合价格 id；格式不符返回 null。 */
export function parsePriceId(id: string): { planId: string; phaseKey: string; rateCardKey: string } | null {
	const parts = id.split(PRICE_ID_SEPARATOR);
	if (parts.length !== 3 || parts.some((p) => !p)) return null;
	return { planId: parts[0], phaseKey: parts[1], rateCardKey: parts[2] };
}

/** OM ISO-8601 billingCadence → models.BILLING_PERIOD（dto/Price 用 models 侧枚举，与 constants 侧同名枚举不同源）。 */
function cadenceToPriceBillingPeriod(cadence: string | undefined): BILLING_PERIOD {
	switch (cadence) {
		case 'P1D':
			return BILLING_PERIOD.DAILY;
		case 'P1W':
			return BILLING_PERIOD.WEEKLY;
		case 'P1M':
			return BILLING_PERIOD.MONTHLY;
		case 'P3M':
			return BILLING_PERIOD.QUARTERLY;
		case 'P6M':
			return BILLING_PERIOD.HALF_YEARLY;
		case 'P1Y':
			return BILLING_PERIOD.ANNUAL;
		default:
			return BILLING_PERIOD.MONTHLY;
	}
}

/** models.BILLING_PERIOD → OM ISO-8601 billingCadence；ONETIME → null（一次性费用）。 */
export function billingPeriodToCadence(period: BILLING_PERIOD | undefined): string | null {
	switch (period) {
		case BILLING_PERIOD.DAILY:
			return 'P1D';
		case BILLING_PERIOD.WEEKLY:
			return 'P1W';
		case BILLING_PERIOD.MONTHLY:
			return 'P1M';
		case BILLING_PERIOD.QUARTERLY:
			return 'P3M';
		case BILLING_PERIOD.HALF_YEARLY:
			return 'P6M';
		case BILLING_PERIOD.ANNUAL:
			return 'P1Y';
		case BILLING_PERIOD.ONETIME:
			return null;
		default:
			return 'P1M';
	}
}

/** OM 价格变体 → Flexprice 展示金额（tiered 取首档单价，dynamic 无静态金额取 0）。 */
function omCardAmount(card: OmRateCard): string {
	const price = card.price;
	if (!price) return '0';
	switch (price.type) {
		case 'flat':
		case 'unit':
		case 'package':
			return price.amount;
		case 'tiered':
			return price.tiers[0]?.unitPrice?.amount ?? price.tiers[0]?.flatPrice?.amount ?? '0';
		case 'dynamic':
			return '0';
	}
}

/** OM tier mode（volume/graduated）→ Flexprice TIER_MODE。 */
function mapOmTierMode(mode: 'volume' | 'graduated' | undefined): TIER_MODE {
	return mode === 'graduated' ? TIER_MODE.SLAB : TIER_MODE.VOLUME;
}

/** OM PriceTier[] → Flexprice Tier[]（开放式末档 up_to 用 MAX_SAFE_INTEGER，UI 对末档一律渲染为开放式）。 */
function mapOmTiers(
	tiers: { upToAmount?: string; flatPrice: { amount: string } | null; unitPrice: { amount: string } | null }[] | undefined,
): Tier[] | null {
	if (!tiers?.length) return null;
	return tiers.map((tier) => ({
		flat_amount: tier.flatPrice?.amount ?? '0',
		unit_amount: tier.unitPrice?.amount ?? '0',
		up_to: tier.upToAmount !== undefined ? Number(tier.upToAmount) : Number.MAX_SAFE_INTEGER,
	}));
}

/**
 * OM rate card → Flexprice PriceResponse（合成）。
 * 计费模型映射：flat_fee→FIXED/FLAT_FEE；usage_based+unit→USAGE/FLAT_FEE（按单位计价，
 * UI 渲染 "$x / unit"）；usage_based+package→USAGE/PACKAGE（divide_by=quantityPerPackage）；
 * usage_based+tiered→USAGE/TIERED；usage_based+flat→FIXED/FLAT_FEE（周期固定费，
 * 借用 FIXED 展示以避免被渲染成 "/ unit"）。meter_id 恒为空串（OM 价格卡挂 feature 不挂 meter）。
 */
export function mapOmRateCardToPrice(plan: OmPlan, phase: OmPlanPhase, card: OmRateCard): PriceResponse {
	const cadence = card.billingCadence ?? (card.type === 'usage_based' ? plan.billingCadence : undefined);
	const isOneTime = card.type === 'flat_fee' && card.billingCadence === null;
	const price = card.price;

	let type: PRICE_TYPE;
	let billingModel: BILLING_MODEL;
	let tiers: Tier[] | null = null;
	let tierMode: TIER_MODE = TIER_MODE.VOLUME;
	let transformQuantity: PriceResponse['transform_quantity'] = null;

	if (card.type === 'flat_fee') {
		type = PRICE_TYPE.FIXED;
		billingModel = BILLING_MODEL.FLAT_FEE;
	} else if (price?.type === 'package') {
		type = PRICE_TYPE.USAGE;
		billingModel = BILLING_MODEL.PACKAGE;
		transformQuantity = { divide_by: Number(price.quantityPerPackage) || 1, round: 'up' };
	} else if (price?.type === 'tiered') {
		type = PRICE_TYPE.USAGE;
		billingModel = BILLING_MODEL.TIERED;
		tiers = mapOmTiers(price.tiers);
		tierMode = mapOmTierMode(price.mode);
	} else if (price?.type === 'flat') {
		// usage_based 卡上的 flat 价是「按周期固定费」，映射为 FIXED 以获得正确的金额展示
		type = PRICE_TYPE.FIXED;
		billingModel = BILLING_MODEL.FLAT_FEE;
	} else {
		type = PRICE_TYPE.USAGE;
		billingModel = BILLING_MODEL.FLAT_FEE;
	}

	const amount = omCardAmount(card);
	// flat 价的 paymentTerm 决定开票时机；usage_based 侧按行业惯例默认后付
	const invoiceCadence: PriceResponse['invoice_cadence'] =
		card.type === 'flat_fee' && card.price?.type === 'flat' && card.price.paymentTerm === 'in_arrears'
			? INVOICE_CADENCE.ARREAR
			: card.type === 'usage_based'
				? INVOICE_CADENCE.ARREAR
				: INVOICE_CADENCE.ADVANCE;
	return {
		id: buildPriceId(plan.id, phase.key, card.key),
		amount,
		display_amount: amount,
		currency: plan.currency,
		entity_type: PRICE_ENTITY_TYPE.PLAN,
		entity_id: plan.id,
		type,
		price_unit_type: PRICE_UNIT_TYPE.FIAT,
		billing_period: isOneTime ? BILLING_PERIOD.ONETIME : cadenceToPriceBillingPeriod(cadence ?? plan.billingCadence),
		billing_period_count: 1,
		billing_model: billingModel,
		display_name: card.name,
		billing_cadence: isOneTime ? BILLING_CADENCE.ONETIME : BILLING_CADENCE.RECURRING,
		tier_mode: tierMode,
		tiers,
		price_unit_tiers: null,
		meter_id: '',
		filter_values: null,
		lookup_key: card.key,
		description: card.description ?? '',
		transform_quantity: transformQuantity,
		invoice_cadence: invoiceCadence,
		metadata: (card.metadata as Metadata | null) ?? null,
		status: ENTITY_STATUS.PUBLISHED,
		tenant_id: '',
		environment_id: '',
		created_by: '',
		updated_by: '',
		created_at: iso(plan.createdAt),
		updated_at: iso(plan.updatedAt),
	};
}

/** 计划全部 phase 的 rateCards 合成为 Flexprice Price 列表。 */
export function mapOmPlanToPrices(plan: OmPlan): PriceResponse[] {
	return plan.phases.flatMap((phase) => phase.rateCards.map((card) => mapOmRateCardToPrice(plan, phase, card)));
}

/** OM tiered 价格变体（tiers 数组类型从这里派生）。 */
type OmTieredPrice = Extract<NonNullable<OmUsageBasedCard['price']>, { type: 'tiered' }>;

/** Flexprice tier → OM PriceTier（开放式末档 up_to 省略）。 */
function toOmPriceTiers(tiers: { up_to?: number | null; unit_amount: string; flat_amount?: string }[]): OmTieredPrice['tiers'] {
	return tiers.map((tier) => ({
		...(tier.up_to !== undefined && tier.up_to !== null ? { upToAmount: String(tier.up_to) } : {}),
		flatPrice: tier.flat_amount ? { type: 'flat' as const, amount: tier.flat_amount } : null,
		unitPrice: { type: 'unit' as const, amount: tier.unit_amount },
	}));
}

/**
 * Flexprice CreatePriceRequest → OM rate card。
 * 只承载 entity_type=PLAN 的价格；结构无法映射（自定义计价单位等）时 throw，
 * 字段级缺省（meter_id/filter_values 等）丢弃并 warn 一次。
 */
export function buildOmRateCardFromCreatePrice(req: CreatePriceRequest): OmRateCard {
	if (req.entity_type !== PRICE_ENTITY_TYPE.PLAN) {
		throw new Error(`OpenMeter 暂不支持该价格创建：entity_type=${req.entity_type} 无 OM 对应`);
	}
	if (req.price_unit_type === PRICE_UNIT_TYPE.CUSTOM || req.price_unit_config) {
		throw new Error('OpenMeter 暂不支持该价格创建：自定义计价单位（CUSTOM price unit）无 OM 对应');
	}
	const hasDroppedFields =
		!!req.meter_id ||
		!!(req.filter_values && Object.keys(req.filter_values).length) ||
		req.min_quantity !== undefined ||
		req.trial_period_days !== undefined ||
		!!req.start_date ||
		!!req.end_date ||
		!!req.group_id;
	if (hasDroppedFields) {
		warnDroppedPriceFieldsOnce('meter_id / filter_values / min_quantity / trial_period_days / start_date / end_date / group_id');
	}

	const key =
		req.lookup_key?.trim() ||
		(req.display_name
			? req.display_name
					.toLowerCase()
					.replace(/[^a-z0-9_]+/g, '_')
					.replace(/^_+|_+$/g, '')
			: '') ||
		`price_${Date.now().toString(36)}`;
	const name = req.display_name?.trim() || key;
	const amount = req.amount ?? '0';
	const cadence = billingPeriodToCadence(req.billing_period);

	if (req.type === PRICE_TYPE.FIXED) {
		if (req.billing_model !== BILLING_MODEL.FLAT_FEE) {
			throw new Error(`OpenMeter 暂不支持该价格创建：FIXED 价格仅支持 FLAT_FEE，收到 ${req.billing_model}`);
		}
		const card: OmFlatFeeCard = {
			type: 'flat_fee',
			key,
			name,
			...(req.description ? { description: req.description } : {}),
			...(req.metadata && Object.keys(req.metadata).length ? { metadata: { ...req.metadata } } : {}),
			billingCadence: cadence,
			price: { type: 'flat', amount },
		};
		return card;
	}

	// USAGE 价格 → usage_based 卡
	const usageCadence = cadence ?? 'P1M';
	let price: NonNullable<OmUsageBasedCard['price']>;
	switch (req.billing_model) {
		case BILLING_MODEL.FLAT_FEE:
			// Flexprice USAGE+FLAT_FEE 语义是按单位计价 → OM unit price
			price = { type: 'unit', amount };
			break;
		case BILLING_MODEL.PACKAGE:
			price = {
				type: 'package',
				amount,
				quantityPerPackage: String(req.transform_quantity?.divide_by ?? 1),
			};
			break;
		case BILLING_MODEL.TIERED: {
			if (!req.tiers?.length) throw new Error('OpenMeter 暂不支持该价格创建：TIERED 价格缺少 tiers');
			price = {
				type: 'tiered',
				mode: req.tier_mode === TIER_MODE.SLAB ? 'graduated' : 'volume',
				tiers: toOmPriceTiers(req.tiers),
			};
			break;
		}
		default:
			throw new Error(`OpenMeter 暂不支持该价格创建：未知计费模型 ${req.billing_model}`);
	}
	const card: OmUsageBasedCard = {
		type: 'usage_based',
		key,
		name,
		...(req.description ? { description: req.description } : {}),
		...(req.metadata && Object.keys(req.metadata).length ? { metadata: { ...req.metadata } } : {}),
		billingCadence: usageCadence,
		price,
	};
	return card;
}

/** UpdatePriceRequest 中 OM 无法承载的字段：出现即明确报错，禁止假成功。 */
const UNSUPPORTED_UPDATE_FIELDS: { key: keyof UpdatePriceRequest; label: string }[] = [
	{ key: 'lookup_key', label: 'lookup_key' },
	{ key: 'effective_from', label: 'effective_from' },
	{ key: 'price_unit_amount', label: 'price_unit_amount' },
	{ key: 'price_unit_tiers', label: 'price_unit_tiers' },
	{ key: 'group_id', label: 'group_id' },
	{ key: 'bucket_size', label: 'bucket_size' },
];

/**
 * 将 Flexprice UpdatePriceRequest 应用到 OM rate card（返回更新后的副本）。
 * 支持非关键字段（display_name/description/metadata）与可映射的关键字段
 * （amount/billing_model/tier_mode/tiers/transform_quantity 重建价格对象）；
 * 固定费用卡不允许切换计费模型（会改变 entitlement 语义）。
 */
export function applyOmRateCardUpdate(card: OmRateCard, req: UpdatePriceRequest): OmRateCard {
	const unsupported = UNSUPPORTED_UPDATE_FIELDS.filter(({ key }) => req[key] !== undefined).map(({ label }) => label);
	if (unsupported.length) {
		throw new Error(`OpenMeter 暂不支持该价格卡编辑：${unsupported.join('、')} 无 OM 对应`);
	}

	const next: OmRateCard = structuredClone(card);
	if (req.display_name !== undefined) next.name = req.display_name;
	if (req.description !== undefined) next.description = req.description;
	if (req.metadata !== undefined) next.metadata = Object.keys(req.metadata).length ? { ...req.metadata } : null;

	const rebuildsPrice =
		req.amount !== undefined ||
		req.billing_model !== undefined ||
		req.tier_mode !== undefined ||
		req.tiers !== undefined ||
		req.transform_quantity !== undefined;
	if (!rebuildsPrice) return next;

	const targetModel = req.billing_model ?? (card.type === 'flat_fee' ? BILLING_MODEL.FLAT_FEE : flexModelOfCard(card));
	const amount = req.amount ?? omCardAmount(card);

	if (card.type === 'flat_fee') {
		if (targetModel !== BILLING_MODEL.FLAT_FEE) {
			throw new Error('OpenMeter 暂不支持该价格卡编辑：固定费用价格卡不支持切换计费模型');
		}
		next.price = { type: 'flat', amount };
		return next;
	}

	const usage = next as OmUsageBasedCard;
	switch (targetModel) {
		case BILLING_MODEL.FLAT_FEE:
			usage.price = { type: 'unit', amount };
			break;
		case BILLING_MODEL.PACKAGE: {
			const quantity = req.transform_quantity?.divide_by ?? (card.price?.type === 'package' ? Number(card.price.quantityPerPackage) : 1);
			usage.price = { type: 'package', amount, quantityPerPackage: String(quantity || 1) };
			break;
		}
		case BILLING_MODEL.TIERED: {
			const sourceTiers =
				req.tiers ??
				(card.price?.type === 'tiered'
					? card.price.tiers.map((t) => ({
							up_to: t.upToAmount !== undefined ? Number(t.upToAmount) : null,
							unit_amount: t.unitPrice?.amount ?? '0',
							flat_amount: t.flatPrice?.amount ?? undefined,
						}))
					: [{ up_to: null, unit_amount: amount, flat_amount: '0' }]);
			const mode = req.tier_mode ?? (card.price?.type === 'tiered' ? card.price.mode : undefined);
			usage.price = {
				type: 'tiered',
				mode: mode === 'graduated' ? 'graduated' : 'volume',
				tiers: toOmPriceTiers(sourceTiers),
			};
			break;
		}
		default:
			throw new Error(`OpenMeter 暂不支持该价格卡编辑：未知计费模型 ${String(targetModel)}`);
	}
	return next;
}

/** OM 卡 → Flexprice 计费模型（与 mapOmRateCardToPrice 的映射保持一致）。 */
function flexModelOfCard(card: OmRateCard): BILLING_MODEL {
	if (card.type === 'flat_fee') return BILLING_MODEL.FLAT_FEE;
	switch (card.price?.type) {
		case 'package':
			return BILLING_MODEL.PACKAGE;
		case 'tiered':
			return BILLING_MODEL.TIERED;
		default:
			return BILLING_MODEL.FLAT_FEE;
	}
}
