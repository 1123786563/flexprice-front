// src/api/CustomerPortalApi.ts
// OpenMeter 承载（管理员门户视图）：OSS 的 portal token 服务是 noop 适配器（501），
// 无法签发客户自助 token——门户页改由管理会话驱动，客户身份经 `?customer=<id>`
// 进入（setPortalCustomerContext），数据全部从 admin API 组装：
// 客户/订阅/发票 → A 类域；钱包 → OM v3 credits（余额+流水+充值=发放 external grant）。
// PDF/在线支付/支付方式/自动充值无 OSS 后端——明确报错而非假成功。
import { Customer, Invoice, RealtimeWalletBalance } from '@/models';
import { UpdateCustomerRequest, GetUsageSummaryResponse } from '@/types/dto';
import {
	GetCustomerUsageSummaryRequest,
	DashboardPaginatedRequest,
	DashboardAnalyticsRequest,
	DashboardCostAnalyticsRequest,
} from '@/types';
import { SubscriptionResponse, ListSubscriptionsResponse } from '@/types/dto/Subscription';
import { GetInvoicesResponse } from '@/types/dto/InvoiceApi';
import { WalletResponse, WalletTransactionResponse } from '@/types/dto/Wallet';
import { GetUsageAnalyticsResponse } from '@/types/dto/Events';
import { GetDetailedCostAnalyticsResponse } from '@/types/dto/Cost';
import { PortalConfig, DEFAULT_PORTAL_CONFIG } from '@/types/dto/PortalConfig';
import {
	PortalTopUpRequest,
	PortalTopUpResponse,
	PortalAutoTopupRequest,
	PortalListPaymentMethodsQuery,
	SavedPaymentMethodsResponse,
	PortalAddPaymentMethodRequest,
	AddPaymentMethodResponse,
	PortalDeletePaymentMethodRequest,
	PortalSetDefaultPaymentMethodRequest,
	PortalPayInvoiceRequest,
	PortalPayInvoiceResponse,
	PortalIntegrationsResponse,
	PortalCheckoutSession,
} from '@/types/dto/CustomerPortalBilling';
import { WALLET_STATUS, WALLET_TYPE } from '@/models/Wallet';
import CustomerApi from '@/api/CustomerApi';
import SubscriptionApi from '@/api/SubscriptionApi';
import InvoiceApi from '@/api/InvoiceApi';
import CustomerCreditApi from '@/api/CustomerCreditApi';
import type { CustomerCreditBalance, CustomerCreditTransaction } from '@/api/CustomerCreditApi';

/** OM credits 合成钱包的 id 前缀（getWalletBalance/getWalletTransactions 解析币种用）。 */
const OM_CREDITS_WALLET_PREFIX = 'om-credits-';

let portalCustomerRaw: string | null = null;
let resolvedCustomer: Awaited<ReturnType<typeof CustomerApi.getCustomerById>> | null = null;

/**
 * 设定当前门户视图的客户标识（CustomerPortalWrapper 从 `?customer=` 传入；OM id、
 * lookup key 或 external id 均可，首次数据调用时解析）。传 null 清除（卸载时）。
 * OSS portal token 为 noop，管理端以会话身份代客户查看。
 */
export function setPortalCustomerContext(customer: string | null): void {
	portalCustomerRaw = customer;
	resolvedCustomer = null;
}

function requirePortalCustomerRaw(): string {
	if (!portalCustomerRaw) throw new Error('门户客户上下文缺失：请从客户门户入口（?customer=<客户ID>）进入');
	return portalCustomerRaw;
}

async function portalCustomerId(): Promise<string> {
	if (resolvedCustomer) return resolvedCustomer.id;
	const raw = requirePortalCustomerRaw();
	try {
		resolvedCustomer = await CustomerApi.getCustomerById(raw);
	} catch {
		try {
			resolvedCustomer = await CustomerApi.getCustomerByLookupKey(raw);
		} catch {
			resolvedCustomer = await CustomerApi.getCustomerByExternalId(raw);
		}
	}
	return resolvedCustomer.id;
}

/** credits 余额 → 合成钱包（按币种一个）。 */
function synthWallet(customerId: string, balance: CustomerCreditBalance): WalletResponse {
	return {
		id: `${OM_CREDITS_WALLET_PREFIX}${balance.currency}`,
		customer_id: customerId,
		name: 'OpenMeter Credits',
		currency: balance.currency,
		description: '',
		balance: balance.settled,
		credit_balance: balance.settled,
		wallet_status: WALLET_STATUS.ACTIVE,
		metadata: {},
		wallet_type: WALLET_TYPE.PRE_PAID,
		config: { allowed_price_types: [] },
		conversion_rate: '1',
		topup_conversion_rate: '1',
		created_at: '',
		updated_at: '',
	} as WalletResponse;
}

