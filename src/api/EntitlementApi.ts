// src/api/EntitlementApi.ts
// OpenMeter 承载（概念错位域）：Flexprice entitlement 是目录定义型（PLAN/ADDON/SUBSCRIPTION +
// entity_id），OM 是 subject 实例型（客户挂 entitlement，目录定义住在 plan/addon 的 rate card
// entitlementTemplate 里）。映射策略见 mappers/entitlement.ts 头注释。
// - search：SUBSCRIPTION → 客户实例 entitlement；PLAN/ADDON → plan/addon rate card 合成；
//   无法判定 entity → 空列表（不猜）。
// - create/update/delete：SUBSCRIPTION → customers.entitlements / entitlementsV1.override；
//   PLAN/ADDON → plan/addon rate card 手术（整对象替换 update，不动价格卡）。
import { ENTITLEMENT_ENTITY_TYPE, ENTITLEMENT_USAGE_RESET_PERIOD, FEATURE_TYPE, type Feature } from '@/models';
import {
	EntitlementFilter,
	EntitlementResponse,
	CreateEntitlementRequest,
	CreateBulkEntitlementRequest,
	CreateBulkEntitlementResponse,
	UpdateEntitlementRequest,
	ListEntitlementsResponse,
} from '@/types/dto/Entitlement';
import { getOpenMeterClient, requireOpenMeterClient, type OpenMeterClient } from '@/core/services/openmeter';
import {
	buildEntitlementTemplate,
	buildOmSubjectEntitlementCreate,
	buildPlanReplaceUpdateWithPhases,
	fieldsFromTemplate,
	isEntitlementCard,
	mapOmSubjectEntitlement,
	parseSyntheticEntitlementId,
	phasesWithFirstPhaseGuard,
	removeEntitlementFromRateCards,
	resolveFeature,
	synthEntitlementFromCard,
	upsertEntitlementRateCards,
	type OmEntitlementTemplate,
	type OmEntitlementV2,
} from '@/core/services/openmeter/mappers/entitlement';
import { mapOmFeature, type OmFeature } from '@/core/services/openmeter/mappers/feature';
import { buildAddonReplaceUpdateWithCards, type OmAddon } from '@/core/services/openmeter/mappers/addon';
import { iso } from '@/core/services/openmeter/mappers/common';
import { DataType } from '@/types/common/QueryBuilder';
import type { TypedBackendFilter } from '@/types/formatters/QueryBuilder';

type CatalogEntityType = ENTITLEMENT_ENTITY_TYPE.PLAN | ENTITLEMENT_ENTITY_TYPE.ADDON;

class EntitlementApi {
	/**
	 * Create a new entitlement
	 * @param data - Entitlement configuration
	 * @returns Promise<EntitlementResponse>
	 */
	public static async create(data: CreateEntitlementRequest): Promise<EntitlementResponse> {
		const client = requireOpenMeterClient();
		const feature = await this.requireFeature(data.feature_id);
		switch (data.entity_type) {
			case ENTITLEMENT_ENTITY_TYPE.SUBSCRIPTION:
				return await this.createSubjectEntitlement(client, data, feature, Boolean(data.parent_entitlement_id));
			case ENTITLEMENT_ENTITY_TYPE.PLAN:
				return await this.upsertCatalogEntitlement(ENTITLEMENT_ENTITY_TYPE.PLAN, data, feature);
			case ENTITLEMENT_ENTITY_TYPE.ADDON:
				return await this.upsertCatalogEntitlement(ENTITLEMENT_ENTITY_TYPE.ADDON, data, feature);
		}
	}

	/**
	 * Create multiple entitlements in bulk
	 * @param data - Bulk entitlement configuration
	 * @returns Promise<CreateBulkEntitlementResponse>
	 */
	public static async createBulk(data: CreateBulkEntitlementRequest): Promise<CreateBulkEntitlementResponse> {
		// 顺序执行；中途失败即抛错（已创建的部分由 OM 保留，错误如实暴露）
		const items: EntitlementResponse[] = [];
		for (const item of data.items) {
			items.push(await this.create(item));
		}
		return { items };
	}

