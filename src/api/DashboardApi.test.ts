import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@/core/services/openmeter', () => ({
	getOpenMeterClient: vi.fn(),
	requireOpenMeterClient: vi.fn(),
}));

import { getOpenMeterClient } from '@/core/services/openmeter';
import DashboardApi from '@/api/DashboardApi';
import type { OmInvoice } from '@/core/services/openmeter/mappers/invoice';

const OM_INVOICE_BASE = {
	id: 'inv-1',
	type: 'standard',
	customer: { id: 'cust-1', usageAttribution: {} },
	number: 'INV-1',
	currency: 'USD',
	status: 'issued',
	totals: {
		amount: '100',
		chargesTotal: '100',
		discountsTotal: '0',
		creditsTotal: '0',
		taxesInclusiveTotal: '0',
		taxesExclusiveTotal: '0',
		taxesTotal: '0',
		total: '100',
	},
	period: { from: '2026-08-15T00:00:00Z', to: '2026-09-01T00:00:00Z' },
	createdAt: '2026-08-31T00:00:00Z',
	updatedAt: '2026-08-31T00:00:00Z',
} as const;

function omInvoice(overrides: Record<string, unknown>): OmInvoice {
	return { ...OM_INVOICE_BASE, ...overrides } as unknown as OmInvoice;
}

function monthStartIso(monthsAgo: number): string {
	const now = new Date();
	return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - monthsAgo, 1)).toISOString();
}

/** 窗口内某月的账期起点（营收归属按 period.from）。 */
function periodFrom(monthsAgo: number, day = 15): { from: string; to: string } {
	const now = new Date();
	const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - monthsAgo, day));
	const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - monthsAgo + 1, day));
	return { from: from.toISOString(), to: to.toISOString() };
}

function monthLabel(monthsAgo: number): string {
	const now = new Date();
	const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - monthsAgo, 1));
	return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function mockList(invoices: OmInvoice[]) {
	const list = vi.fn().mockResolvedValue({ items: invoices, totalCount: invoices.length, page: 1, pageSize: 100 });
	vi.mocked(getOpenMeterClient).mockReturnValue({ billing: { invoices: { list } } } as never);
	return list;
}

describe('DashboardApi（OpenMeter 承载）', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('getRevenues：按月/币种聚合已出账发票，窗口零填充，窗口外不计趋势', async () => {
		mockList([
			omInvoice({ id: 'inv-1', totals: { ...OM_INVOICE_BASE.totals, total: '100' }, period: periodFrom(0) }),
			omInvoice({ id: 'inv-2', totals: { ...OM_INVOICE_BASE.totals, total: '50.5' }, period: periodFrom(1) }),
			// 窗口外（3 个月前，window_count=3）——不计入趋势，但计入支付状态计数
			omInvoice({ id: 'inv-3', totals: { ...OM_INVOICE_BASE.totals, total: '200' }, period: periodFrom(3) }),
			omInvoice({
				id: 'inv-4',
				currency: 'EUR',
				status: 'paid',
				totals: { ...OM_INVOICE_BASE.totals, total: '30' },
				period: periodFrom(0),
			}),
		]);
		const res = await DashboardApi.getRevenues({ revenue_trend: { window_size: 'MONTH', window_count: 3 } });

		const trend = res.revenue_trend;
		expect(trend?.window_count).toBe(3);
		expect(trend?.window_size).toBe('MONTH');
		expect(trend?.period_start).toBe(monthStartIso(2));
		expect(trend?.period_end).toBe(monthStartIso(-1));

		const usd = trend?.currency_revenue_windows['usd'];
		expect(usd?.windows).toHaveLength(3);
		const usdByLabel = Object.fromEntries((usd?.windows ?? []).map((w) => [w.window_label, w.total_revenue]));
		expect(usdByLabel[monthLabel(0)]).toBe('100');
		expect(usdByLabel[monthLabel(1)]).toBe('50.5');
		expect(usdByLabel[monthLabel(2)]).toBe('0');

		const eur = trend?.currency_revenue_windows['eur'];
		const eurByLabel = Object.fromEntries((eur?.windows ?? []).map((w) => [w.window_label, w.total_revenue]));
		expect(eurByLabel[monthLabel(0)]).toBe('30');
		expect(eurByLabel[monthLabel(1)]).toBe('0');
	});

	it('getRevenues：支付状态计数由 OM 状态推导（paid/processing/uncollectible→failed/其余 pending）', async () => {
		mockList([
			omInvoice({ id: 'a', status: 'issued', period: periodFrom(0) }),
			omInvoice({ id: 'b', status: 'issued', period: periodFrom(1) }),
			omInvoice({ id: 'c', status: 'issued', period: periodFrom(3) }),
			omInvoice({ id: 'd', status: 'paid', period: periodFrom(0) }),
			omInvoice({ id: 'e', status: 'payment_processing', period: periodFrom(0) }),
			omInvoice({ id: 'f', status: 'uncollectible', period: periodFrom(0) }),
		]);
		const res = await DashboardApi.getRevenues();
		expect(res.invoice_payment_status).toMatchObject({ paid: 1, pending: 3, failed: 1, processing: 1 });
	});

	it('getRevenues：仅拉取已出账状态集（排除 gathering/draft/voided）', async () => {
		const list = mockList([]);
		await DashboardApi.getRevenues();
		expect(list).toHaveBeenCalledWith({
			page: 1,
			pageSize: 100,
			statuses: ['issuing', 'issued', 'payment_processing', 'overdue', 'paid', 'uncollectible'],
		});
	});

	it('getRevenues：分页拉全量（首页满页时翻页）', async () => {
		const firstPage = Array.from({ length: 100 }, (_, i) => omInvoice({ id: `inv-${i}` }));
		const list = vi
			.fn()
			.mockResolvedValueOnce({ items: firstPage, totalCount: 101, page: 1, pageSize: 100 })
			.mockResolvedValueOnce({ items: [omInvoice({ id: 'inv-100' })], totalCount: 101, page: 2, pageSize: 100 });
		vi.mocked(getOpenMeterClient).mockReturnValue({ billing: { invoices: { list } } } as never);

		const res = await DashboardApi.getRevenues();
		expect(list).toHaveBeenCalledTimes(2);
		expect(list).toHaveBeenNthCalledWith(2, expect.objectContaining({ page: 2, pageSize: 100 }));
		// 101 张 issued → pending 101
		expect(res.invoice_payment_status?.pending).toBe(101);
	});

	it('getRevenues：recent_subscriptions 零值空态（OM 无订阅注册聚合端点）', async () => {
		mockList([omInvoice({ id: 'inv-1', period: periodFrom(0) })]);
		const res = await DashboardApi.getRevenues();
		expect(res.recent_subscriptions).toEqual({
			total_count: 0,
			plans: [],
			period_start: monthStartIso(2),
			period_end: monthStartIso(-1),
		});
	});

	it('getRevenues：后端禁用优雅降级为空结构', async () => {
		vi.mocked(getOpenMeterClient).mockReturnValue(null);
		const res = await DashboardApi.getRevenues();
		expect(res.revenue_trend?.currency_revenue_windows).toEqual({});
		expect(res.recent_subscriptions?.total_count).toBe(0);
		expect(res.invoice_payment_status?.paid).toBe(0);
	});

	it('getRevenues：无发票时返回空窗口与零计数', async () => {
		mockList([]);
		const res = await DashboardApi.getRevenues();
		expect(Object.keys(res.revenue_trend?.currency_revenue_windows ?? {})).toHaveLength(0);
		expect(res.invoice_payment_status).toMatchObject({ paid: 0, pending: 0, failed: 0 });
	});
});
