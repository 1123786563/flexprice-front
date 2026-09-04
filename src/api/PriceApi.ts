// src/api/PriceApi.ts
// OpenMeter 承载：价格无独立资源，全部落在 plan phases[].rateCards 上。
// 读：从 OM plan 合成 Flexprice Price（id 为 `${planId}:${phaseKey}:${rateCardKey}` 复合寻址）；
// 写：取计划 → 改首 phase 的 rateCards → 整体 update。非 PLAN 实体价格与调度式删除明确报错/空态。
import {
	CreatePriceRequest,
	UpdatePriceRequest,
	CreateBulkPriceRequest,
	CreateBulkPriceResponse,
	PriceResponse,
	DeletePriceRequest,
	SearchPricesRequest,
	SearchPricesResponse,
	PriceFilter,
	GetAllPricesResponse,
} from '@/types/dto';
import { PRICE_ENTITY_TYPE } from '@/models';
import type { TypedBackendFilter } from '@/types/formatters/QueryBuilder';
import { DataType, FilterOperator } from '@/types/common/QueryBuilder';
import { getOpenMeterClient, requireOpenMeterClient, type OpenMeterClient } from '@/core/services/openmeter';
import { buildOmPlanUpdate, type OmPlan, type OmPlanReplaceUpdate } from '@/core/services/openmeter/mappers/plan';
import {
	mapOmPlanToPrices,
	mapOmRateCardToPrice,
	parsePriceId,
	buildOmRateCardFromCreatePrice,
	applyOmRateCardUpdate,
	type OmPlanPhase,
	type OmRateCard,
} from '@/core/services/openmeter/mappers/price';

export class PriceApi {
	/**
	 * List prices with optional filters
	 * OM 侧只承载 PLAN 实体价格；price_ids 按复合 id 解析，status/meter_ids 客户端过滤，
	 * subscription_id/parent_price_id/时间范围无 OM 对应（静默忽略，合成价格无失效期恒为活跃）。
	 * @param filters - Optional price filters
	 * @returns Promise<GetAllPricesResponse>
	 */
	public static async ListPrices(filters: PriceFilter = {}): Promise<GetAllPricesResponse> {
		const client = getOpenMeterClient();
		if (!client) return { items: [], limit: 0, offset: 0, total: 0 };
		const plans = await this.loadScopedPlans(client, filters.entity_type, filters.entity_ids, filters.price_ids);
		let items = plans.flatMap(mapOmPlanToPrices);
		if (filters.price_ids?.length) {
			const ids = new Set(filters.price_ids);
			items = items.filter((p) => ids.has(p.id));
		}
		if (filters.meter_ids?.length) {
			// OM 价格卡挂 feature 不挂 meter：合成价格 meter_id 恒为空串，按 meter 过滤必然为空
			const meters = new Set(filters.meter_ids);
			items = items.filter((p) => meters.has(p.meter_id));
		}
		if (filters.status !== undefined) {
			items = items.filter((p) => p.status === filters.status);
		}
		return paginatePrices(items, filters.limit ?? items.length, filters.offset ?? 0);
	}

	/**
	 * Get a price by ID with expanded meter and price unit information
	 * id 为 `${planId}:${phaseKey}:${rateCardKey}` 复合 id；meter 无 OM 对应（恒空）。
	 * @param id - Price ID
	 * @returns Promise<PriceResponse>
	 */
	public static async GetPriceById(id: string): Promise<PriceResponse> {
		const parsed = parsePriceId(id);
		if (!parsed) throw new Error(`非法的价格 id：${id}`);
		const om = await requireOpenMeterClient().plans.get(parsed.planId);
		if (!om) throw new Error(`价格 ${id} 所属计划不存在`);
		const located = locateRateCard(om, parsed.phaseKey, parsed.rateCardKey);
		if (!located) throw new Error(`价格 ${id} 不存在`);
		return mapOmRateCardToPrice(om, located.phase, located.card);
	}

	/**
	 * Create a new price with the specified configuration
	 * Supports both regular and price unit configurations
	 * 映射为向计划首 phase 追加 rate card；CUSTOM 计价单位等无法映射的结构明确报错。
	 * @param data - Price configuration
	 * @returns Promise<PriceResponse>
	 */
	public static async CreatePrice(data: CreatePriceRequest): Promise<PriceResponse> {
		const res = await this.CreateBulkPrice({ items: [data] });
		return res.items[0];
	}

