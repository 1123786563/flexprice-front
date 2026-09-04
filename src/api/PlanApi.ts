// src/api/PlanApi.ts
// OpenMeter 承载：计划 CRUD 走 OM plans（key↔lookup_key；status active/draft/scheduled→published、
// archived→archived）。OM 无对应能力（price_sync_status 展开与订阅价格同步）明确报错。
import { Pagination } from '@/models';
import {
	CreatePlanRequest,
	ClonePlanRequest,
	UpdatePlanRequest,
	PlanResponse,
	CreatePlanResponse,
	SynchronizePlanPricesWithSubscriptionResponse,
} from '@/types/dto';
import { TypedBackendFilter, TypedBackendSort } from '@/types/formatters/QueryBuilder';
import { QueryFilter, TimeRangeFilter } from '@/types/dto/base';
import { DataType } from '@/types/common/QueryBuilder';
import { getOpenMeterClient, requireOpenMeterClient } from '@/core/services/openmeter';
import {
	mapOmPlan,
	buildOmPlanCreate,
	buildOmPlanUpdate,
	buildOmPlanClone,
	buildOmPlanListQuery,
	type OmPlan,
	type OmPlanPage,
} from '@/core/services/openmeter/mappers/plan';
import { toFlexpricePagination } from '@/core/services/openmeter/mappers/common';

export interface GetAllPlansResponse {
	items: PlanResponse[];
	pagination: Pagination;
}

export interface GetPlansByFilterPayload extends Omit<QueryFilter, 'sort'>, TimeRangeFilter, Pagination {
	filters?: TypedBackendFilter[];
	sort?: TypedBackendSort[];
	lookup_key?: string;
}

export class PlanApi {
	public static async createPlan(data: CreatePlanRequest): Promise<CreatePlanResponse> {
		const om = await requireOpenMeterClient().plans.create(buildOmPlanCreate(data));
		if (!om) throw new Error('创建计划失败');
		return mapOmPlan(om);
	}

	/**
	 * Get plans using typed filters - this is the consolidated method for all plan queries
	 * Replaces: getAllPlans, getAllActivePlans, listPlans, searchPlans, getExpandedPlan, getActiveExpandedPlan
	 * OM 侧下推 key（lookup_key）与分页；status/TypedBackendFilter 子集与排序在客户端执行，
	 * expand/时间范围过滤（start_time/end_time）静默忽略。
	 */
	public static async getPlansByFilter(payload: GetPlansByFilterPayload = {}): Promise<GetAllPlansResponse> {
		const client = getOpenMeterClient();
		if (!client) return { items: [], pagination: { limit: payload.limit ?? 0, offset: payload.offset ?? 0, total: 0 } };
		const page: OmPlanPage = (await client.plans.list(buildOmPlanListQuery(payload))) ?? {
			items: [],
			totalCount: 0,
			page: 1,
			pageSize: 0,
		};
		let items = page.items.map(mapOmPlan);
		if (payload.status !== undefined) {
			items = items.filter((p) => p.status === payload.status);
		}
		for (const f of payload.filters ?? []) {
			items = applyPlanClientFilter(items, f);
		}
		items = applyPlanClientSort(items, payload.sort ?? []);
		return { items, pagination: toFlexpricePagination(page, payload.limit, payload.offset) };
	}

	public static async getPlanById(id: string): Promise<PlanResponse> {
		const om = await requireOpenMeterClient().plans.get(id);
		if (!om) throw new Error(`计划 ${id} 不存在`);
		return mapOmPlan(om);
	}

	/** OM update 是整对象替换：先取当前值合并补丁再发送（billingCadence/phases 保持现值）。 */
	public static async updatePlan(id: string, data: UpdatePlanRequest): Promise<PlanResponse> {
		const client = requireOpenMeterClient();
		const current: OmPlan | undefined = await client.plans.get(id);
		if (!current) throw new Error(`计划 ${id} 不存在`);
		const om = await client.plans.update(id, buildOmPlanUpdate(current, data));
		if (!om) throw new Error('更新计划失败');
		return mapOmPlan(om);
	}

	public static async deletePlan(id: string): Promise<void> {
		await requireOpenMeterClient().plans.delete(id);
	}

