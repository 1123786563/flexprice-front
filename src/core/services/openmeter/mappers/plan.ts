// src/core/services/openmeter/mappers/plan.ts
// OM plan（v2：phases/rateCards）↔ Flexprice PlanResponse 双向映射。
// OM 无对应字段（display_order、price_sync_status）丢弃并 warn 一次；key↔lookup_key。
import type { OpenMeterClient } from '@/core/services/openmeter';
import { ENTITY_STATUS } from '@/models';
import type { Metadata } from '@/models';
import type { CreatePlanRequest, UpdatePlanRequest, ClonePlanRequest, PlanResponse } from '@/types/dto';
import { iso } from './common';

export type OmPlan = NonNullable<Awaited<ReturnType<OpenMeterClient['plans']['get']>>>;
export type OmPlanPage = NonNullable<Awaited<ReturnType<OpenMeterClient['plans']['list']>>>;
export type OmPlanCreate = Parameters<OpenMeterClient['plans']['create']>[0];
export type OmPlanReplaceUpdate = Parameters<OpenMeterClient['plans']['update']>[1];
export type OmPlanListQuery = NonNullable<Parameters<OpenMeterClient['plans']['list']>[0]>;

let warnedDisplayOrder = false;
function warnDisplayOrderOnce() {
	if (warnedDisplayOrder) return;
	warnedDisplayOrder = true;
	console.warn('[openmeter/plan] OM 计划无 display_order 字段，该值将被丢弃');
}

/** OM PlanStatus → Flexprice ENTITY_STATUS（draft/scheduled 归一为 published；ENTITY_STATUS 无 draft 成员）。 */
export function mapOmPlanStatus(status: OmPlan['status']): ENTITY_STATUS {
	switch (status) {
		case 'archived':
			return ENTITY_STATUS.ARCHIVED;
		case 'active':
		case 'draft':
		case 'scheduled':
		default:
			return ENTITY_STATUS.PUBLISHED;
	}
}

export function mapOmPlan(om: OmPlan): PlanResponse {
	return {
		id: om.id,
		lookup_key: om.key ?? om.id,
		name: om.name ?? om.key ?? om.id,
		description: om.description ?? '',
		metadata: (om.metadata as Metadata | undefined) ?? {},
		display_order: undefined,
		status: mapOmPlanStatus(om.status),
		tenant_id: '',
		environment_id: '',
		created_by: '',
		updated_by: '',
		created_at: iso(om.createdAt),
		updated_at: iso(om.updatedAt),
	};
}

/** OM key 要求 slug 形态；从展示名兜底生成（非 [a-z0-9_] 折叠为 _）。 */
export function slugifyPlanKey(source: string): string {
	const slug = source
		.toLowerCase()
		.replace(/[^a-z0-9_]+/g, '_')
		.replace(/^_+|_+$/g, '');
	return slug || 'plan';
}

/**
 * Flexprice CreatePlanRequest → OM PlanCreate。
 * CreatePlanRequest 不含计费信息：currency 固定 USD、billingCadence 固定 P1M、
 * 附带单个空 phase（价格卡由 PriceApi 单独追加到首 phase）。
 */
export function buildOmPlanCreate(req: CreatePlanRequest): OmPlanCreate {
	if (req.display_order !== undefined) warnDisplayOrderOnce();
	const key = req.lookup_key?.trim() || slugifyPlanKey(req.name);
	return {
		name: req.name,
		key,
		...(req.description ? { description: req.description } : {}),
		...(req.metadata && Object.keys(req.metadata).length ? { metadata: { ...req.metadata } } : {}),
		currency: 'USD',
		billingCadence: 'P1M',
		phases: [
			{
				key: `${key}_phase`,
				name: 'Default Phase',
				duration: null,
				rateCards: [],
			},
		],
	};
}

/**
 * Flexprice UpdatePlanRequest → OM PlanReplaceUpdate。
 * OM update 是整对象替换：billingCadence/phases 等以现值为准（计划编辑页只改
 * name/description/metadata）；lookup_key（OM key 被订阅引用，不可改）与
 * display_order 变更被丢弃。
 */
export function buildOmPlanUpdate(current: OmPlan, req: UpdatePlanRequest): OmPlanReplaceUpdate {
	if (req.display_order !== undefined) warnDisplayOrderOnce();
	if (req.lookup_key !== undefined && req.lookup_key !== current.key) {
		console.warn(`[openmeter/plan] OM 计划 key 不可变更（lookup_key=${current.key} 保持不变）`);
	}
	return {
		name: req.name ?? current.name ?? current.key ?? current.id,
		...(current.description !== undefined ? { description: current.description } : {}),
		...(current.alignment !== undefined ? { alignment: current.alignment } : {}),
		billingCadence: current.billingCadence,
		...(current.proRatingConfig !== undefined ? { proRatingConfig: current.proRatingConfig } : {}),
		...(current.settlementMode !== undefined ? { settlementMode: current.settlementMode } : {}),
		phases: current.phases,
	};
}

/** clonePlan：现计划 phases 深拷贝 + 新 name/key 组装 PlanCreate。 */
export function buildOmPlanClone(current: OmPlan, req: ClonePlanRequest): OmPlanCreate {
	if (req.display_order !== undefined) warnDisplayOrderOnce();
	return {
		name: req.name,
		key: req.lookup_key,
		...((req.description ?? current.description) ? { description: req.description ?? current.description } : {}),
		...(req.metadata && Object.keys(req.metadata).length ? { metadata: { ...req.metadata } } : {}),
		currency: current.currency,
		billingCadence: current.billingCadence,
		...(current.proRatingConfig !== undefined ? { proRatingConfig: current.proRatingConfig } : {}),
		...(current.settlementMode !== undefined ? { settlementMode: current.settlementMode } : {}),
		phases: current.phases.map((phase) => ({
			key: phase.key,
			name: phase.name,
			...(phase.description !== undefined ? { description: phase.description } : {}),
			...(phase.metadata !== undefined ? { metadata: phase.metadata } : {}),
			duration: phase.duration,
			rateCards: phase.rateCards.map((card) => structuredClone(card)),
		})),
	};
}

/**
 * Flexprice GetPlansByFilterPayload → OM listPlans 查询。
 * 服务端只下推 key（lookup_key）与分页；status/TypedBackendFilter/排序由 PlanApi 在客户端执行。
 */
export function buildOmPlanListQuery(payload: { limit?: number | null; offset?: number; lookup_key?: string }): OmPlanListQuery {
	const limit = payload.limit ?? 10;
	const offset = payload.offset ?? 0;
	return {
		pageSize: limit,
		page: Math.floor(offset / Math.max(1, limit)) + 1,
		...(payload.lookup_key ? { key: [payload.lookup_key] } : {}),
	};
}