	/**
	 * Create multiple prices in bulk with the specified configurations
	 * Supports both regular and price unit configurations
	 * 同一计划的多个价格合并为一次 plan update（首 phase 追加多张 rate card）。
	 * @param data - Bulk price configuration
	 * @returns Promise<CreateBulkPriceResponse>
	 */
	public static async CreateBulkPrice(data: CreateBulkPriceRequest): Promise<CreateBulkPriceResponse> {
		const client = requireOpenMeterClient();
		if (!data.items.length) return { items: [] };

		// 按目标计划分组，保持请求顺序
		const itemsByPlan = new Map<string, CreatePriceRequest[]>();
		for (const item of data.items) {
			if (item.entity_type !== PRICE_ENTITY_TYPE.PLAN) {
				throw new Error(`OpenMeter 暂不支持该价格创建：entity_type=${item.entity_type} 无 OM 对应`);
			}
			const list = itemsByPlan.get(item.entity_id) ?? [];
			list.push(item);
			itemsByPlan.set(item.entity_id, list);
		}

		const created: PriceResponse[] = [];
		for (const [planId, planItems] of itemsByPlan) {
			const current: OmPlan | undefined = await client.plans.get(planId);
			if (!current) throw new Error(`价格所属计划 ${planId} 不存在`);
			const newCards = planItems.map((item) => buildOmRateCardFromCreatePrice(item));
			const updated = await this.writePlanRateCards(client, current, (phases) =>
				phases.map((phase, index) => (index === 0 ? { ...phase, rateCards: [...phase.rateCards, ...newCards] } : phase)),
			);
			// 响应计划首 phase 末尾的 N 张卡即本次新建（按追加顺序回读）
			const firstPhase = updated.phases[0];
			const appended = firstPhase ? firstPhase.rateCards.slice(-newCards.length) : [];
			for (const card of appended) created.push(mapOmRateCardToPrice(updated, firstPhase, card));
		}
		return { items: created };
	}

	/**
	 * Update a price with the specified configuration
	 * Critical fields (amount, billing_model, tier_mode, tiers, transform_quantity)
	 * will create a new price version if effective_from is provided
	 * 非关键字段直接改 rate card；可映射关键字段重建价格对象；effective_from/bucket_size 等
	 * 无 OM 对应的字段出现即报错（禁止假成功）。
	 * @param id - Price ID
	 * @param data - Price configuration updates
	 * @returns Promise<PriceResponse>
	 */
	public static async UpdatePrice(id: string, data: UpdatePriceRequest): Promise<PriceResponse> {
		const parsed = parsePriceId(id);
		if (!parsed) throw new Error(`非法的价格 id：${id}`);
		const client = requireOpenMeterClient();
		const current: OmPlan | undefined = await client.plans.get(parsed.planId);
		if (!current) throw new Error(`价格 ${id} 所属计划不存在`);
		const located = locateRateCard(current, parsed.phaseKey, parsed.rateCardKey);
		if (!located) throw new Error(`价格 ${id} 不存在`);
		const nextCard = applyOmRateCardUpdate(located.card, data);
		const phaseIndex = current.phases.findIndex((phase) => phase.key === parsed.phaseKey);
		const updated = await this.writePlanRateCards(client, current, (phases) =>
			phases.map((phase, index) =>
				index === phaseIndex
					? { ...phase, rateCards: phase.rateCards.map((card) => (card.key === parsed.rateCardKey ? nextCard : card)) }
					: phase,
			),
		);
		const updatedPhase = updated.phases[phaseIndex];
		const updatedCard = updatedPhase?.rateCards.find((card) => card.key === parsed.rateCardKey);
		if (!updatedPhase || !updatedCard) throw new Error('更新价格失败');
		return mapOmRateCardToPrice(updated, updatedPhase, updatedCard);
	}