	/**
	 * Get an entitlement by ID
	 * @param id - Entitlement ID
	 * @returns Promise<EntitlementResponse>
	 */
	public static async get(id: string): Promise<EntitlementResponse> {
		const client = requireOpenMeterClient();
		const parsed = parseSyntheticEntitlementId(id);
		if (parsed) {
			return await this.synthCatalogEntitlement(parsed.entityType, parsed.entityId, parsed.featureKey);
		}
		const om = await client.entitlements.get(id);
		if (!om) throw new Error(`entitlement ${id} 不存在`);
		const features = (await client.features.list()) ?? [];
		return mapOmSubjectEntitlement(
			om,
			ENTITLEMENT_ENTITY_TYPE.SUBSCRIPTION,
			om.customerKey ?? om.customerId,
			resolveFeature(features, om.featureKey, om.type),
		);
	}

	/**
	 * Search entitlements with complex filters (POST /entitlements/search)
	 * @param filters - Complex filters, sorts, and pagination
	 * @returns Promise<ListEntitlementsResponse>
	 */
	public static async search(filters: EntitlementFilter): Promise<ListEntitlementsResponse> {
		const client = getOpenMeterClient();
		if (!client) return { items: [], pagination: { limit: filters.limit ?? 0, offset: filters.offset ?? 0, total: 0 } };
		// OM entitlement 恒为启用；显式要求 is_enabled=false 时无从匹配
		if (filters.is_enabled === false)
			return { items: [], pagination: { limit: filters.limit ?? 0, offset: filters.offset ?? 0, total: 0 } };

		const entityTypes = extractEntityTypes(filters);
		const entityIds = extractEntityIds(filters);
		if (entityTypes.length === 0) return { items: [], pagination: { limit: filters.limit ?? 0, offset: filters.offset ?? 0, total: 0 } };

		const features = (await client.features.list()) ?? [];
		let items: EntitlementResponse[] = [];

		if (entityTypes.includes(ENTITLEMENT_ENTITY_TYPE.SUBSCRIPTION)) {
			for (const subscriptionId of entityIds) {
				const subscription = await client.subscriptions.get(subscriptionId);
				if (!subscription) continue;
				const page = await client.customers.entitlements.list(subscription.customerId, { query: { pageSize: 100 } });
				for (const om of page?.items ?? []) {
					items.push(
						mapOmSubjectEntitlement(
							om,
							ENTITLEMENT_ENTITY_TYPE.SUBSCRIPTION,
							subscriptionId,
							resolveFeature(features, om.featureKey, om.type),
						),
					);
				}
			}
		}
		if (entityTypes.includes(ENTITLEMENT_ENTITY_TYPE.PLAN)) {
			const plans = entityIds.length
				? (await Promise.all(entityIds.map((id) => client.plans.get(id)))).filter((p): p is NonNullable<typeof p> => Boolean(p))
				: ((await client.plans.list({ pageSize: 100 }))?.items ?? []);
			for (const plan of plans) {
				for (const card of plan.phases.flatMap((phase) => phase.rateCards).filter(isEntitlementCard)) {
					items.push(
						synthEntitlementFromCard(
							card,
							ENTITLEMENT_ENTITY_TYPE.PLAN,
							plan.id,
							resolveFeature(features, card.featureKey, card.entitlementTemplate?.type ?? 'static'),
							{
								created_at: iso(plan.createdAt),
								updated_at: iso(plan.updatedAt),
							},
						),
					);
				}
			}
		}
		if (entityTypes.includes(ENTITLEMENT_ENTITY_TYPE.ADDON)) {
			const addons = entityIds.length
				? (await Promise.all(entityIds.map((id) => client.addons.get(id)))).filter((a): a is NonNullable<typeof a> => Boolean(a))
				: ((await client.addons.list({ pageSize: 100 }))?.items ?? []);
			for (const addon of addons) {
				for (const card of addon.rateCards.filter(isEntitlementCard)) {
					items.push(
						synthEntitlementFromCard(
							card,
							ENTITLEMENT_ENTITY_TYPE.ADDON,
							addon.id,
							resolveFeature(features, card.featureKey, card.entitlementTemplate?.type ?? 'static'),
							{
								created_at: iso(addon.createdAt),
								updated_at: iso(addon.updatedAt),
							},
						),
					);
				}
			}
		}

		items = filterByFeatures(items, filters.feature_ids, features);
		const limit = filters.limit ?? items.length;
		const offset = filters.offset ?? 0;
		return {
			items: items.slice(offset, offset + limit),
			pagination: { limit, offset, total: items.length },
		};
	}

