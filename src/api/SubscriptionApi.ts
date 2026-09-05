// src/api/SubscriptionApi.ts
// OpenMeter 承载：订阅读（customers.list 内嵌拍平 / subscriptions.get）、创建（解析 plan key）、
// 取消（timing 映射）。OM v2 无行项目/modify/change/invoice-preview 通路——相关方法明确报错或空态，
// 禁止假成功（深化项见 docs/superpowers/plans/2026-09-04-full-openmeter-backend-switch.md）。
import { SubscriptionUsage } from '@/models';
import { ENTITY_STATUS } from '@/models';
import { ADDON_ASSOCIATION_STATUS } from '@/models/AddonAssociation';
import { SUBSCRIPTION_CANCELLATION_TYPE } from '@/models/Subscription';
import {
	ListSubscriptionsPayload,
	ListSubscriptionsResponse,
	GetSubscriptionDetailsPayload,
	GetSubscriptionPreviewResponse,
	CancelSubscriptionPayload,
	CreateSubscriptionRequest,
	UpdateSubscriptionRequest,
	CancelSubscriptionRequest,
	CancelSubscriptionResponse,
	SubscriptionResponse,
	GetUsageBySubscriptionRequest,
	GetUsageBySubscriptionResponse,
	AddAddonRequest,
	RemoveAddonRequest,
	AddonAssociationResponse,
	ListAddonAssociationsResponse,
	CreateSubscriptionLineItemRequest,
	UpdateSubscriptionLineItemRequest,
	DeleteSubscriptionLineItemRequest,
	SubscriptionLineItemResponse,
	PreviewSubscriptionChangeRequest,
	PreviewSubscriptionChangeResponse,
	ExecuteSubscriptionChangeRequest,
	ExecuteSubscriptionChangeResponse,
	ExecuteSubscriptionModifyRequest,
	SubscriptionModifyResponse,
	SubscriptionLineItemFilter,
	ListSubscriptionLineItemsResponse,
} from '@/types/dto/Subscription';
import { ListCreditGrantApplicationsResponse } from '@/types/dto';
import { getOpenMeterClient, requireOpenMeterClient } from '@/core/services/openmeter';
import type { OpenMeterClient } from '@/core/services/openmeter';
import { omV1 } from '@/core/services/openmeter/omFetch';
import { mapOmSubscription } from '@/core/services/openmeter/mappers/subscription';
import type { OmSubscription } from '@/core/services/openmeter/mappers/subscription';
import { mapOmCustomer } from '@/core/services/openmeter/mappers/customer';
import type { Customer } from '@/models';

type OmSubscriptionAddon = NonNullable<Awaited<ReturnType<OpenMeterClient['subscriptionAddons']['list']>>>[number];

function emptyPage<T>(limit = 0): { items: T[]; pagination: { limit: number; offset: number; total: number } } {
	return { items: [], pagination: { limit, offset: 0, total: 0 } };
}

function unsupported(operation: string): never {
	throw new Error(`OpenMeter 后端暂不支持「${operation}」：订阅行项目/中途变更模型与 Flexprice 不对齐`);
}

const omDateToString = (value: Date | string | null | undefined): string =>
	value instanceof Date ? value.toISOString() : value ? String(value) : '';

/**
 * OM 订阅附加组件关联 → Flexprice addon association 形状（list/create 共用）。
 * OM 无 Flexprice 的 addon 嵌套价格概念，prices 留空由 UI 显示 '--'。
 */
function mapOmSubscriptionAddon(association: OmSubscriptionAddon, subscriptionId: string): AddonAssociationResponse {
	return {
		id: association.id,
		environment_id: '',
		// Flexprice 语义：关联实体=订阅本体
		entity_id: association.subscriptionId ?? subscriptionId,
		entity_type: 'SUBSCRIPTION',
		addon_id: association.addon?.id ?? '',
		start_date: omDateToString(association.activeFrom),
		end_date: association.activeTo ? omDateToString(association.activeTo) : undefined,
		addon_status: association.activeTo ? ADDON_ASSOCIATION_STATUS.INACTIVE : ADDON_ASSOCIATION_STATUS.ACTIVE,
		tenant_id: '',
		status: 'published',
		created_at: omDateToString(association.createdAt),
		updated_at: omDateToString(association.updatedAt),
		created_by: '',
		updated_by: '',
		quantity: association.quantity,
	} as AddonAssociationResponse;
}

