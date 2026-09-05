// src/api/CustomerCreditApi.ts
// OpenMeter 承载：客户 credits（v3 账本支持的货币化信用额度，需后端 credits.enabled）。
// 与 CreditGrantApi 的 entitlement grant（v2 用量额度）是两个不同域：credits 是
// 货币化余额（发放→结算→消费），对位 Flexprice 的钱包概念。
// OSS 现状：balance/grants/transactions 可用；手工调整（credits/adjustments）上游恒 501。
import { omV3 } from '@/core/services/openmeter/omFetch';

/** 按币种的信用余额：settled=已入账、pending=已发放未入账、live=扣除在途费用后可用。 */
export interface CustomerCreditBalance {
	currency: string;
	settled: string;
	pending: string;
	live: string;
}

export interface CustomerCreditGrant {
	id: string;
	name: string;
	description?: string;
	/** funding：none=赠送类发放、invoice=站内发票结算、external=站外打款。 */
	funding_method: 'none' | 'invoice' | 'external';
	currency: string;
	amount: string;
	priority?: number;
	created_at: string;
	updated_at: string;
	deleted_at?: string | null;
}

export interface CustomerCreditTransaction {
	id: string;
	name: string;
	type: string;
	currency: string;
	amount: string;
	booked_at: string;
	created_at: string;
}

export interface CustomerCreditsPage<T> {
	items: T[];
	total: number;
	nextCursor?: string | null;
}

interface OmCursorPage<T> {
	data: T[];
	meta?: { page?: { next?: string | null; previous?: string | null; size?: number } };
}

interface OmOffsetPage<T> {
	data: T[];
	meta?: { page?: { total?: number; number?: number; size?: number } };
}

class CustomerCreditApi {
	private static async getBalances(customerId: string): Promise<{ balances: CustomerCreditBalance[]; retrieved_at: string }> {
		return await omV3<{ balances: CustomerCreditBalance[]; retrieved_at: string }>(`/customers/${customerId}/credits/balance`);
	}

	/** 主币种余额（多币种时返回 settled 余额最高的币种）。无任何余额时返回 null。 */
	public static async getPrimaryBalance(customerId: string): Promise<CustomerCreditBalance | null> {
		const { balances } = await this.getBalances(customerId);
		if (balances.length === 0) return null;
		return [...balances].sort((a, b) => Number(b.settled) - Number(a.settled))[0];
	}

	public static async getBalancesForDisplay(customerId: string): Promise<{ balances: CustomerCreditBalance[]; retrieved_at: string }> {
		return await this.getBalances(customerId);
	}

	public static async listTransactions(
		customerId: string,
		params?: { limit?: number; cursor?: string },
	): Promise<CustomerCreditsPage<CustomerCreditTransaction>> {
		// v3 cursor 分页为 deepObject 风格：page[size] / page[after]
		const page = await omV3<OmCursorPage<CustomerCreditTransaction>>(`/customers/${customerId}/credits/transactions`, {
			query: { 'page[size]': params?.limit ?? 20, ...(params?.cursor ? { 'page[after]': params.cursor } : {}) },
		});
		return { items: page.data ?? [], total: page.data?.length ?? 0, nextCursor: page.meta?.page?.next ?? null };
	}

	public static async listGrants(
		customerId: string,
		params?: { limit?: number; page?: number },
	): Promise<CustomerCreditsPage<CustomerCreditGrant>> {
		const page = await omV3<OmOffsetPage<CustomerCreditGrant>>(`/customers/${customerId}/credits/grants`, {
			query: { 'page[size]': params?.limit ?? 20, 'page[number]': params?.page ?? 1 },
		});
		return { items: page.data ?? [], total: page.meta?.page?.total ?? page.data?.length ?? 0 };
	}

	/**
	 * 发放信用额度（v3 credits grant）。funding_method 必填：none=赠送类发放，
	 * invoice=站内发票结算，external=站外打款（如手工对账）。
	 */
	public static async createGrant(
		customerId: string,
		payload: { name: string; currency: string; amount: string; funding_method?: 'none' | 'invoice' | 'external'; description?: string },
	): Promise<CustomerCreditGrant> {
		return await omV3<CustomerCreditGrant>(`/customers/${customerId}/credits/grants`, {
			method: 'POST',
			body: {
				name: payload.name,
				currency: payload.currency,
				amount: payload.amount,
				funding_method: payload.funding_method ?? 'none',
				...(payload.description ? { description: payload.description } : {}),
			},
		});
	}

	public static async voidGrant(customerId: string, grantId: string): Promise<void> {
		await omV3(`/customers/${customerId}/credits/grants/${grantId}/void`, { method: 'POST', body: {} });
	}
}

export default CustomerCreditApi;
