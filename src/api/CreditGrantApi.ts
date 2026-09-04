// src/api/CreditGrantApi.ts
// OpenMeter 承载（最弱映射域）：credit grant ↔ OM entitlement grant（挂客户 entitlement 的额度授予）。
// - list/search：OM v2 grants 全量拉取，按 grant metadata 的 flexprice.* 保留键（name/scope/
//   plan_id/addon_id/subscription_id）客户端过滤；外部创建的 grant 无保留键，带 scope 过滤时不匹配。
// - create：仅 SUBSCRIPTION scope 可落 OM（subscription → 客户；客户的 metered entitlement 必须唯一，
//   否则额度归属有歧义 → 如实报错）。PLAN/ADDON 目录级 grant 在 OM 无对应实体 → 明确报错。
// - delete → grant void（立即生效；OM 无定时 void，带 effective_date 时报错而非假成功）。
// - update/cancelFuture 无 OM 通路 → 明确报错。
import {
	CreateCreditGrantRequest,
	UpdateCreditGrantRequest,
	CreditGrantResponse,
	ListCreditGrantsResponse,
	CreditGrantFilter,
	SearchCreditGrantsRequest,
	SearchCreditGrantsResponse,
	CancelFutureCreditGrantRequest,
	DeleteCreditGrantRequest,
} from '@/types/dto';
import { getOpenMeterClient, requireOpenMeterClient } from '@/core/services/openmeter';
import { buildOmGrantCreate, filterGrantsClientSide, mapOmGrant } from '@/core/services/openmeter/mappers/creditGrant';
import { DataType } from '@/types/common/QueryBuilder';
import type { TypedBackendFilter } from '@/types/formatters/QueryBuilder';

class CreditGrantApi {
	/**
	 * Create a new credit grant
	 * @param data - Credit grant configuration
	 * @returns Promise<CreditGrantResponse>
	 */
	public static async create(data: CreateCreditGrantRequest): Promise<CreditGrantResponse> {
		const client = requireOpenMeterClient();
		// OM grant 必须挂在「客户 × entitlement(feature)」上；Flexprice 目录级（PLAN/ADDON）grant 无 OM 实体
		if (!data.subscription_id) {
			throw new Error(
				'OpenMeter 的 credit grant 挂在客户 entitlement 上：需要 subscription_id（PLAN/ADDON 目录级 grant 无 OpenMeter 对应，请在 plan 的 entitlement 卡上配置 issueAfterReset）',
			);
		}
		const subscription = await client.subscriptions.get(data.subscription_id);
		if (!subscription) throw new Error(`订阅 ${data.subscription_id} 不存在`);
		// 管理端 v2 列表支持按客户 + metered 类型过滤，直接定位可挂额度的 entitlement
		const entitlements = await client.entitlements.list({
			query: { customerIds: [subscription.customerId], entitlementType: ['metered'], pageSize: 100 },
		});
		const metered = entitlements?.items ?? [];
		if (metered.length === 0) {
			throw new Error(
				`客户 ${subscription.customerId} 没有 metered entitlement，credit grant 无处挂载（需先给订阅的 plan 配置 metered feature 的 entitlement）`,
			);
		}
		if (metered.length > 1) {
			const keys = metered.map((e) => e.featureKey).join(', ');
			throw new Error(`客户 ${subscription.customerId} 有多个 metered entitlement（${keys}），credit grant 归属有歧义，无法自动选择`);
		}
		const target = metered[0];
		const om = await client.customers.entitlements.createGrant(subscription.customerId, target.id, buildOmGrantCreate(data));
		if (!om) throw new Error('创建 credit grant 失败');
		return mapOmGrant(om);
	}

	/**
	 * Get a credit grant by ID
	 * @param id - Credit grant ID
	 * @returns Promise<CreditGrantResponse>
	 */
	public static async get(id: string): Promise<CreditGrantResponse> {
		const grants = await this.listOmGrants();
		const found = grants.find((g) => g.id === id);
		if (!found) throw new Error(`credit grant ${id} 不存在`);
		return found;
	}