/** OM credits 流水 → Flexprice 钱包流水形状（funded→TOPUP，其余按流出计）。 */
function mapCreditTransaction(tx: CustomerCreditTransaction, customerId: string): WalletTransactionResponse['items'][number] {
	const isInflow = tx.type === 'funded';
	return {
		id: tx.id,
		amount: isInflow ? Number(tx.amount) : -Math.abs(Number(tx.amount)),
		balance_after: 0,
		balance_before: 0,
		created_at: tx.created_at,
		description: tx.name,
		metadata: {},
		reference_id: tx.id,
		reference_type: 'credit_transaction',
		transaction_status: 'COMPLETED',
		type: isInflow ? 'TOPUP' : 'DEBIT',
		wallet_id: `${OM_CREDITS_WALLET_PREFIX}${tx.currency}`,
		credit_amount: Math.abs(Number(tx.amount)),
		transaction_reason: isInflow ? 'TOPUP' : 'DEBIT',
		expiry_date: '',
		currency: tx.currency,
		customer_id: customerId,
	} as WalletTransactionResponse['items'][number];
}

class CustomerPortalApi {
	public static async getCustomer(): Promise<Customer> {
		// 触发解析（raw 可能是 OM id / lookup key / external id），直接返回解析结果
		await portalCustomerId();
		return resolvedCustomer as unknown as Customer;
	}

	public static async updateCustomer(payload: UpdateCustomerRequest): Promise<Customer> {
		const id = await portalCustomerId();
		const updated = await CustomerApi.updateCustomer(payload, id);
		return updated as unknown as Customer;
	}

	public static async getUsageSummary(_query?: GetCustomerUsageSummaryRequest): Promise<GetUsageSummaryResponse> {
		return { customer_id: await portalCustomerId(), features: [] };
	}

	public static async getSubscriptions(payload: DashboardPaginatedRequest): Promise<ListSubscriptionsResponse> {
		return await SubscriptionApi.searchSubscriptions({
			customer_id: await portalCustomerId(),
			limit: payload.limit ?? 10,
			offset: payload.offset ?? 0,
		});
	}

	public static async getSubscription(id: string): Promise<SubscriptionResponse> {
		return await SubscriptionApi.getSubscription(id);
	}

	public static async getInvoices(payload: DashboardPaginatedRequest): Promise<GetInvoicesResponse> {
		return await InvoiceApi.listInvoices({
			customer_id: await portalCustomerId(),
			limit: payload.limit ?? 100,
			offset: payload.offset ?? 0,
		});
	}

	public static async getInvoice(id: string): Promise<Invoice> {
		return await InvoiceApi.getInvoiceById(id);
	}

	/** OM credits 按币种各合成一个「钱包」。 */
	public static async getWallets(): Promise<WalletResponse[]> {
		const customerId = await portalCustomerId();
		const { balances } = await CustomerCreditApi.getBalancesForDisplay(customerId);
		return balances.map((balance) => synthWallet(customerId, balance));
	}

	public static async getWallet(walletId: string): Promise<WalletResponse> {
		const wallets = await this.getWallets();
		const found = wallets.find((w) => w.id === walletId) ?? wallets[0];
		if (!found) throw new Error('该客户暂无信用余额（OpenMeter Credits）');
		return found;
	}

	public static async getWalletBalance(walletId: string): Promise<RealtimeWalletBalance> {
		const customerId = await portalCustomerId();
		const currency = walletId.startsWith(OM_CREDITS_WALLET_PREFIX) ? walletId.slice(OM_CREDITS_WALLET_PREFIX.length) : '';
		const { balances } = await CustomerCreditApi.getBalancesForDisplay(customerId);
		const balance = balances.find((b) => b.currency === currency) ?? balances[0];
		if (!balance) throw new Error('该客户暂无信用余额（OpenMeter Credits）');
		return {
			customer_id: customerId,
			currency: balance.currency,
			balance: balance.settled,
			credit_balance: balance.settled,
			real_time_balance: balance.live,
			real_time_credit_balance: balance.live,
			wallet_status: WALLET_STATUS.ACTIVE,
			name: 'OpenMeter Credits',
			description: '',
			metadata: {},
			auto_topup_trigger: null as unknown as RealtimeWalletBalance['auto_topup_trigger'],
			auto_topup_min_balance: '0',
		} as unknown as RealtimeWalletBalance;
	}

