import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@/core/services/openmeter', () => ({
	getOpenMeterClient: vi.fn(),
	requireOpenMeterClient: vi.fn(),
}));

import { getOpenMeterClient, requireOpenMeterClient } from '@/core/services/openmeter';
import InvoiceApi from '@/api/InvoiceApi';
import { mapInvoiceStatus, mapPaymentStatus, invoiceStatusToOm, type OmInvoice } from '@/core/services/openmeter/mappers/invoice';
import { INVOICE_STATUS } from '@/models/Invoice';
import { PAYMENT_STATUS } from '@/constants/payment';

const INVOICE_ID = '01JINVPAID0000000000000000';
const CUSTOMER_ID = '01MCUST0000000000000000000';
const LINE_ID = '01JLINE0000000000000000000';

/** 运行时 OM 返回 JSON 字符串时间（SDK 类型声明为 Date），与 iso() 的归一口径一致。 */
const OM_INVOICE: OmInvoice = {
	id: INVOICE_ID,
	type: 'standard',
	description: 'Monthly invoice',
	customer: { id: CUSTOMER_ID, key: 'tenant-a', name: 'Tenant A', usageAttribution: {} },
	number: 'INV-2026-001',
	currency: 'USD',
	totals: {
		amount: '100.00',
		chargesTotal: '100.00',
		discountsTotal: '0',
		creditsTotal: '0',
		taxesInclusiveTotal: '0',
		taxesExclusiveTotal: '9.00',
		taxesTotal: '9.00',
		total: '109.00',
	},
	status: 'issued',
	statusDetails: { immutable: true, failed: false, extendedStatus: 'issued', availableActions: {} },
	issuedAt: '2026-08-31T10:00:00Z',
	dueAt: '2026-09-14T10:00:00Z',
	period: { from: '2026-08-01T00:00:00Z', to: '2026-09-01T00:00:00Z' },
	createdAt: '2026-08-31T10:00:00Z',
	updatedAt: '2026-08-31T10:00:00Z',
	lines: [
		{
			id: LINE_ID,
			name: 'Drill Plan',
			currency: 'USD',
			quantity: '1',
			totals: {
				amount: '100.00',
				chargesTotal: '100.00',
				discountsTotal: '0',
				creditsTotal: '0',
				taxesInclusiveTotal: '0',
				taxesExclusiveTotal: '9.00',
				taxesTotal: '9.00',
				total: '109.00',
			},
			period: { from: '2026-08-01T00:00:00Z', to: '2026-09-01T00:00:00Z' },
			invoiceAt: '2026-08-31T10:00:00Z',
			createdAt: '2026-08-31T10:00:00Z',
			updatedAt: '2026-08-31T10:00:00Z',
		},
	],
} as unknown as OmInvoice;

function omInvoiceWith(overrides: Record<string, unknown>): OmInvoice {
	return { ...OM_INVOICE, ...overrides } as unknown as OmInvoice;
}

function mockClient(invoiceOverrides: Record<string, unknown> = {}) {
	const client = {
		billing: {
			invoices: {
				get: vi.fn().mockResolvedValue(OM_INVOICE),
				list: vi.fn().mockResolvedValue({ items: [OM_INVOICE], totalCount: 1, page: 1, pageSize: 100 }),
				void: vi.fn().mockResolvedValue(omInvoiceWith({ status: 'voided', voidedAt: '2026-09-01T00:00:00Z' })),
				approve: vi.fn().mockResolvedValue(omInvoiceWith({ status: 'issued' })),
				createLineItems: vi.fn().mockResolvedValue({ lines: [{ id: LINE_ID }], invoice: OM_INVOICE, isInvoiceNew: true }),
				invoicePendingLines: vi.fn().mockResolvedValue([OM_INVOICE]),
				...invoiceOverrides,
			},
		},
	};
	vi.mocked(getOpenMeterClient).mockReturnValue(client as never);
	vi.mocked(requireOpenMeterClient).mockReturnValue(client as never);
	return client;
}

