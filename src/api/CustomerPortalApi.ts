// src/api/CustomerPortalApi.ts
// 空态垫片：客户门户（token 鉴权的客户自助面板）为 Flexprice 门户域，OpenMeter OSS
// 无对应后端（portal 为 noop 适配器）。列表/分析返回空态，模型详情与支付/充值等
// 强依赖网关的操作明确报错；getConfig 直接返回前端默认配置。
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
import { unsupportedLocalOperation } from '@/core/services/platform/localPlatform';

/**
 * CustomerPortalApi - Customer-facing dashboard APIs
 * 本地空态垫片：OM OSS 未提供客户门户后端。
 */
class CustomerPortalApi {
	public static async getCustomer(): Promise<Customer> {
		unsupportedLocalOperation('获取门户客户信息');
	}

	public static async updateCustomer(_payload: UpdateCustomerRequest): Promise<Customer> {
		unsupportedLocalOperation('更新门户客户信息');
	}

	public static async getUsageSummary(_query?: GetCustomerUsageSummaryRequest): Promise<GetUsageSummaryResponse> {
		return { customer_id: '', features: [] };
	}

	public static async getSubscriptions(payload: DashboardPaginatedRequest): Promise<ListSubscriptionsResponse> {
		return {
			items: [],
			pagination: { limit: payload.limit ?? 0, offset: payload.offset ?? 0, total: 0 },
			sort: [],
			filters: [],
		};
	}

	public static async getSubscription(_id: string): Promise<SubscriptionResponse> {
		unsupportedLocalOperation('获取门户订阅详情');
	}

	public static async getInvoices(payload: DashboardPaginatedRequest): Promise<GetInvoicesResponse> {
		return { items: [], pagination: { limit: payload.limit ?? 0, offset: payload.offset ?? 0, total: 0 } };
	}

	public static async getInvoice(_id: string): Promise<Invoice> {
		unsupportedLocalOperation('获取门户发票详情');
	}

	public static async getWallets(): Promise<WalletResponse[]> {
		return [];
	}

	public static async getWallet(_id: string): Promise<WalletResponse> {
		unsupportedLocalOperation('获取门户钱包详情');
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

	public static async downloadInvoicePdf(_invoiceId: string): Promise<void> {
		unsupportedLocalOperation('下载发票 PDF');
	}

	public static async getWalletBalance(_walletId: string): Promise<RealtimeWalletBalance> {
		unsupportedLocalOperation('获取门户钱包实时余额');
	}

	public static async getWalletTransactions(payload: {
		walletId: string;
		limit?: number;
		offset?: number;
	}): Promise<WalletTransactionResponse> {
		return { items: [], pagination: { limit: payload.limit ?? 0, offset: payload.offset ?? 0, total: 0 } };
	}

	public static async topUpWallet(_walletId: string, _payload: PortalTopUpRequest): Promise<PortalTopUpResponse> {
		unsupportedLocalOperation('门户钱包充值');
	}

	public static async updateAutoTopup(_walletId: string, _payload: PortalAutoTopupRequest): Promise<unknown> {
		unsupportedLocalOperation('配置自动充值');
	}

	public static async payInvoice(_invoiceId: string, _payload: PortalPayInvoiceRequest = {}): Promise<PortalPayInvoiceResponse> {
		unsupportedLocalOperation('门户支付发票');
	}

	public static async getPaymentMethods(_query?: PortalListPaymentMethodsQuery): Promise<SavedPaymentMethodsResponse> {
		return { providers: [] };
	}

	public static async addPaymentMethod(_payload: PortalAddPaymentMethodRequest): Promise<AddPaymentMethodResponse> {
		unsupportedLocalOperation('添加支付方式');
	}

	public static async deletePaymentMethod(_payload: PortalDeletePaymentMethodRequest): Promise<SavedPaymentMethodsResponse> {
		unsupportedLocalOperation('删除支付方式');
	}

	public static async setDefaultPaymentMethod(_payload: PortalSetDefaultPaymentMethodRequest): Promise<SavedPaymentMethodsResponse> {
		unsupportedLocalOperation('设置默认支付方式');
	}

	public static async getIntegrations(): Promise<PortalIntegrationsResponse> {
		return { payment_integrations: [] };
	}

	public static async getCheckoutSession(_sessionId: string): Promise<PortalCheckoutSession> {
		unsupportedLocalOperation('查询支付会话');
	}

	public static async cancelCheckoutSession(_sessionId: string): Promise<PortalCheckoutSession> {
		unsupportedLocalOperation('取消支付会话');
	}

	/** OM 本地无租户门户配置存储，直接返回前端默认配置。 */
	public static async getConfig(): Promise<PortalConfig> {
		return DEFAULT_PORTAL_CONFIG;
	}
}

export default CustomerPortalApi;