	public static async getWalletTransactions(payload: {
		walletId: string;
		limit?: number;
		offset?: number;
	}): Promise<WalletTransactionResponse> {
		const customerId = await portalCustomerId();
		const page = await CustomerCreditApi.listTransactions(customerId, { limit: payload.limit ?? 20 });
		return {
			items: page.items.map((tx) => mapCreditTransaction(tx, customerId)),
			pagination: { limit: payload.limit ?? 0, offset: payload.offset ?? 0, total: page.items.length },
		};
	}

	public static async getAnalytics(_payload: DashboardAnalyticsRequest): Promise<GetUsageAnalyticsResponse> {
		return { total_cost: 0, currency: 'USD', items: [], custom_analytics: [] };
	}

	public static async getCostAnalytics(payload: DashboardCostAnalyticsRequest): Promise<GetDetailedCostAnalyticsResponse> {
		return {
			cost_analytics: [],
			total_revenue: '0',
			total_cost: '0',
			margin: '0',
			margin_percent: '0',
			roi: '0',
			roi_percent: '0',
			currency: 'USD',
			start_time: payload.start_time ?? '',
			end_time: payload.end_time ?? '',
		};
	}

	public static async downloadInvoicePdf(invoiceId: string): Promise<void> {
		void invoiceId;
		throw new Error('OpenMeter 社区版未提供发票 PDF 下载');
	}

	/**
	 * 充值 → OM credits 发放（funding_method=external，站外打款语义）。
	 * Flexprice 的在线收银台（checkout）OSS 无对应，直接入账。
	 */
	public static async topUpWallet(walletId: string, payload: PortalTopUpRequest): Promise<PortalTopUpResponse> {
		const customerId = await portalCustomerId();
		const currency = walletId.startsWith(OM_CREDITS_WALLET_PREFIX) ? walletId.slice(OM_CREDITS_WALLET_PREFIX.length) : 'USD';
		const grant = await CustomerCreditApi.createGrant(customerId, {
			name: payload.description || `Portal top-up (${payload.idempotency_key})`,
			currency,
			amount: payload.credits_to_add,
			funding_method: 'external',
		});
		return {
			wallet_transaction: {
				id: grant.id,
				amount: payload.credits_to_add,
				credits: payload.credits_to_add,
				transaction_status: 'COMPLETED',
			},
		};
	}

	public static async updateAutoTopup(_walletId: string, _payload: PortalAutoTopupRequest): Promise<unknown> {
		throw new Error('OpenMeter 暂不支持自动充值（credits 需显式发放）');
	}

	public static async payInvoice(_invoiceId: string, _payload: PortalPayInvoiceRequest = {}): Promise<PortalPayInvoiceResponse> {
		throw new Error('OpenMeter 社区版未提供在线支付（需集成 Stripe 应用后走 checkout）');
	}

	public static async getPaymentMethods(_query?: PortalListPaymentMethodsQuery): Promise<SavedPaymentMethodsResponse> {
		return { providers: [] };
	}

	public static async addPaymentMethod(_payload: PortalAddPaymentMethodRequest): Promise<AddPaymentMethodResponse> {
		throw new Error('OpenMeter 社区版未提供支付方式管理（需集成 Stripe 应用）');
	}

	public static async deletePaymentMethod(_payload: PortalDeletePaymentMethodRequest): Promise<SavedPaymentMethodsResponse> {
		throw new Error('OpenMeter 社区版未提供支付方式管理（需集成 Stripe 应用）');
	}

	public static async setDefaultPaymentMethod(_payload: PortalSetDefaultPaymentMethodRequest): Promise<SavedPaymentMethodsResponse> {
		throw new Error('OpenMeter 社区版未提供支付方式管理（需集成 Stripe 应用）');
	}

	public static async getIntegrations(): Promise<PortalIntegrationsResponse> {
		return { payment_integrations: [] };
	}

	public static async getCheckoutSession(_sessionId: string): Promise<PortalCheckoutSession> {
		throw new Error('OpenMeter 社区版未提供支付会话（需集成 Stripe 应用）');
	}

	public static async cancelCheckoutSession(_sessionId: string): Promise<PortalCheckoutSession> {
		throw new Error('OpenMeter 社区版未提供支付会话（需集成 Stripe 应用）');
	}

	/** OM 本地无租户门户配置存储，直接返回前端默认配置。 */
	public static async getConfig(): Promise<PortalConfig> {
		return DEFAULT_PORTAL_CONFIG;
	}
}

export default CustomerPortalApi;