	/**
	 * Delete a price
	 * 立即删除 = 从 phase 移除 rate card；调度式删除（end_date）无 OM 对应，明确报错。
	 * @param id - Price ID
	 * @param data - Optional delete configuration with end_date
	 * @returns Promise<void>
	 */
	public static async DeletePrice(id: string, data?: DeletePriceRequest): Promise<void> {
		if (data?.end_date) {
			throw new Error('OpenMeter 暂不支持该价格的调度式删除（end_date）：仅支持立即删除');
		}
		const parsed = parsePriceId(id);
		if (!parsed) throw new Error(`非法的价格 id：${id}`);
		const client = requireOpenMeterClient();
		const current: OmPlan | undefined = await client.plans.get(parsed.planId);
		if (!current) return;
		if (!locateRateCard(current, parsed.phaseKey, parsed.rateCardKey)) return;
		await this.writePlanRateCards(client, current, (phases) =>
			phases.map((phase) =>
				phase.key === parsed.phaseKey ? { ...phase, rateCards: phase.rateCards.filter((card) => card.key !== parsed.rateCardKey) } : phase,
			),
		);
	}

	/**
	 * Search prices by entity and filters (POST /prices/search)
	 * entity_type/entity_id（含 IN）用于圈定计划范围；display_name/type/billing_model 等字符串
	 * 条件与 amount 数值条件客户端执行；allow_expired_prices 为 no-op（合成价格无失效期）。
	 * 非 PLAN 实体（ADDON/SUBSCRIPTION/COSTSHEET…）无 OM 对应，返回空集。
	 * @param payload - entity_ids, entity_type, filters, allow_expired_prices, limit, offset
	 * @returns Promise<SearchPricesResponse>
	 */
	public static async searchPrices(payload: SearchPricesRequest): Promise<SearchPricesResponse> {
		const client = getOpenMeterClient();
		if (!client) return emptySearch(payload.limit ?? 0, payload.offset ?? 0);

		const entityType = payload.entity_type ?? stringFilterValue(payload.filters, 'entity_type');
		if (entityType && entityType !== PRICE_ENTITY_TYPE.PLAN) return emptySearch(payload.limit ?? 0, payload.offset ?? 0);

		const filterEntityId = stringFilterValue(payload.filters, 'entity_id');
		const entityIds =
			payload.entity_ids ?? arrayFilterValue(payload.filters, 'entity_id') ?? (filterEntityId ? [filterEntityId] : undefined);
		const plans = await this.loadScopedPlans(client, entityType, entityIds);
		let items = plans.flatMap(mapOmPlanToPrices);

		for (const f of payload.filters ?? []) {
			if (f.field === 'entity_type' || f.field === 'entity_id' || f.field === 'status') continue;
			items = applyPriceClientFilter(items, f);
		}

		items = applyPriceClientSort(items, payload.sorts ?? []);
		const offset = payload.offset ?? 0;
		const limit = payload.limit ?? items.length;
		return { items: items.slice(offset, offset + limit), pagination: { total: items.length, limit, offset } };
	}

	/** 按范围加载计划：指定 ids 则逐个 get；否则全量 list（翻页抓全）。 */
	private static async loadScopedPlans(
		client: OpenMeterClient,
		entityType: string | undefined,
		entityIds?: string[],
		priceIds?: string[],
	): Promise<OmPlan[]> {
		if (entityType && entityType !== PRICE_ENTITY_TYPE.PLAN) return [];
		const scopedIds = entityIds?.length
			? entityIds
			: priceIds?.length
				? [...new Set(priceIds.map((id) => parsePriceId(id)?.planId).filter((planId): planId is string => planId !== undefined))]
				: undefined;
		if (scopedIds) {
			const plans = await Promise.all(scopedIds.map((id) => client.plans.get(id)));
			return plans.filter((p): p is OmPlan => p !== undefined);
		}
		const collected: OmPlan[] = [];
		for (let page = 1; page <= 10; page++) {
			const result = await client.plans.list({ page, pageSize: 100 });
			if (!result) break;
			collected.push(...result.items);
			if (collected.length >= result.totalCount) break;
		}
		return collected;
	}

	/** 以「改 phases → 整体 update」写回计划，返回服务端最新计划。 */
	private static async writePlanRateCards(
		client: OpenMeterClient,
		current: OmPlan,
		mutatePhases: (phases: OmPlanPhase[]) => OmPlanPhase[],
	): Promise<OmPlan> {
		const base: OmPlanReplaceUpdate = buildOmPlanUpdate(current, {});
		const phases = current.phases.length
			? mutatePhases(current.phases)
			: [{ key: `${current.key}_phase`, name: 'Default Phase', duration: null, rateCards: [] as OmRateCard[] }];
		const om = await client.plans.update(current.id, { ...base, phases });
		if (!om) throw new Error('更新计划价格失败');
		return om;
	}
}