	/**
	 * Update an entitlement
	 * @param id - Entitlement ID
	 * @param data - Updated entitlement configuration
	 * @returns Promise<EntitlementResponse>
	 */
	public static async update(id: string, data: UpdateEntitlementRequest): Promise<EntitlementResponse> {
		const client = requireOpenMeterClient();
		const parsed = parseSyntheticEntitlementId(id);
		if (parsed) {
			// 目录型：读现卡模板 → 覆盖可变字段 → 重建模板写回
			const current = await this.currentTemplateOf(parsed.entityType, parsed.entityId, parsed.featureKey);
			const merged = mergeFields(
				fieldsFromTemplate(current, { feature_id: parsed.featureKey, entity_type: parsed.entityType, entity_id: parsed.entityId }),
				data,
			);
			const featureName = await this.featureNameOf(merged.feature_id, parsed.featureKey);
			await this.writeCatalogEntitlement(
				parsed.entityType,
				parsed.entityId,
				parsed.featureKey,
				buildEntitlementTemplate(merged),
				featureName,
			);
			return await this.synthCatalogEntitlement(parsed.entityType, parsed.entityId, parsed.featureKey);
		}
		// 实例型：OM entitlement 创建后不可改，只能 override（零停机替换）
		const om = await client.entitlements.get(id);
		if (!om) throw new Error(`entitlement ${id} 不存在`);
		const subject = om.customerKey ?? om.customerId;
		const merged = mergeFields(fieldsFromSubject(om), data);
		const input = buildOmSubjectEntitlementCreate(om.featureKey, merged);
		const overridden = await client.entitlementsV1.override(subject, id, input);
		if (!overridden) throw new Error('override entitlement 失败');
		const features = (await client.features.list()) ?? [];
		return mapOmSubjectEntitlement(
			{ ...overridden, customerId: subject, customerKey: subject } as OmEntitlementV2,
			ENTITLEMENT_ENTITY_TYPE.SUBSCRIPTION,
			subject,
			resolveFeature(features, overridden.featureKey, overridden.type),
		);
	}

	/**
	 * Delete an entitlement
	 * @param id - Entitlement ID
	 * @returns Promise<void>
	 */
	public static async delete(id: string): Promise<void> {
		const client = requireOpenMeterClient();
		const parsed = parseSyntheticEntitlementId(id);
		if (parsed) {
			await this.removeCatalogEntitlement(parsed.entityType, parsed.entityId, parsed.featureKey);
			return;
		}
		const om = await client.entitlements.get(id);
		if (!om) throw new Error(`entitlement ${id} 不存在`);
		await client.customers.entitlements.delete(om.customerKey ?? om.customerId, id);
	}

	// ============================================
	// 内部：feature 解析与两条写入通路
	// ============================================

	private static async requireFeature(featureId: string): Promise<Feature> {
		const om = await requireOpenMeterClient().features.get(featureId);
		if (!om) throw new Error(`feature ${featureId} 不存在`);
		return mapOmFeature(om);
	}

	private static async featureNameOf(featureId: string, fallback: string): Promise<string> {
		try {
			const om = await getOpenMeterClient()?.features.get(featureId);
			return om?.name ?? fallback;
		} catch {
			return fallback;
		}
	}