/** OM 无订阅列表端点：经 customers.list 内嵌 subscriptions 拍平（本地管理规模下全量拉取）。 */
async function fetchAllSubscriptions(): Promise<{ subscriptions: OmSubscription[]; customersById: Map<string, Customer> }> {
	const client = getOpenMeterClient();
	if (!client) return { subscriptions: [], customersById: new Map() };
	const customers = (await client.customers.list({ pageSize: 100, page: 1 }))?.items ?? [];
	const customersById = new Map(customers.map((om) => [om.id, mapOmCustomer(om)]));
	const subscriptions: OmSubscription[] = [];
	for (const om of customers) {
		for (const sub of om.subscriptions ?? []) subscriptions.push(sub);
	}
	return { subscriptions, customersById };
}

class SubscriptionApi {
	// =============================================================================
	// CORE SUBSCRIPTION METHODS
	// =============================================================================

	public static async getSubscription(id: string): Promise<SubscriptionResponse> {
		const client = requireOpenMeterClient();
		const om = await client.subscriptions.get(id);
		if (!om) throw new Error(`订阅 ${id} 不存在`);
		const customer = (await client.customers.get(om.customerId).catch(() => null)) ?? null;
		return mapOmSubscription(om, customer ? { customer: mapOmCustomer(customer) } : {});
	}

	public static async getSubscriptionV2(id: string, _options?: { expand?: string }): Promise<SubscriptionResponse> {
		return await this.getSubscription(id);
	}

	/**
	 * 创建订阅：OM 以 plan key+version 引用（currency/billing_period 由 plan 决定）。
	 * plan_id 若是 OM plan id 则先解析为 key；draft 计划先 publish（Flexprice 心智：
	 * 加完价格卡的计划创建订阅即可用），publish 失败（如仍无费率卡）明确报错。
	 */
	public static async createSubscription(payload: CreateSubscriptionRequest): Promise<SubscriptionResponse> {
		const client = requireOpenMeterClient();
		let plan = await client.plans.get(payload.plan_id).catch(() => null);
		if (!plan?.key) throw new Error(`计划 ${payload.plan_id} 不存在，无法创建订阅`);
		if (plan.status === 'draft') {
			const published = await client.plans.publish(plan.id).catch(() => null);
			if (!published) {
				throw new Error('计划尚未发布：请先为计划添加至少一张价格卡（OpenMeter 要求 phase 含费率卡才能发布）');
			}
			plan = await client.plans.get(payload.plan_id);
		}
		if (!plan) throw new Error(`计划 ${payload.plan_id} 不存在，无法创建订阅`);
		const created = await client.subscriptions.create({
			plan: { key: plan.key, ...(plan.version ? { version: plan.version } : {}) },
			customerId: payload.customer_id,
			...(payload.start_date ? { billingAnchor: new Date(payload.start_date) } : {}),
		});
		if (!created) throw new Error('创建订阅失败');
		return mapOmSubscription(created);
	}

	public static async updateSubscription(_id: string, _payload: UpdateSubscriptionRequest): Promise<SubscriptionResponse> {
		unsupported('编辑订阅（updateSubscription）');
	}

	public static async listSubscriptions(payload: ListSubscriptionsPayload): Promise<ListSubscriptionsResponse> {
		return await this.searchSubscriptions(payload);
	}

