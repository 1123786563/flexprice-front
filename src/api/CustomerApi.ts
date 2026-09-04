// src/api/CustomerApi.ts
// OpenMeter 承载：客户 CRUD 走 OM customers（key↔external_id、primaryEmail↔email、
// billingAddress 嵌套↔打平）。OM 无对应能力（门户 session、税率覆盖）明确报错。
import { Pagination, Subscription } from '@/models';
import {
	ListCustomersResponse,
	CustomerResponse,
	CustomerFilter,
	GetCustomerByFiltersPayload,
	GetCustomerSubscriptionsResponse,
	GetCustomerEntitlementPayload,
	GetUsageSummaryResponse,
	GetCustomerEntitlementsResponse,
	CreateCustomerRequest,
	UpdateCustomerRequest,
	ListCreditGrantApplicationsResponse,
} from '@/types/dto';
import { DashboardSessionResponse } from '@/types/dto/Dashboard';
import type { TypedBackendFilter } from '@/types/formatters/QueryBuilder';
import { DataType } from '@/types/common/QueryBuilder';
import { getOpenMeterClient, requireOpenMeterClient } from '@/core/services/openmeter';
import {
	mapOmCustomer,
	buildOmCustomerCreate,
	buildOmCustomerUpdate,
	buildOmCustomerListQuery,
	filterCustomersClientSide,
} from '@/core/services/openmeter/mappers/customer';
import { mapOmSubscription } from '@/core/services/openmeter/mappers/subscription';
import { toFlexpricePagination } from '@/core/services/openmeter/mappers/common';

class CustomerApi {
	public static async getCustomerById(id: string): Promise<CustomerResponse> {
		const om = await requireOpenMeterClient().customers.get(id);
		if (!om) throw new Error(`客户 ${id} 不存在`);
		return mapOmCustomer(om);
	}

	public static async getCustomerByLookupKey(lookupKey: string): Promise<CustomerResponse> {
		return await this.getCustomerById(lookupKey);
	}

	public static async getCustomerByExternalId(externalId: string): Promise<CustomerResponse> {
		return await this.getCustomerById(externalId);
	}

	public static async getCustomers(filter: CustomerFilter = {}): Promise<ListCustomersResponse> {
		const client = getOpenMeterClient();
		if (!client) return { items: [], pagination: { limit: 0, offset: 0, total: 0 } };
		const query = buildOmCustomerListQuery(filter);
		const page = (await client.customers.list(query)) ?? { items: [], totalCount: 0, page: 1, pageSize: 0 };
		const items = filterCustomersClientSide(page.items.map(mapOmCustomer), filter);
		return { items, pagination: toFlexpricePagination(page, filter.limit, filter.offset) };
	}

	/** @deprecated Use getCustomers for GET /customers. Kept for backward compatibility. */
	public static async getAllCustomers({ limit = 10, offset = 0 }: Pagination): Promise<ListCustomersResponse> {
		return await this.getCustomers({ limit, offset });
	}

	/**
	 * List customers by filter (POST /customers/search 语义) with JSON body。
	 * OM 侧下推 name 部分匹配；其余 TypedBackendFilter 支持子集（name/email/external_id/id 的字符串匹配），
	 * 不支持的过滤条件静默跳过。
	 */
	public static async getCustomersByFilters(payload: GetCustomerByFiltersPayload): Promise<ListCustomersResponse> {
		const client = getOpenMeterClient();
		if (!client) return { items: [], pagination: { limit: payload.limit ?? 0, offset: payload.offset ?? 0, total: 0 } };
		const nameContains = payload.filters?.find((f) => f.field === 'name')?.value?.string;
		const query = buildOmCustomerListQuery(payload, nameContains);
		const page = (await client.customers.list(query)) ?? { items: [], totalCount: 0, page: 1, pageSize: 0 };
		let items = page.items.map(mapOmCustomer);
		for (const f of payload.filters ?? []) {
			items = applyClientFilter(items, f);
		}
		if (payload.metadata) {
			const metaFilters = Object.entries(payload.metadata);
			items = items.filter((c) => metaFilters.every(([k, v]) => c.metadata?.[k] === v));
		}
		return { items, pagination: toFlexpricePagination(page, payload.limit, payload.offset) };
	}

	public static async deleteCustomerById(id: string): Promise<void> {
		await requireOpenMeterClient().customers.delete(id);
	}

	public static async getCustomerSubscriptions(id: string): Promise<GetCustomerSubscriptionsResponse> {
		// DebugMenu 等调用方可能传空 id 兜底串；空 id 直接返回空集，避免 OM 端 `customers/` 尾斜杠 404。
		if (!id) return { items: [], pagination: { limit: 0, offset: 0, total: 0 } };
		const client = getOpenMeterClient();
		if (!client) return { items: [], pagination: { limit: 0, offset: 0, total: 0 } };
		const om = await client.customers.get(id);
		const subscriptions = om?.subscriptions ?? [];
		const customer = om ? mapOmCustomer(om) : undefined;
		return {
			items: subscriptions.map((sub) => mapOmSubscription(sub, customer ? { customer } : {})),
			pagination: { limit: subscriptions.length, offset: 0, total: subscriptions.length },
		};
	}