	private static async createSubjectEntitlement(
		client: OpenMeterClient,
		data: CreateEntitlementRequest,
		feature: Feature,
		isOverride: boolean,
	): Promise<EntitlementResponse> {
		const subscription = await client.subscriptions.get(data.entity_id);
		if (!subscription) throw new Error(`订阅 ${data.entity_id} 不存在`);
		const featureKey = feature.lookup_key ?? feature.id;
		const input = buildOmSubjectEntitlementCreate(featureKey, data);
		// parent_entitlement_id 语义是「替换目录 entitlement 而非叠加」→ OM override；否则新建
		const om = isOverride
			? await client.entitlementsV1.override(subscription.customerId, featureKey, input)
			: await client.customers.entitlements.create(subscription.customerId, input);
		if (!om) throw new Error('创建 entitlement 失败');
		if ('subjectKey' in om) {
			// entitlementsV1.override 返回 v1 形状（subjectKey、无 customerId），归一后走 v2 映射
			const normalized = { ...om, customerId: subscription.customerId, customerKey: subscription.customerId } as OmEntitlementV2;
			return mapOmSubjectEntitlement(normalized, ENTITLEMENT_ENTITY_TYPE.SUBSCRIPTION, data.entity_id, feature);
		}
		return mapOmSubjectEntitlement(om, ENTITLEMENT_ENTITY_TYPE.SUBSCRIPTION, data.entity_id, feature);
	}

	private static async upsertCatalogEntitlement(
		entityType: CatalogEntityType,
		data: CreateEntitlementRequest,
		feature: Feature,
	): Promise<EntitlementResponse> {
		const featureKey = feature.lookup_key ?? feature.id;
		const template = buildEntitlementTemplate(data);
		await this.writeCatalogEntitlement(entityType, data.entity_id, featureKey, template, feature.name);
		return await this.synthCatalogEntitlement(entityType, data.entity_id, featureKey);
	}

	/** 目录型写入：rate card 手术后由 synthCatalogEntitlement 回读合成（确认 OM 已接受）。 */
	private static async writeCatalogEntitlement(
		entityType: CatalogEntityType,
		entityId: string,
		featureKey: string,
		template: OmEntitlementTemplate,
		featureName: string,
	): Promise<void> {
		const client = requireOpenMeterClient();
		if (entityType === ENTITLEMENT_ENTITY_TYPE.PLAN) {
			const plan = await client.plans.get(entityId);
			if (!plan) throw new Error(`plan ${entityId} 不存在`);
			const phases = phasesWithFirstPhaseGuard(plan, (cards) => upsertEntitlementRateCards(cards, featureKey, template, featureName));
			if (!(await client.plans.update(entityId, buildPlanReplaceUpdateWithPhases(plan, phases))))
				throw new Error('写入 plan entitlement 失败');
			return;
		}
		const addon = await client.addons.get(entityId);
		if (!addon) throw new Error(`addon ${entityId} 不存在`);
		const rateCards = upsertEntitlementRateCards(addon.rateCards, featureKey, template, featureName);
		if (!(await client.addons.update(entityId, buildAddonReplaceUpdateWithCards(addon as OmAddon, rateCards))))
			throw new Error('写入 addon entitlement 失败');
	}

	private static async removeCatalogEntitlement(entityType: CatalogEntityType, entityId: string, featureKey: string): Promise<void> {
		const client = requireOpenMeterClient();
		if (entityType === ENTITLEMENT_ENTITY_TYPE.PLAN) {
			const plan = await client.plans.get(entityId);
			if (!plan) throw new Error(`plan ${entityId} 不存在`);
			const phases = phasesWithFirstPhaseGuard(plan, (cards) => removeEntitlementFromRateCards(cards, featureKey));
			if (!(await client.plans.update(entityId, buildPlanReplaceUpdateWithPhases(plan, phases))))
				throw new Error('删除 plan entitlement 失败');
			return;
		}
		const addon = await client.addons.get(entityId);
		if (!addon) throw new Error(`addon ${entityId} 不存在`);
		const rateCards = removeEntitlementFromRateCards(addon.rateCards, featureKey);
		if (!(await client.addons.update(entityId, buildAddonReplaceUpdateWithCards(addon as OmAddon, rateCards))))
			throw new Error('删除 addon entitlement 失败');
	}