	/** 搜索：OM 无列表端点，全量拉取后按 payload 过滤（customer_id/plan_id/状态/ids）。 */
	public static async searchSubscriptions(payload: ListSubscriptionsPayload): Promise<ListSubscriptionsResponse> {
		const { subscriptions, customersById } = await fetchAllSubscriptions();
		let items = subscriptions.map((sub) => mapOmSubscription(sub, { customer: customersById.get(sub.customerId) }));
		if (payload.customer_id) items = items.filter((s) => s.customer_id === payload.customer_id);
		if (payload.external_customer_id) items = items.filter((s) => s.customer.external_id === payload.external_customer_id);
		if (payload.plan_id) items = items.filter((s) => s.plan_id === payload.plan_id || s.plan.lookup_key === payload.plan_id);
		if (payload.subscription_status?.length) {
			const statuses = new Set(payload.subscription_status);
			items = items.filter((s) => statuses.has(s.subscription_status));
		}
		if (payload.subscription_status_not_in?.length) {
			const excluded = new Set(payload.subscription_status_not_in);
			items = items.filter((s) => !excluded.has(s.subscription_status));
		}
		if (payload.subscription_ids?.length) {
			const ids = new Set(payload.subscription_ids);
			items = items.filter((s) => ids.has(s.id));
		}
		const limit = payload.limit ?? (items.length || 1);
		const offset = payload.offset ?? 0;
		return {
			items: items.slice(offset, offset + limit),
			pagination: { limit, offset, total: items.length },
			sort: payload.sort ?? [],
			filters: payload.filters ?? [],
		};
	}

	/** 取消：cancellation_type 映射 OM timing（immediate / next_billing_cycle）；定时取消无对应，明确报错。 */
	public static async cancelSubscription(
		id: string,
		payload: CancelSubscriptionPayload | CancelSubscriptionRequest,
	): Promise<void | CancelSubscriptionResponse> {
		const client = requireOpenMeterClient();
		const timing =
			payload.cancellation_type === SUBSCRIPTION_CANCELLATION_TYPE.IMMEDIATE ? ('immediate' as const) : ('next_billing_cycle' as const);
		if (payload.cancellation_type === SUBSCRIPTION_CANCELLATION_TYPE.SCHEDULED_DATE) {
			throw new Error('OpenMeter 暂不支持定时取消（仅支持立即取消或周期末取消）');
		}
		const canceled = await client.subscriptions.cancel(id, { timing });
		if (!canceled) throw new Error(`取消订阅 ${id} 失败`);
		return {
			subscription_id: canceled.id,
			cancellation_type: payload.cancellation_type,
			effective_date: timing === 'immediate' ? new Date().toISOString() : '',
		} as CancelSubscriptionResponse;
	}

	// =============================================================================
	// SUBSCRIPTION STATUS METHODS
	// =============================================================================

	public static async activateSubscription(_id: string, _payload: { start_date: string }): Promise<SubscriptionResponse> {
		unsupported('激活草稿订阅（OM 无 draft→active 手动激活）');
	}

	/** 撤销已排定的取消（周期末取消后反悔）：OM v3 `unschedule-cancelation`。 */
	public static async unscheduleCancelation(subscriptionId: string): Promise<SubscriptionResponse> {
		const client = requireOpenMeterClient();
		const om = await client.subscriptions.unscheduleCancelation(subscriptionId);
		if (!om) throw new Error(`撤销取消 ${subscriptionId} 失败`);
		return mapOmSubscription(om);
	}

	/** 恢复已取消订阅：仅 v1 提供（`POST /subscriptions/{id}/restore`），恢复后重新拉取 v3 视图。 */
	public static async restoreSubscription(subscriptionId: string): Promise<SubscriptionResponse> {
		await omV1(`/subscriptions/${subscriptionId}/restore`, { method: 'POST' });
		return await this.getSubscription(subscriptionId);
	}

	// =============================================================================
	// USAGE & ANALYTICS METHODS
	// =============================================================================

	public static async getSubscriptionUsage(id: string): Promise<SubscriptionUsage> {
		// OM v2 无订阅级用量汇总端点（用量按 meter 聚合）；空骨架保持类型完备
		return {
			id,
			amount: 0,
			currency: 'USD',
			display_amount: '0',
			start_time: new Date(0),
			end_time: new Date(0),
			charges: [],
			status: ENTITY_STATUS.PUBLISHED,
			tenant_id: '',
			environment_id: '',
			created_by: '',
			updated_by: '',
			created_at: '',
			updated_at: '',
		} as unknown as SubscriptionUsage;
	}