describe('InvoiceApi（OpenMeter 承载）', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('状态映射：OM InvoiceStatus → Flexprice 发票/支付状态（paid→FINALIZED+SUCCEEDED）', () => {
		expect(mapInvoiceStatus('gathering')).toBe(INVOICE_STATUS.DRAFT);
		expect(mapInvoiceStatus('draft')).toBe(INVOICE_STATUS.DRAFT);
		expect(mapInvoiceStatus('issuing')).toBe(INVOICE_STATUS.FINALIZED);
		expect(mapInvoiceStatus('issued')).toBe(INVOICE_STATUS.FINALIZED);
		expect(mapInvoiceStatus('payment_processing')).toBe(INVOICE_STATUS.FINALIZED);
		expect(mapInvoiceStatus('overdue')).toBe(INVOICE_STATUS.FINALIZED);
		expect(mapInvoiceStatus('paid')).toBe(INVOICE_STATUS.FINALIZED);
		expect(mapInvoiceStatus('uncollectible')).toBe(INVOICE_STATUS.FINALIZED);
		expect(mapInvoiceStatus('voided')).toBe(INVOICE_STATUS.VOIDED);

		expect(mapPaymentStatus('paid')).toBe(PAYMENT_STATUS.SUCCEEDED);
		expect(mapPaymentStatus('payment_processing')).toBe(PAYMENT_STATUS.PROCESSING);
		expect(mapPaymentStatus('uncollectible')).toBe(PAYMENT_STATUS.FAILED);
		expect(mapPaymentStatus('issued')).toBe(PAYMENT_STATUS.PENDING);
		expect(mapPaymentStatus('overdue')).toBe(PAYMENT_STATUS.PENDING);
		expect(mapPaymentStatus('draft')).toBe(PAYMENT_STATUS.PENDING);

		// 反向（list 下推）：DRAFT→草稿集，FINALIZED→已出账集，VOIDED→voided，SKIPPED→空集
		expect(invoiceStatusToOm(INVOICE_STATUS.DRAFT)).toEqual(['gathering', 'draft']);
		expect(invoiceStatusToOm(INVOICE_STATUS.VOIDED)).toEqual(['voided']);
		expect(invoiceStatusToOm(INVOICE_STATUS.FINALIZED)).toEqual([
			'issuing',
			'issued',
			'payment_processing',
			'overdue',
			'paid',
			'uncollectible',
		]);
		expect(invoiceStatusToOm(INVOICE_STATUS.SKIPPED)).toEqual([]);
	});

	it('getInvoiceById：金额/编号/账期/行项目映射', async () => {
		mockClient();
		const inv = await InvoiceApi.getInvoiceById(INVOICE_ID);
		expect(inv.id).toBe(INVOICE_ID);
		expect(inv.invoice_number).toBe('INV-2026-001');
		expect(inv.invoice_status).toBe(INVOICE_STATUS.FINALIZED);
		expect(inv.payment_status).toBe(PAYMENT_STATUS.PENDING);
		expect(inv.subtotal).toBe(100);
		expect(inv.total).toBe(109);
		expect(inv.amount_due).toBe(109);
		expect(inv.total_tax).toBe(9);
		expect(inv.amount_paid).toBe(0);
		expect(inv.amount_remaining).toBe(109);
		expect(inv.period_start).toBe('2026-08-01T00:00:00Z');
		expect(inv.period_end).toBe('2026-09-01T00:00:00Z');
		expect(inv.due_date).toBe('2026-09-14T10:00:00Z');
		expect(inv.finalized_at).toBe('2026-08-31T10:00:00Z');
		expect(inv.customer_id).toBe(CUSTOMER_ID);
		expect(inv.invoice_type).toBe('ONE_OFF');
		expect(inv.line_items).toHaveLength(1);
		expect(inv.line_items[0].display_name).toBe('Drill Plan');
		expect(inv.line_items[0].quantity).toBe('1');
		expect(inv.line_items[0].amount).toBe(109);
		expect(inv.customer?.id).toBe(CUSTOMER_ID);
	});

	it('getInvoiceById：paid 发票推导 SUCCEEDED、已付/待付金额与 paid_at', async () => {
		mockClient({
			get: vi.fn().mockResolvedValue(omInvoiceWith({ status: 'paid', collectionAt: '2026-09-02T00:00:00Z' })),
		});
		const inv = await InvoiceApi.getInvoiceById(INVOICE_ID);
		expect(inv.invoice_status).toBe(INVOICE_STATUS.FINALIZED);
		expect(inv.payment_status).toBe(PAYMENT_STATUS.SUCCEEDED);
		expect(inv.amount_paid).toBe(109);
		expect(inv.amount_remaining).toBe(0);
		expect(inv.paid_at).toBe('2026-09-02T00:00:00Z');
	});

	it('getInvoiceById：voided 发票映射 voided_at', async () => {
		mockClient({
			get: vi.fn().mockResolvedValue(omInvoiceWith({ status: 'voided', voidedAt: '2026-09-03T00:00:00Z' })),
		});
		const inv = await InvoiceApi.getInvoiceById(INVOICE_ID);
		expect(inv.invoice_status).toBe(INVOICE_STATUS.VOIDED);
		expect(inv.voided_at).toBe('2026-09-03T00:00:00Z');
	});

	it('listInvoices：状态集/customer/分页下推 OM，limit/offset → page/pageSize', async () => {
		const client = mockClient();
		const res = await InvoiceApi.listInvoices({
			limit: 10,
			offset: 20,
			invoice_status: [INVOICE_STATUS.DRAFT],
			customer_id: CUSTOMER_ID,
		});
		expect(client.billing.invoices.list).toHaveBeenCalledWith(
			expect.objectContaining({
				pageSize: 10,
				page: 3,
				statuses: ['gathering', 'draft'],
				customers: [CUSTOMER_ID],
				expand: ['lines'],
			}),
		);
		// mock 返回 issued 发票，客户端按 DRAFT 过滤后为空
		expect(res.items).toHaveLength(0);
		expect(res.pagination).toEqual({ limit: 10, offset: 20, total: 1 });
	});

	it('listInvoices：全集状态不下推；payment_status 客户端兜底过滤', async () => {
		const client = mockClient();
		const res = await InvoiceApi.listInvoices({
			invoice_status: Object.values(INVOICE_STATUS),
			payment_status: [PAYMENT_STATUS.PENDING],
		});
		const query = client.billing.invoices.list.mock.calls[0][0];
		expect(query.statuses).toBeUndefined();
		expect(res.items).toHaveLength(1);
		expect(res.items[0].payment_status).toBe(PAYMENT_STATUS.PENDING);
	});

	it('listInvoices：查询构造器 filters（invoice_number/customer_id）客户端过滤 + skip_line_items', async () => {
		const client = mockClient();
		const matched = await InvoiceApi.listInvoices({
			skip_line_items: true,
			filters: [
				{ field: 'invoice_number', operator: 'contains' as never, data_type: 'string' as never, value: { string: '2026-001' } },
				{ field: 'customer_id', operator: 'in' as never, data_type: 'array' as never, value: { array: [CUSTOMER_ID] } },
			],
		});
		expect(matched.items).toHaveLength(1);
		expect(matched.items[0].line_items).toEqual([]);

		const notMatched = await InvoiceApi.listInvoices({
			skip_line_items: true,
			filters: [{ field: 'invoice_number', operator: 'contains' as never, data_type: 'string' as never, value: { string: '999' } }],
		});
		expect(notMatched.items).toHaveLength(0);
		const query = client.billing.invoices.list.mock.calls[0][0];
		expect(query.expand).toBeUndefined();
	});

	it('listInvoices：invoice_ids 客户端过滤（详情页按 id 取单张）', async () => {
		mockClient();
		const res = await InvoiceApi.listInvoices({ invoice_ids: [INVOICE_ID], invoice_status: Object.values(INVOICE_STATUS) });
		expect(res.items).toHaveLength(1);
		expect(res.items[0].id).toBe(INVOICE_ID);

		const miss = await InvoiceApi.listInvoices({ invoice_ids: ['other'], invoice_status: Object.values(INVOICE_STATUS) });
		expect(miss.items).toHaveLength(0);
	});

	it('getCustomerInvoices：customer 下推 + periodStart 倒序 + 跳过行项目', async () => {
		const client = mockClient();
		const res = await InvoiceApi.getCustomerInvoices(CUSTOMER_ID, { limit: 5, offset: 0 });
		const query = client.billing.invoices.list.mock.calls[0][0];
		expect(query.customers).toEqual([CUSTOMER_ID]);
		expect(query.orderBy).toBe('periodStart');
		expect(query.order).toBe('DESC');
		expect(query.expand).toBeUndefined();
		expect(res.items[0].line_items).toEqual([]);
	});

	it('voidInvoice：整单 100% discard，metadata.reason 作为作废理由', async () => {
		const client = mockClient();
		await InvoiceApi.voidInvoice(INVOICE_ID, { metadata: { reason: 'double charge' } });
		expect(client.billing.invoices.void).toHaveBeenCalledWith(INVOICE_ID, {
			action: { percentage: 100, action: { type: 'discard' } },
			reason: 'double charge',
		});

		await InvoiceApi.voidInvoice(INVOICE_ID);
		expect(client.billing.invoices.void).toHaveBeenLastCalledWith(INVOICE_ID, {
			action: { percentage: 100, action: { type: 'discard' } },
			reason: 'Voided via Flexprice UI',
		});
	});

	it('finalizeInvoice：走 billing.approve 并映射结果', async () => {
		const client = mockClient();
		const inv = await InvoiceApi.finalizeInvoice(INVOICE_ID);
		expect(client.billing.invoices.approve).toHaveBeenCalledWith(INVOICE_ID);
		expect(inv.invoice_status).toBe(INVOICE_STATUS.FINALIZED);
	});

	it('createInvoice：ONE_OFF 两步创建（挂起行 flat 计价 → invoicePendingLines）', async () => {
		const client = mockClient();
		const inv = await InvoiceApi.createInvoice({
			customer_id: CUSTOMER_ID,
			invoice_type: 'ONE_OFF',
			currency: 'USD',
			amount_due: 50,
			total: 50,
			subtotal: 50,
			billing_reason: 'manual',
			period_start: '2026-08-01T00:00:00Z',
			line_items: [{ display_name: 'Setup fee', amount: 50, quantity: '1' }],
		});
		expect(client.billing.invoices.createLineItems).toHaveBeenCalledWith(CUSTOMER_ID, {
			currency: 'USD',
			lines: [
				expect.objectContaining({
					name: 'Setup fee',
					rateCard: { price: { type: 'flat', amount: '50' } },
				}),
			],
		});
		expect(client.billing.invoices.invoicePendingLines).toHaveBeenCalledWith({
			customerId: CUSTOMER_ID,
			filters: { lineIds: [LINE_ID] },
		});
		expect(inv.id).toBe(INVOICE_ID);
	});

	it('createInvoice：SUBSCRIPTION/优惠券/税率覆盖明确报错', async () => {
		mockClient();
		const base = {
			customer_id: CUSTOMER_ID,
			invoice_type: 'ONE_OFF',
			currency: 'USD',
			amount_due: 1,
			total: 1,
			subtotal: 1,
			billing_reason: 'manual',
		};
		await expect(InvoiceApi.createInvoice({ ...base, invoice_type: 'SUBSCRIPTION' })).rejects.toThrow(/ONE_OFF/);
		await expect(InvoiceApi.createInvoice({ ...base, coupons: ['c1'] })).rejects.toThrow(/优惠券/);
		await expect(InvoiceApi.createInvoice({ ...base, tax_rate_overrides: [{ tax_id: 't', rate: 10 }] as never })).rejects.toThrow(/税率/);
	});

	it('OM 无对应能力：PDF/重算/收款/通知/支付记账/预览明确报错（禁止假成功）', async () => {
		mockClient();
		await expect(InvoiceApi.recalculateInvoice(INVOICE_ID)).rejects.toThrow(/OpenMeter 暂不支持/);
		await expect(InvoiceApi.attemptPayment(INVOICE_ID)).rejects.toThrow(/OpenMeter 暂不支持/);
		await expect(InvoiceApi.triggerCommunication(INVOICE_ID)).rejects.toThrow(/OpenMeter 暂不支持/);
		await expect(InvoiceApi.updateInvoicePaymentStatus(INVOICE_ID, { payment_status: 'SUCCEEDED' })).rejects.toThrow(/OpenMeter 暂不支持/);
		await expect(
			InvoiceApi.getInvoicePreview({ period_start: '2026-08-01', period_end: '2026-09-01', subscription_id: 's1' }),
		).rejects.toThrow(/OpenMeter 暂不支持/);
		await expect(InvoiceApi.downloadInvoicePdf(INVOICE_ID)).rejects.toThrow(/PDF/);
	});

	it('后端禁用时列表优雅降级为空', async () => {
		vi.mocked(getOpenMeterClient).mockReturnValue(null);
		const res = await InvoiceApi.listInvoices({});
		expect(res.items).toEqual([]);
		expect(res.pagination.total).toBe(0);
	});
});