	private static async currentTemplateOf(
		entityType: CatalogEntityType,
		entityId: string,
		featureKey: string,
	): Promise<OmEntitlementTemplate | null> {
		const client = requireOpenMeterClient();
		if (entityType === ENTITLEMENT_ENTITY_TYPE.PLAN) {
			const plan = await client.plans.get(entityId);
			if (!plan) throw new Error(`plan ${entityId} 不存在`);
			return plan.phases.flatMap((phase) => phase.rateCards).find((card) => card.featureKey === featureKey)?.entitlementTemplate ?? null;
		}
		const addon = await client.addons.get(entityId);
		if (!addon) throw new Error(`addon ${entityId} 不存在`);
		return addon.rateCards.find((card) => card.featureKey === featureKey)?.entitlementTemplate ?? null;
	}

	private static async synthCatalogEntitlement(
		entityType: CatalogEntityType,
		entityId: string,
		featureKey: string,
	): Promise<EntitlementResponse> {
		const client = requireOpenMeterClient();
		const template = await this.currentTemplateOf(entityType, entityId, featureKey);
		const features = (await client.features.list()) ?? [];
		const feature = resolveFeature(features, featureKey, template?.type ?? 'static');
		if (entityType === ENTITLEMENT_ENTITY_TYPE.PLAN) {
			const plan = await client.plans.get(entityId);
			if (!plan) throw new Error(`plan ${entityId} 不存在`);
			const card =
				plan.phases.flatMap((phase) => phase.rateCards).find((c) => c.featureKey === featureKey) ??
				({
					type: 'flat_fee',
					key: featureKey,
					name: feature.name,
					featureKey,
					billingCadence: null,
					price: null,
					...(template ? { entitlementTemplate: template } : {}),
				} as Parameters<typeof synthEntitlementFromCard>[0]);
			return synthEntitlementFromCard(card, ENTITLEMENT_ENTITY_TYPE.PLAN, entityId, feature, {
				created_at: iso(plan.createdAt),
				updated_at: iso(plan.updatedAt),
			});
		}
		const addon = await client.addons.get(entityId);
		if (!addon) throw new Error(`addon ${entityId} 不存在`);
		const card =
			addon.rateCards.find((c) => c.featureKey === featureKey) ??
			({
				type: 'flat_fee',
				key: featureKey,
				name: feature.name,
				featureKey,
				billingCadence: null,
				price: null,
				...(template ? { entitlementTemplate: template } : {}),
			} as Parameters<typeof synthEntitlementFromCard>[0]);
		return synthEntitlementFromCard(card, ENTITLEMENT_ENTITY_TYPE.ADDON, entityId, feature, {
			created_at: iso(addon.createdAt),
			updated_at: iso(addon.updatedAt),
		});
	}
}

// ============================================
// 过滤器解析（TypedBackendFilter 子集）
// ============================================

function extractEntityTypes(filters: EntitlementFilter): ENTITLEMENT_ENTITY_TYPE[] {
	const types = new Set<ENTITLEMENT_ENTITY_TYPE>();
	if (filters.entity_type) types.add(filters.entity_type);
	for (const f of filters.filters ?? []) {
		if (f.field !== 'entity_type') continue;
		collectFilterValues(f, (v) => {
			if (v === ENTITLEMENT_ENTITY_TYPE.PLAN || v === ENTITLEMENT_ENTITY_TYPE.SUBSCRIPTION || v === ENTITLEMENT_ENTITY_TYPE.ADDON)
				types.add(v);
		});
	}
	return [...types];
}

