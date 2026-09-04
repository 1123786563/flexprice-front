// src/api/DashboardApi.ts
// OpenMeter 承载：营收趋势与发票支付状态由 billing.invoices 分页拉取后客户端聚合（按月/币种）。
// 订阅注册聚合（recent_subscriptions）无 OM 等价端点，保持零值空态；窗口粒度固定按月（UI 仅用 MONTH）。
import { getOpenMeterClient, type OpenMeterClient } from '@/core/services/openmeter';
import { WindowSize } from '@/models';
import { INVOICE_STATUS } from '@/models/Invoice';
import { invoiceStatusToOm, omNumeric, type OmInvoice } from '@/core/services/openmeter/mappers/invoice';
import { iso } from '@/core/services/openmeter/mappers/common';

export interface DashboardRevenuesRequest {
	revenue_trend?: {
		window_size?: WindowSize | string;
		window_count?: number;
	};
}

export interface RevenueTrendWindow {
	window_start: string;
	window_end: string;
	window_label: string;
	total_revenue: string; // String from backend
}

export interface CurrencyRevenueWindows {
	[currency: string]: {
		windows: RevenueTrendWindow[];
	};
}

export interface RevenueTrendResponse {
	currency_revenue_windows: CurrencyRevenueWindows;
	window_size?: string;
	window_count?: number;
	period_start?: string;
	period_end?: string;
}

export interface RecentSubscriptionPlan {
	plan_id: string;
	plan_name: string;
	count: number;
}

export interface RecentSubscriptionsResponse {
	total_count: number;
	plans: RecentSubscriptionPlan[]; // Changed from "by_plan" to "plans"
	period_start: string;
	period_end: string;
}

export interface InvoicePaymentStatusResponse {
	paid: number;
	pending: number;
	failed: number;
	processing?: number;
	refunded?: number;
	period_start: string;
	period_end: string;
}

export interface DashboardRevenuesResponse {
	revenue_trend?: RevenueTrendResponse;
	recent_subscriptions?: RecentSubscriptionsResponse;
	invoice_payment_status?: InvoicePaymentStatusResponse;
}

/** 聚合口径：已出账（issuing 起）且未作废的发票计入营收；gathering/draft 不计。 */
const REVENUE_OM_STATUSES = invoiceStatusToOm(INVOICE_STATUS.FINALIZED);
/** 全量拉取的分页保护上限（pageSize 100 × 10 页）。 */
const MAX_REVENUE_PAGES = 10;

interface MonthWindow {
	start: Date;
	/** 排他端点（下月首日）。 */
	end: Date;
	label: string;
}

/** 以 `now` 所在月为最后一窗，向前生成 count 个自然月窗口。 */
function buildMonthWindows(now: Date, count: number): MonthWindow[] {
	const windows: MonthWindow[] = [];
	for (let i = count - 1; i >= 0; i--) {
		const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
		const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i + 1, 1));
		windows.push({ start, end, label: `${start.getUTCFullYear()}-${String(start.getUTCMonth() + 1).padStart(2, '0')}` });
	}
	return windows;
}

/** 营收归属时间：账期起始优先，缺省回落出账/创建时间。 */
function invoiceRevenueDate(om: OmInvoice): string {
	return iso(om.period?.from ?? om.issuedAt ?? om.createdAt);
}

async function listRevenueInvoices(client: OpenMeterClient): Promise<OmInvoice[]> {
	const all: OmInvoice[] = [];
	for (let page = 1; page <= MAX_REVENUE_PAGES; page++) {
		const res = await client.billing.invoices.list({ page, pageSize: 100, statuses: REVENUE_OM_STATUSES });
		const items = res?.items ?? [];
		all.push(...items);
		if (items.length < 100) break;
	}
	return all;
}

class DashboardApi {
	/**
	 * Get dashboard revenues data (POST /dashboard/revenues 语义)。
	 * 客户端按月/币种聚合发票 total；发票状态推导支付状态计数；
	 * recent_subscriptions 为零值空态（OM 无订阅注册聚合端点）。window_size 仅支持按月。
	 */
	public static async getRevenues(payload?: DashboardRevenuesRequest): Promise<DashboardRevenuesResponse> {
		const windowCount = payload?.revenue_trend?.window_count || 3;
		const windows = buildMonthWindows(new Date(), windowCount);
		const periodStart = windows[0].start.toISOString();
		const periodEnd = windows[windows.length - 1].end.toISOString();

		const emptyResponse: DashboardRevenuesResponse = {
			revenue_trend: {
				currency_revenue_windows: {},
				window_size: 'MONTH',
				window_count: windowCount,
				period_start: periodStart,
				period_end: periodEnd,
			},
			recent_subscriptions: { total_count: 0, plans: [], period_start: periodStart, period_end: periodEnd },
			invoice_payment_status: { paid: 0, pending: 0, failed: 0, period_start: periodStart, period_end: periodEnd },
		};

		const client = getOpenMeterClient();
		if (!client) return emptyResponse;

		const invoices = await listRevenueInvoices(client);
		const revenueByCurrency = new Map<string, Map<string, number>>();
		const paymentCounts = { paid: 0, pending: 0, failed: 0, processing: 0, refunded: 0 };

		for (const om of invoices) {
			// 窗口外的发票不计入趋势（含空日期兜底：无归属时间的跳过趋势但计入状态计数）。
			const revenueDate = invoiceRevenueDate(om);
			const window = windows.find((w) => revenueDate >= w.start.toISOString() && revenueDate < w.end.toISOString());
			if (window) {
				const currency = om.currency.toLowerCase();
				const months = revenueByCurrency.get(currency) ?? new Map<string, number>();
				months.set(window.label, (months.get(window.label) ?? 0) + omNumeric(om.totals?.total));
				revenueByCurrency.set(currency, months);
			}
			switch (om.status) {
				case 'paid':
					paymentCounts.paid += 1;
					break;
				case 'payment_processing':
					paymentCounts.processing += 1;
					break;
				case 'uncollectible':
					paymentCounts.failed += 1;
					break;
				default:
					paymentCounts.pending += 1;
					break;
			}
		}

		const currencyRevenueWindows: CurrencyRevenueWindows = {};
		for (const [currency, months] of revenueByCurrency) {
			currencyRevenueWindows[currency] = {
				windows: windows.map((w) => ({
					window_start: w.start.toISOString(),
					window_end: w.end.toISOString(),
					window_label: w.label,
					total_revenue: String(months.get(w.label) ?? 0),
				})),
			};
		}

		return {
			revenue_trend: {
				currency_revenue_windows: currencyRevenueWindows,
				window_size: 'MONTH',
				window_count: windowCount,
				period_start: periodStart,
				period_end: periodEnd,
			},
			recent_subscriptions: emptyResponse.recent_subscriptions,
			invoice_payment_status: { ...paymentCounts, period_start: periodStart, period_end: periodEnd },
		};
	}
}

export default DashboardApi;