	/** OM 无 clone 端点：get + create 复制（phases/rateCards 深拷贝，换 name/key）。 */
	public static async clonePlan(id: string, data: ClonePlanRequest): Promise<PlanResponse> {
		const client = requireOpenMeterClient();
		const current: OmPlan | undefined = await client.plans.get(id);
		if (!current) throw new Error(`计划 ${id} 不存在`);
		const om = await client.plans.create(buildOmPlanClone(current, data));
		if (!om) throw new Error('复制计划失败');
		return mapOmPlan(om);
	}

	/**
	 * 计划价格同步 → OM subscriptions.migrate：订阅固定在其创建时的 plan 版本上，
	 * 把该计划的活跃订阅逐个迁移到最新版本（OM 无批量端点，逐条迁移并汇总结果）。
	 */
	public static async synchronizePlanPricesWithSubscription(id: string): Promise<SynchronizePlanPricesWithSubscriptionResponse> {
		const client = requireOpenMeterClient();
		const plan = await client.plans.get(id);
		if (!plan?.key) throw new Error(`计划 ${id} 不存在`);
		const customers = (await client.customers.list({ pageSize: 100, page: 1 }))?.items ?? [];
		const targets = customers.flatMap((c) => c.subscriptions ?? []).filter((s) => s.plan?.id === id && s.status === 'active');
		let migrated = 0;
		let failed = 0;
		for (const sub of targets) {
			try {
				await client.subscriptions.migrate(sub.id, {
					targetVersion: plan.version,
					timing: 'immediate',
				});
				migrated++;
			} catch {
				failed++;
			}
		}
		return {
			message: `已迁移 ${migrated} 个订阅到计划 v${plan.version}${failed ? `，${failed} 个失败` : ''}`,
			plan_id: id,
			plan_name: plan.name ?? plan.key,
			synchronization_summary: {
				subscriptions_processed: targets.length,
				prices_processed: 0,
				line_items_created: 0,
				line_items_terminated: 0,
				line_items_skipped: 0,
				line_items_failed: failed,
				skipped_already_terminated: 0,
				skipped_overridden: 0,
				skipped_incompatible: 0,
				total_prices: 0,
				active_prices: 0,
				expired_prices: 0,
			},
		};
	}
}

/** 支持子集的客户端过滤（字符串 name/lookup_key/id/description/status）。非字符串值/不支持字段静默跳过。 */
function applyPlanClientFilter(items: PlanResponse[], f: TypedBackendFilter): PlanResponse[] {
	if (f.data_type !== DataType.STRING || f.value?.string === undefined) return items;
	const v = f.value.string.toLowerCase();
	const compare = (s: string): boolean => {
		switch (f.operator) {
			case 'eq':
				return s.toLowerCase() === v;
			case 'contains':
				return s.toLowerCase().includes(v);
			case 'not_contains':
				return !s.toLowerCase().includes(v);
			default:
				return true;
		}
	};
	switch (f.field) {
		case 'name':
			return items.filter((p) => compare(p.name));
		case 'lookup_key':
			return items.filter((p) => compare(p.lookup_key));
		case 'id':
			return items.filter((p) => compare(p.id));
		case 'description':
			return items.filter((p) => compare(p.description));
		case 'status':
			return items.filter((p) => p.status === f.value?.string);
		default:
			return items;
	}
}

/** 支持子集的客户端排序（name/lookup_key/created_at/updated_at）。不支持字段保持原序。 */
function applyPlanClientSort(items: PlanResponse[], sorts: TypedBackendSort[]): PlanResponse[] {
	const sort = sorts[0];
	if (!sort) return items;
	if (!SORTABLE_PLAN_FIELDS.has(sort.field)) return items;
	if (sorts.length > 1) console.warn('[openmeter/plan] 多字段排序仅支持首个排序字段');
	const dir = sort.direction === 'desc' ? -1 : 1;
	const keyOf = (p: PlanResponse): string => {
		switch (sort.field) {
			case 'name':
				return p.name.toLowerCase();
			case 'lookup_key':
				return p.lookup_key.toLowerCase();
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

const SORTABLE_PLAN_FIELDS = new Set(['name', 'lookup_key', 'created_at', 'updated_at']);