function extractEntityIds(filters: EntitlementFilter): string[] {
	const ids = new Set<string>();
	for (const id of filters.entity_ids ?? []) ids.add(id);
	for (const f of filters.filters ?? []) {
		if (f.field !== 'entity_id') continue;
		collectFilterValues(f, (v) => ids.add(v));
	}
	return [...ids];
}

function collectFilterValues(f: TypedBackendFilter, add: (value: string) => void): void {
	if (f.data_type === DataType.STRING && typeof f.value?.string === 'string') {
		add(f.value.string);
	} else if (f.data_type === DataType.ARRAY && Array.isArray(f.value?.array)) {
		for (const v of f.value?.array ?? []) add(String(v));
	}
}

/** feature_ids 过滤：按 OM feature 的 id 与 key 双向匹配。 */
function filterByFeatures(items: EntitlementResponse[], featureIds: string[] | undefined, features: OmFeature[]): EntitlementResponse[] {
	if (!featureIds?.length) return items;
	const keys = new Set<string>(featureIds);
	for (const id of featureIds) {
		const om = features.find((f) => f.id === id);
		if (om) keys.add(om.key);
	}
	return items.filter((ent) => keys.has(ent.feature_id) || (ent.feature.lookup_key != null && keys.has(ent.feature.lookup_key)));
}

// ============================================
// 更新合并：现值（模板/实例）+ UpdateEntitlementRequest → Create 形状
// ============================================

function fieldsFromSubject(om: OmEntitlementV2): CreateEntitlementRequest {
	return {
		feature_id: om.featureId,
		feature_type: om.type === 'metered' ? FEATURE_TYPE.METERED : om.type === 'boolean' ? FEATURE_TYPE.BOOLEAN : FEATURE_TYPE.STATIC,
		entity_type: ENTITLEMENT_ENTITY_TYPE.SUBSCRIPTION,
		entity_id: om.customerKey ?? om.customerId,
		is_enabled: true,
		is_soft_limit: om.type === 'metered' ? (om.isSoftLimit ?? false) : false,
		usage_limit: om.type === 'metered' ? (om.issue?.amount ?? om.issueAfterReset ?? null) : null,
		usage_reset_period: resetPeriodFromString(om.usagePeriod ? String(om.usagePeriod.interval) : undefined),
		...(om.type === 'static' ? { static_value: om.config } : {}),
	};
}

function resetPeriodFromString(interval: string | undefined): ENTITLEMENT_USAGE_RESET_PERIOD | undefined {
	switch (interval?.toUpperCase()) {
		case 'DAY':
			return ENTITLEMENT_USAGE_RESET_PERIOD.DAILY;
		case 'WEEK':
			return ENTITLEMENT_USAGE_RESET_PERIOD.WEEKLY;
		case 'MONTH':
			return ENTITLEMENT_USAGE_RESET_PERIOD.MONTHLY;
		case 'YEAR':
			return ENTITLEMENT_USAGE_RESET_PERIOD.ANNUAL;
		default:
			return undefined;
	}
}

function mergeFields(current: CreateEntitlementRequest, data: UpdateEntitlementRequest): CreateEntitlementRequest {
	const featureType =
		data.feature_type ??
		current.feature_type ??
		(data.usage_limit != null || current.usage_limit != null ? FEATURE_TYPE.METERED : FEATURE_TYPE.STATIC);
	return {
		feature_id: data.feature_id ?? current.feature_id,
		feature_type: featureType,
		entity_type: data.entity_type ?? current.entity_type,
		entity_id: data.entity_id ?? current.entity_id,
		is_enabled: true,
		is_soft_limit: data.is_soft_limit ?? current.is_soft_limit ?? false,
		usage_limit: data.usage_limit !== undefined ? data.usage_limit : (current.usage_limit ?? null),
		usage_reset_period: data.usage_reset_period ?? current.usage_reset_period,
		static_value: data.static_value ?? current.static_value,
		config_value: data.config_value ?? current.config_value,
	};
}

export default EntitlementApi;