	public static async getUsageBySubscription(
		_payload: GetUsageBySubscriptionRequest | { subscription_id: string },
	): Promise<GetUsageBySubscriptionResponse> {
		return {
			amount: 0,
			currency: 'USD',
			display_amount: '0',
			start_time: '',
			end_time: '',
			charges: [],
			has_overage: false,
		};
	}

	public static async getSubscriptionInvoicesPreview(_payload: GetSubscriptionDetailsPayload): Promise<GetSubscriptionPreviewResponse> {
		throw new Error('OpenMeter 暂不支持订阅发票预览');
	}

	// =============================================================================
	// ADDON MANAGEMENT METHODS
	// =============================================================================

	/**
	 * 添加附加组件：OM v3 `POST /subscriptions/{id}/addons`。OM 无 start_date/cadence/
	 * proration 概念，立即生效、数量固定 1；Flexprice 元数据并入 OM labels 便于回查。
	 * npm SDK 类型（beta.232）与现役 v3 spec 不一致（SDK 要求 name/metadata，served spec
	 * 是 additionalProperties:false 的 {addon, labels, quantity, timing}）——以 served
	 * spec 为准做类型旁路，多发的字段会被后端 400 拒绝。
	 */
	public static async addAddonToSubscription(payload: AddAddonRequest): Promise<AddonAssociationResponse> {
		const client = requireOpenMeterClient();
		const body = {
			addon: { id: payload.addon_id },
			quantity: 1,
			timing: 'immediate',
			...(payload.metadata ? { labels: Object.fromEntries(Object.entries(payload.metadata).map(([k, v]) => [k, String(v)])) } : {}),
		} as unknown as Parameters<OpenMeterClient['subscriptionAddons']['create']>[1];
		const created = await client.subscriptionAddons.create(payload.subscription_id, body);
		if (!created) throw new Error('添加附加组件失败');
		return mapOmSubscriptionAddon(created, payload.subscription_id);
	}

	public static async getActiveAddons(subscriptionId: string): Promise<ListAddonAssociationsResponse> {
		if (!subscriptionId) return emptyPage() as ListAddonAssociationsResponse;
		const client = getOpenMeterClient();
		if (!client) return emptyPage() as ListAddonAssociationsResponse;
		const addons = (await client.subscriptionAddons.list(subscriptionId)) ?? [];
		// UI 直接展示 addon 名称；OM 关联对象只带 id，这里并入目录里的 addon 概要
		const catalog = new Map(((await client.addons.list({ pageSize: 1000 }))?.items ?? []).map((a) => [a.id, a]));
		return {
			items: addons.map((a) => {
				const addon = catalog.get(a.addon?.id ?? '');
				return {
					...mapOmSubscriptionAddon(a, subscriptionId),
					...(addon ? { addon: { id: addon.id, name: addon.name } as AddonAssociationResponse['addon'] } : {}),
				};
			}),
			pagination: { limit: addons.length, offset: 0, total: addons.length },
		};
	}

	/**
	 * 移除附加组件：OM 无 DELETE/定时移除，v1 PATCH quantity=0 即终止（立即生效）。
	 * OM 不支持 Flexprice 的 proration/effective_date 语义，忽略并如实立即移除。
	 */
	public static async removeAddonFromSubscription(payload: RemoveAddonRequest): Promise<{ message: string }> {
		const client = requireOpenMeterClient();
		if (!payload.subscription_id) throw new Error('缺少 subscription_id，无法移除附加组件');
		await client.subscriptionAddons.update(payload.subscription_id, payload.addon_association_id, { quantity: 0 });
		return { message: 'ok' };
	}

	// =============================================================================
	// SUBSCRIPTION LINE ITEM METHODS
	// =============================================================================

	public static async createSubscriptionLineItem(
		_subscriptionId: string,
		_payload: CreateSubscriptionLineItemRequest,
	): Promise<SubscriptionLineItemResponse> {
		unsupported('创建订阅行项目');
	}

	public static async updateSubscriptionLineItem(
		_id: string,
		_payload: UpdateSubscriptionLineItemRequest,
	): Promise<SubscriptionLineItemResponse> {
		unsupported('编辑订阅行项目');
	}

	public static async deleteSubscriptionLineItem(_id: string, _payload: DeleteSubscriptionLineItemRequest): Promise<void> {
		unsupported('删除订阅行项目');
	}