	/**
	 * List credit grants with filters (GET method with query params)
	 * @param filters - Filter parameters
	 * @returns Promise<ListCreditGrantsResponse>
	 */
	public static async list(filters: CreditGrantFilter): Promise<ListCreditGrantsResponse> {
		const client = getOpenMeterClient();
		if (!client) return { items: [], limit: 0, offset: 0, total: 0 };
		const page = await client.entitlements.grants.list({ query: { pageSize: Math.max(1, filters.limit ?? 100), page: 1 } });
		const items = filterGrantsClientSide((page?.items ?? []).map(mapOmGrant), filters);
		return { items, limit: filters.limit ?? items.length, offset: filters.offset ?? 0, total: items.length };
	}

	/**
	 * Search credit grants with complex filters (POST /creditgrants/search)
	 * @param payload - Complex filters, sorts, and pagination
	 * @returns Promise<SearchCreditGrantsResponse>
	 */
	public static async search(payload: SearchCreditGrantsRequest): Promise<SearchCreditGrantsResponse> {
		const { items } = await this.list({ ...payload, limit: undefined });
		let filtered = items;
		for (const f of payload.filters ?? []) {
			filtered = applyClientFilter(filtered, f);
		}
		return {
			items: filtered,
			pagination: { total: filtered.length, limit: payload.limit ?? undefined, offset: payload.offset ?? undefined },
		};
	}

	/**
	 * Update a credit grant
	 * @param id - Credit grant ID
	 * @param data - Updated credit grant configuration
	 * @returns Promise<CreditGrantResponse>
	 */
	public static async update(_id: string, _data: UpdateCreditGrantRequest): Promise<CreditGrantResponse> {
		// OM grant 创建后不可修改（void+重建会清掉余额历史与生效语义），不做假成功
		throw new Error('OpenMeter 的 grant 不支持修改（可删除后重建）');
	}

	/**
	 * Delete a credit grant
	 * @param id - Credit grant ID
	 * @param data - Optional delete configuration with effective_date
	 * @returns Promise<void>
	 */
	public static async delete(id: string, data?: DeleteCreditGrantRequest): Promise<void> {
		if (data?.effective_date) {
			// OM void 立即生效，无定时能力；要求未来生效日期时如实报错
			throw new Error('OpenMeter 的 grant void 立即生效，不支持指定 effective_date');
		}
		await requireOpenMeterClient().entitlementsV1.grants.void(id);
	}

	/**
	 * Cancel future credit grant applications
	 * @param data - Cancel configuration
	 * @returns Promise<void>
	 */
	public static async cancelFuture(_data: CancelFutureCreditGrantRequest): Promise<void> {
		throw new Error('OpenMeter 无 credit grant 定期应用（cancel future）能力');
	}

	/** OM v2 grants 全量（分页拉平，上限保护）。 */
	private static async listOmGrants(): Promise<CreditGrantResponse[]> {
		const client = requireOpenMeterClient();
		const all: ReturnType<typeof mapOmGrant>[] = [];
		for (let page = 1; page <= 10; page++) {
			const result = await client.entitlements.grants.list({ query: { pageSize: 100, page } });
			all.push(...(result?.items ?? []).map(mapOmGrant));
			if (!result || result.items.length < 100 || all.length >= result.totalCount) break;
		}
		return all;
	}
}

/** TypedBackendFilter 支持子集（name/id 的字符串匹配）；其余静默跳过。 */
function applyClientFilter(items: CreditGrantResponse[], f: TypedBackendFilter): CreditGrantResponse[] {
	if (f.data_type !== DataType.STRING || f.value?.string === undefined) return items;
	const v = String(f.value.string).toLowerCase();
	const equals = (s: string | undefined) => s?.toLowerCase() === v;
	switch (f.field) {
		case 'name':
			return items.filter((g) => equals(g.name));
		case 'id':
			return items.filter((g) => equals(g.id));
		default:
			return items;
	}
}

export default CreditGrantApi;