function emptySearch(limit: number, offset: number): SearchPricesResponse {
	return { items: [], pagination: { total: 0, limit, offset } };
}

function paginatePrices(items: PriceResponse[], limit: number, offset: number): GetAllPricesResponse {
	return { items: items.slice(offset, offset + limit), limit, offset, total: items.length };
}

function locateRateCard(plan: OmPlan, phaseKey: string, rateCardKey: string): { phase: OmPlanPhase; card: OmRateCard } | null {
	for (const phase of plan.phases) {
		if (phase.key !== phaseKey) continue;
		const card = phase.rateCards.find((c) => c.key === rateCardKey);
		if (card) return { phase, card };
	}
	return null;
}

function stringFilterValue(filters: TypedBackendFilter[] | undefined, field: string): string | undefined {
	return filters?.find((f) => f.field === field && f.data_type === DataType.STRING)?.value?.string;
}

function arrayFilterValue(filters: TypedBackendFilter[] | undefined, field: string): string[] | undefined {
	return filters?.find((f) => f.field === field && f.data_type === DataType.ARRAY)?.value?.array;
}

/** 支持子集的客户端过滤：字符串字段（contains/eq/not_contains）与 amount 数值（eq/gt/lt）。 */
function applyPriceClientFilter(items: PriceResponse[], f: TypedBackendFilter): PriceResponse[] {
	if (f.data_type === DataType.NUMBER && f.value?.number !== undefined && f.field === 'amount') {
		return items.filter((p) => compareNumber(Number(p.amount), f.value?.number ?? 0, f.operator));
	}
	if (f.data_type !== DataType.STRING || f.value?.string === undefined) return items;
	const v = f.value.string.toLowerCase();
	const compare = (s: string | undefined): boolean => {
		const target = (s ?? '').toLowerCase();
		switch (f.operator) {
			case FilterOperator.EQUAL:
				return target === v;
			case FilterOperator.CONTAINS:
				return target.includes(v);
			case FilterOperator.NOT_CONTAINS:
				return !target.includes(v);
			default:
				return true;
		}
	};
	switch (f.field) {
		case 'display_name':
			return items.filter((p) => compare(p.display_name));
		case 'lookup_key':
			return items.filter((p) => compare(p.lookup_key));
		case 'type':
		case 'charge_type':
			return items.filter((p) => compare(p.type));
		case 'billing_model':
			return items.filter((p) => compare(p.billing_model));
		case 'currency':
			return items.filter((p) => compare(p.currency));
		case 'billing_period':
			return items.filter((p) => compare(p.billing_period));
		case 'meter_id':
			return items.filter((p) => compare(p.meter_id));
		case 'group_id':
			return items.filter((p) => compare(p.group_id));
		default:
			return items;
	}
}

function compareNumber(actual: number, expected: number, operator: FilterOperator): boolean {
	switch (operator) {
		case FilterOperator.EQUAL:
			return actual === expected;
		case FilterOperator.GREATER_THAN:
			return actual > expected;
		case FilterOperator.LESS_THAN:
			return actual < expected;
		default:
			return true;
	}
}

const SORTABLE_PRICE_FIELDS = new Set(['display_name', 'amount', 'created_at', 'updated_at']);

/** 支持子集的客户端排序：首个排序字段的 display_name/amount/created_at/updated_at。 */
function applyPriceClientSort(items: PriceResponse[], sorts: { field: string; direction: string }[]): PriceResponse[] {
	const sort = sorts[0];
	if (!sort) return items;
	if (!SORTABLE_PRICE_FIELDS.has(sort.field)) return items;
	const dir = sort.direction === 'desc' ? -1 : 1;
	const keyOf = (p: PriceResponse): string | number => {
		switch (sort.field) {
			case 'display_name':
				return p.display_name.toLowerCase();
			case 'amount':
				return Number(p.amount);
			case 'created_at':
				return p.created_at;
			case 'updated_at':
				return p.updated_at;
			default:
				return '';
		}
	};
	return [...items].sort((a, b) => {
		const ka = keyOf(a);
		const kb = keyOf(b);
		if (ka === kb) return 0;
		return ka < kb ? -dir : dir;
	});
}