	/** 行项目在 OM v2 由 plan rateCards 驱动，无独立行项目实体——空态。 */
	public static async searchSubscriptionLineItems(filter: SubscriptionLineItemFilter): Promise<ListSubscriptionLineItemsResponse> {
		return emptyPage(filter.limit ?? 0) as ListSubscriptionLineItemsResponse;
	}

	// =============================================================================
	// SUBSCRIPTION ENTITLEMENT METHODS
	// =============================================================================

	public static async getSubscriptionEntitlements(subscriptionId: string) {
		return { subscription_id: subscriptionId, plan_id: '', features: [] };
	}

	// =============================================================================
	// CREDIT GRANT APPLICATION METHODS
	// =============================================================================

	public static async getUpcomingCreditGrantApplications(_subscriptionId: string): Promise<ListCreditGrantApplicationsResponse> {
		return { items: [], limit: 0, offset: 0, total: 0 };
	}

	// =============================================================================
	// SUBSCRIPTION CHANGE / MODIFY METHODS
	// =============================================================================

	public static async previewSubscriptionChange(
		_id: string,
		_payload: PreviewSubscriptionChangeRequest,
	): Promise<PreviewSubscriptionChangeResponse> {
		// OM 无变更预览端点（change 直接生效）；给出操作指引而非笼统报错
		throw new Error('OpenMeter 无订阅变更预览（change 即时生效或下周期生效），可直接执行变更');
	}

	/**
	 * 订阅计划变更（升降级）→ OM subscriptions.change：目标计划经 plans.get 解析为 key+version；
	 * effective_date 在未来 → next_billing_cycle，否则 immediate。
	 * 行项目/权益覆盖类参数 OM 无对应，携带即明确报错。
	 */
	public static async executeSubscriptionChange(
		id: string,
		payload: ExecuteSubscriptionChangeRequest,
	): Promise<ExecuteSubscriptionChangeResponse> {
		if (!payload.plan_id) throw new Error('缺少目标计划（plan_id）');
		if (payload.override_line_items?.length || payload.entitlement_overrides?.length || payload.line_item_commitments) {
			throw new Error('OpenMeter 变更不支持行项目/权益覆盖（价格由目标计划版本决定）');
		}
		const client = requireOpenMeterClient();
		const plan = await client.plans.get(payload.plan_id);
		if (!plan?.key) throw new Error(`目标计划 ${payload.plan_id} 不存在`);
		const timing =
			payload.effective_date && new Date(payload.effective_date).getTime() > Date.now()
				? ('next_billing_cycle' as const)
				: ('immediate' as const);
		const result = await client.subscriptions.change(id, {
			timing,
			plan: { key: plan.key, ...(plan.version !== undefined ? { version: plan.version } : {}) },
		});
		if (!result?.next) throw new Error(`变更订阅 ${id} 失败`);
		return {
			subscription: mapOmSubscription(result.next),
			proration_details: [],
			message: `订阅已变更到计划 ${plan.name ?? plan.key}（${timing === 'immediate' ? '立即生效' : '下周期生效'}）`,
		};
	}

	public static async previewSubscriptionModify(
		_id: string,
		payload: ExecuteSubscriptionModifyRequest,
	): Promise<SubscriptionModifyResponse> {
		throw new Error(buildModifyUnsupportedMessage(payload));
	}

	public static async executeSubscriptionModify(
		_id: string,
		payload: ExecuteSubscriptionModifyRequest,
	): Promise<SubscriptionModifyResponse> {
		throw new Error(buildModifyUnsupportedMessage(payload));
	}
}

/** modify 各类型的明确不支持理由（quantity_change 指出 OM 计费模型的差异）。 */
function buildModifyUnsupportedMessage(payload: { type?: string }): string {
	if (payload.type === 'quantity_change') {
		return 'OpenMeter 按 plan 费率卡计费（无行项目数量概念），不支持数量调整；如需不同用量档位请变更到对应计划';
	}
	return `OpenMeter 暂不支持订阅中途修改（${payload.type ?? '未知类型'}：无对应计费模型）`;
}

export default SubscriptionApi;
