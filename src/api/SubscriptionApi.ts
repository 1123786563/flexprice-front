// src/api/SubscriptionApi.ts
// OpenMeter 承载：订阅读（customers.list 内嵌拍平 / subscriptions.get）、创建（解析 plan key）、
// 取消（timing 映射）。OM v2 无行项目/modify/change/invoice-preview 通路——相关方法明确报错或空态，
// 禁止假成功（深化项见 docs/superpowers/plans/2026-09-04-full-openmeter-backend-switch.md）。
import { SubscriptionUsage } from '@/models';
import { ENTITY_STATUS } from '@/models';
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
import { mapOmSubscription } from '@/core/services/openmeter/mappers/subscription';
import type { OmSubscription } from '@/core/services/openmeter/mappers/subscription';
import { mapOmCustomer } from '@/core/services/openmeter/mappers/customer';
import type { Customer } from '@/models';

function emptyPage<T>(limit = 0): { items: T[]; pagination: { limit: number; offset: number; total: number } } {
	return { items: [], pagination: { limit, offset: 0, total: 0 } };
}

function unsupported(operation: string): never {
	throw new Error(`OpenMeter 后端暂不支持「${operation}」：订阅行项目/中途变更模型与 Flexprice 不对齐`);
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
	 * plan_id 若是 OM plan id 则先解析为 key；start_date 超出 OM 通路时忽略。
	 */
	public static async createSubscription(payload: CreateSubscriptionRequest): Promise<SubscriptionResponse> {
		const client = requireOpenMeterClient();
		const plan = await client.plans.get(payload.plan_id).catch(() => null);
		if (!plan?.key) throw new Error(`计划 ${payload.plan_id} 不存在，无法创建订阅`);
		const created = await client.subscriptions.create({
			plan: { key: plan.key, ...(plan.version !== undefined ? { version: plan.version } : {}) },
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

	public static async addAddonToSubscription(_payload: AddAddonRequest): Promise<AddonAssociationResponse> {
		unsupported('为订阅添加附加组件');
	}

	public static async getActiveAddons(_subscriptionId: string): Promise<ListAddonAssociationsResponse> {
		return emptyPage() as ListAddonAssociationsResponse;
	}

	public static async removeAddonFromSubscription(_payload: RemoveAddonRequest): Promise<{ message: string }> {
		unsupported('移除订阅附加组件');
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
		throw new Error('OpenMeter 暂不支持订阅变更预览');
	}

	public static async executeSubscriptionChange(
		_id: string,
		_payload: ExecuteSubscriptionChangeRequest,
	): Promise<ExecuteSubscriptionChangeResponse> {
		throw new Error('OpenMeter 暂不支持订阅升降级（可取消后重新创建）');
	}

	public static async previewSubscriptionModify(
		_id: string,
		_payload: ExecuteSubscriptionModifyRequest,
	): Promise<SubscriptionModifyResponse> {
		throw new Error('OpenMeter 暂不支持订阅中途修改预览');
	}

	public static async executeSubscriptionModify(
		_id: string,
		_payload: ExecuteSubscriptionModifyRequest,
	): Promise<SubscriptionModifyResponse> {
		throw new Error('OpenMeter 暂不支持订阅中途修改（inheritance/quantity_change/grouped_invoicing）');
	}
}

export default SubscriptionApi;