	public static async getCustomerSubscriptionById(id: string): Promise<Subscription> {
		const om = await requireOpenMeterClient().subscriptions.get(id);
		if (!om) throw new Error(`订阅 ${id} 不存在`);
		return mapOmSubscription(om) as Subscription;
	}

	public static async createCustomer(customer: CreateCustomerRequest): Promise<CustomerResponse> {
		const om = await requireOpenMeterClient().customers.create(buildOmCustomerCreate(customer));
		if (!om) throw new Error('创建客户失败');
		return mapOmCustomer(om);
	}

	/** OM update 是整对象替换：先取当前值合并补丁再发送（key 不变，见 buildOmCustomerUpdate）。 */
	public static async updateCustomer(customer: UpdateCustomerRequest, id: string): Promise<CustomerResponse> {
		const client = requireOpenMeterClient();
		const current = await client.customers.get(id);
		if (!current) throw new Error(`客户 ${id} 不存在`);
		const om = await client.customers.update(id, buildOmCustomerUpdate(current, customer));
		if (!om) throw new Error('更新客户失败');
		return mapOmCustomer(om);
	}

	public static async getEntitlements(payload: GetCustomerEntitlementPayload): Promise<GetCustomerEntitlementsResponse> {
		// entitlements 域由 EntitlementApi 承载；此处保持空态避免半成品映射
		return { customer_id: payload.customer_id, features: [] };
	}

	public static async getUsageSummary(payload: GetCustomerEntitlementPayload): Promise<GetUsageSummaryResponse> {
		return { customer_id: payload.customer_id, features: [] };
	}

	public static async getCustomerUsageSummary(queryParams: {
		external_customer_id?: string;
		customer_id?: string;
	}): Promise<GetUsageSummaryResponse> {
		return { customer_id: queryParams.customer_id ?? queryParams.external_customer_id ?? '', features: [] };
	}

	public static async getCustomerInvoiceSummary(customerId: string): Promise<Record<string, unknown>> {
		return { customer_id: customerId };
	}

	public static async getUpcomingCreditGrantApplications(_customerId: string): Promise<ListCreditGrantApplicationsResponse> {
		return { items: [], limit: 0, offset: 0, total: 0 };
	}

	/** OM OSS 客户门户为 noop 适配器，明确报错而非假 URL。 */
	public static async createDashboardSession(_externalId: string): Promise<DashboardSessionResponse> {
		throw new Error('OpenMeter 社区版未提供客户门户（portal 为 noop 适配器）');
	}

	/**
	 * Search customers by query string (searches name, email and key)
	 * If query is empty, returns all customers
	 */
	public static async searchCustomers(query: string, limit: number = 50): Promise<ListCustomersResponse> {
		if (!query || query.trim() === '') {
			return await this.getCustomersByFilters({ limit, offset: 0, filters: [], sort: [] });
		}
		const client = getOpenMeterClient();
		if (!client) return { items: [], pagination: { limit, offset: 0, total: 0 } };
		const page = (await client.customers.list({ pageSize: 100, page: 1 })) ?? { items: [], totalCount: 0, page: 1, pageSize: 0 };
		const q = query.trim().toLowerCase();
		const items = page.items
			.map(mapOmCustomer)
			.filter((c) => c.name.toLowerCase().includes(q) || c.email.toLowerCase().includes(q) || c.external_id.toLowerCase().includes(q));
		return paginationOf(items, limit);
	}
}

function paginationOf(items: CustomerResponse[], limit: number): { items: CustomerResponse[]; pagination: Pagination } {
	return { items, pagination: { limit, offset: 0, total: items.length } };
}

/** 支持子集的客户端过滤（POST /search 的 TypedBackendFilter）。非字符串值/不支持字段静默跳过。 */
function applyClientFilter(items: CustomerResponse[], f: TypedBackendFilter): CustomerResponse[] {
	if (f.data_type !== DataType.STRING || f.value?.string === undefined) return items;
	const v = String(f.value.string).toLowerCase();
	const contains = (s: string) => s.toLowerCase().includes(v);
	switch (f.field) {
		case 'name':
			return items.filter((c) => contains(c.name));
		case 'email':
			return items.filter((c) => contains(c.email));
		case 'external_id':
			return items.filter((c) => contains(c.external_id));
		case 'id':
			return items.filter((c) => contains(c.id));
		default:
			return items;
	}
}

export default CustomerApi;
