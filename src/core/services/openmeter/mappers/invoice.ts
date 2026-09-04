// src/core/services/openmeter/mappers/invoice.ts
// OM billing invoice ↔ Flexprice Invoice 双向映射。
// OM 无对应概念（tenant/payment 记账/PDF）填常量缺省；不可下推的过滤条件由 InvoiceApi 客户端兜底。
import type { OpenMeterClient } from '@/core/services/openmeter';
import { ENTITY_STATUS, type Customer, type Subscription } from '@/models';
import { INVOICE_BILLING_REASON, INVOICE_STATUS, INVOICE_TYPE, BILLING_CADENCE, type Invoice, type LineItem } from '@/models/Invoice';
import { PAYMENT_STATUS } from '@/constants/payment';
import type { SortDirection } from '@/types/common/QueryBuilder';
import type { TypedBackendFilter } from '@/types/formatters/QueryBuilder';
import type { CreateInvoicePayload, InvoiceFilter, VoidInvoicePayload } from '@/types/dto';
import type { Metadata } from '@/models';
import { iso } from './common';

export type OmInvoice = NonNullable<Awaited<ReturnType<OpenMeterClient['billing']['invoices']['get']>>>;
export type OmInvoicePage = NonNullable<Awaited<ReturnType<OpenMeterClient['billing']['invoices']['list']>>>;
export type OmInvoiceLine = NonNullable<OmInvoice['lines']>[number];
export type OmInvoiceListQuery = NonNullable<Parameters<OpenMeterClient['billing']['invoices']['list']>[0]>;
export type OmVoidInvoiceInput = Parameters<OpenMeterClient['billing']['invoices']['void']>[1];
export type OmPendingLineCreateInput = Parameters<OpenMeterClient['billing']['invoices']['createLineItems']>[1];

/** OM 全量发票状态（SKIPPED 无 OM 等价，永不映射）。 */
const ALL_OM_INVOICE_STATUSES: OmInvoice['status'][] = [
	'gathering',
	'draft',
	'issuing',
	'issued',
	'payment_processing',
	'overdue',
	'paid',
	'uncollectible',
	'voided',
];

/** OM InvoiceStatus → Flexprice INVOICE_STATUS：gathering/draft 为草稿，issuing 起视为已出账。 */
export function mapInvoiceStatus(status: OmInvoice['status']): INVOICE_STATUS {
	switch (status) {
		case 'gathering':
		case 'draft':
			return INVOICE_STATUS.DRAFT;
		case 'voided':
			return INVOICE_STATUS.VOIDED;
		default:
			return INVOICE_STATUS.FINALIZED;
	}
}

/** OM InvoiceStatus → Flexprice PAYMENT_STATUS（OM 无独立支付状态，由发票状态推导）。 */
export function mapPaymentStatus(status: OmInvoice['status']): PAYMENT_STATUS {
	switch (status) {
		case 'paid':
			return PAYMENT_STATUS.SUCCEEDED;
		case 'payment_processing':
			return PAYMENT_STATUS.PROCESSING;
		case 'uncollectible':
			return PAYMENT_STATUS.FAILED;
		default:
			return PAYMENT_STATUS.PENDING;
	}
}

/** Flexprice INVOICE_STATUS → OM 状态集（list 下推用）；SKIPPED/未知值返回空集（OM 无等价）。 */
export function invoiceStatusToOm(status: INVOICE_STATUS | string): OmInvoice['status'][] {
	switch (status) {
		case INVOICE_STATUS.DRAFT:
			return ['gathering', 'draft'];
		case INVOICE_STATUS.FINALIZED:
			return ['issuing', 'issued', 'payment_processing', 'overdue', 'paid', 'uncollectible'];
		case INVOICE_STATUS.VOIDED:
			return ['voided'];
		default:
			return [];
	}
}

/** OM Numeric（decimal 序列化为字符串）→ number，无法解析时兜底 0。 */
export function omNumeric(value: string | null | undefined): number {
	const parsed = Number(value ?? 0);
	return Number.isFinite(parsed) ? parsed : 0;
}

function mapOmLineItem(invoice: OmInvoice, line: OmInvoiceLine): LineItem {
	return {
		id: line.id,
		invoice_id: invoice.id,
		customer_id: invoice.customer.id ?? invoice.customer.key ?? '',
		subscription_id: line.subscription?.subscription.id,
		display_name: line.name,
		amount: omNumeric(line.totals?.total),
		quantity: line.quantity ?? '',
		currency: line.currency,
		period_start: iso(line.period?.from),
		period_end: iso(line.period?.to),
		metadata: (line.metadata as Metadata | undefined) ?? {},
		prepaid_credits_applied: omNumeric(line.totals?.creditsTotal),
		line_item_discount: omNumeric(line.totals?.discountsTotal),
		tenant_id: '',
		environment_id: '',
		created_by: '',
		updated_by: '',
		status: ENTITY_STATUS.PUBLISHED,
		created_at: iso(line.createdAt),
		updated_at: iso(line.updatedAt),
	};
}

/** OM billing 客户（扩展详情）→ Flexprice Customer 骨架；地址仅取首个邮寄地址的 country。 */
function buildCustomerSkeleton(customer: OmInvoice['customer']): Customer {
	return {
		id: customer.id ?? customer.key ?? '',
		name: customer.name ?? customer.key ?? '',
		email: '',
		external_id: customer.key ?? customer.id ?? '',
		address_line1: '',
		address_line2: '',
		address_city: '',
		address_state: '',
		address_postal_code: '',
		address_country: customer.addresses?.[0]?.country ?? '',
		metadata: {},
		tenant_id: '',
		environment_id: '',
		created_by: '',
		updated_by: '',
		status: ENTITY_STATUS.PUBLISHED,
		created_at: '',
		updated_at: '',
	};
}

export function mapOmInvoice(om: OmInvoice): Invoice {
	const customerId = om.customer.id ?? om.customer.key ?? '';
	const subscriptionId = om.lines?.find((line) => line.subscription)?.subscription?.subscription.id ?? '';
	const total = omNumeric(om.totals?.total);
	const isPaid = om.status === 'paid';
	const subscriptionSkeleton = {
		id: subscriptionId,
		lookup_key: subscriptionId,
		customer_id: customerId,
		plan_id: '',
	} as Subscription;
	return {
		id: om.id,
		customer_id: customerId,
		subscription_id: subscriptionId,
		invoice_type: om.type === 'credit_note' ? INVOICE_TYPE.CREDIT : subscriptionId ? INVOICE_TYPE.SUBSCRIPTION : INVOICE_TYPE.ONE_OFF,
		invoice_status: mapInvoiceStatus(om.status),
		payment_status: mapPaymentStatus(om.status),
		billing_period: subscriptionId ? BILLING_CADENCE.RECURRING : BILLING_CADENCE.ONETIME,
		currency: om.currency,
		invoice_pdf_url: '',
		amount_due: total,
		subtotal: omNumeric(om.totals?.amount),
		total,
		amount_paid: isPaid ? total : 0,
		amount_remaining: isPaid ? 0 : total,
		invoice_number: om.number || om.id,
		idempotency_key: '',
		billing_sequence: 0,
		description: om.description ?? '',
		due_date: iso(om.dueAt),
		period_start: iso(om.period?.from),
		period_end: iso(om.period?.to),
		paid_at: isPaid ? iso(om.collectionAt ?? om.issuedAt) : '',
		...(om.voidedAt ? { voided_at: iso(om.voidedAt) } : {}),
		finalized_at: iso(om.issuedAt),
		...(om.issuedAt ? { issue_date: iso(om.issuedAt) } : {}),
		billing_reason: INVOICE_BILLING_REASON.MANUAL,
		line_items: (om.lines ?? []).map((line) => mapOmLineItem(om, line)),
		total_tax: omNumeric(om.totals?.taxesTotal),
		total_discount: omNumeric(om.totals?.discountsTotal),
		version: 1,
		adjustment_amount: 0,
		refunded_amount: 0,
		total_prepaid_credits_applied: omNumeric(om.totals?.creditsTotal),
		overpaid_amount: 0,
		tenant_id: '',
		subscription: subscriptionSkeleton,
		customer: buildCustomerSkeleton(om.customer),
		environment_id: '',
		created_by: '',
		updated_by: '',
		status: ENTITY_STATUS.PUBLISHED,
		created_at: iso(om.createdAt),
		updated_at: iso(om.updatedAt),
	} as Invoice;
}

/** Flexprice 排序字段 → OM InvoiceOrderBy；无等价字段（invoice_number/due_date/amount_due）回落 createdAt。 */
const OM_ORDER_BY: Record<string, NonNullable<OmInvoiceListQuery['orderBy']>> = {
	created_at: 'createdAt',
	updated_at: 'updatedAt',
	period_start: 'periodStart',
	issued_at: 'issuedAt',
	finalized_at: 'issuedAt',
};

function omSortOrder(direction: SortDirection | undefined): NonNullable<OmInvoiceListQuery['order']> {
	return direction === 'asc' ? 'ASC' : 'DESC';
}

/** invoice_status[] → OM 下推状态集；全集/空集不下推（客户端兜底仍会执行）。 */
function pushdownStatuses(flexStatuses: string[] | undefined): OmInvoice['status'][] {
	if (!flexStatuses?.length) return [];
	const om = new Set<OmInvoice['status']>();
	for (const status of flexStatuses) {
		for (const mapped of invoiceStatusToOm(status)) om.add(mapped);
	}
	if (om.size >= ALL_OM_INVOICE_STATUSES.length) return [];
	return [...om];
}

/**
 * Flexprice InvoiceFilter（GET 与 POST /invoices/search 共用）→ OM listInvoices 查询。
 * 服务端可下推：状态集、customer、periodStart 区间、分页与排序；
 * payment_status / invoice_ids / 行项目跳过等由 filterInvoicesClientSide 客户端兜底。
 */
export function buildOmInvoiceListQuery(filter: InvoiceFilter): OmInvoiceListQuery {
	const limit = filter.limit ?? 100;
	const offset = filter.offset ?? 0;
	const page = Math.floor(offset / Math.max(1, limit)) + 1;
	const statuses = pushdownStatuses(filter.invoice_status);
	const customerId = filter.customer_id ?? filter.external_customer_id;
	const sort = filter.sort?.[0];
	const orderBy = (sort && OM_ORDER_BY[sort.field]) || 'createdAt';
	return {
		pageSize: limit,
		page,
		order: omSortOrder(sort?.direction),
		orderBy,
		expand: filter.skip_line_items ? undefined : ['lines'],
		...(statuses.length ? { statuses } : {}),
		...(customerId ? { customers: [customerId] } : {}),
		...(filter.period_start_gte ? { periodStartAfter: filter.period_start_gte } : {}),
		...(filter.period_start_lte ? { periodStartBefore: filter.period_start_lte } : {}),
	};
}

function matchesArrayFilter(value: string, values: string[] | undefined, notIn: boolean): boolean {
	if (!values?.length) return true;
	return values.includes(value) !== notIn;
}

/** TypedBackendFilter（POST /invoices/search 的查询构造器过滤）支持子集；不支持的字段/取值静默跳过。 */
function applyTypedFilter(items: Invoice[], f: TypedBackendFilter): Invoice[] {
	const operator = f.operator;
	switch (f.field) {
		case 'invoice_number': {
			const v = f.value?.string?.toLowerCase();
			if (!v) return items;
			return items.filter((i) => {
				const number = i.invoice_number.toLowerCase();
				if (operator === 'contains') return number.includes(v);
				if (operator === 'not_contains') return !number.includes(v);
				if (operator === 'eq') return number === v;
				return true;
			});
		}
		case 'customer_id':
			return items.filter((i) => matchesArrayFilter(i.customer_id, f.value?.array, operator === 'not_in'));
		case 'invoice_status':
			return items.filter((i) => matchesArrayFilter(i.invoice_status, f.value?.array, operator === 'not_in'));
		case 'payment_status':
			return items.filter((i) => matchesArrayFilter(i.payment_status, f.value?.array, operator === 'not_in'));
		case 'invoice_type':
			return items.filter((i) => matchesArrayFilter(i.invoice_type, f.value?.array, operator === 'not_in'));
		case 'status':
			return items.filter((i) => matchesArrayFilter(i.status, f.value?.array, operator === 'not_in'));
		case 'created_at':
		case 'due_date': {
			const boundary = f.value?.date;
			if (!boundary) return items;
			return items.filter((i) => {
				const raw = f.field === 'created_at' ? i.created_at : i.due_date;
				if (!raw) return false;
				if (operator === 'before') return raw < boundary;
				if (operator === 'after') return raw > boundary;
				return true;
			});
		}
		default:
			return items;
	}
}

/** 客户端兜底过滤：OM 不支持下推的字段在返回集上执行（跳过行项目仅用于轻量列表）。 */
export function filterInvoicesClientSide(items: Invoice[], filter: InvoiceFilter): Invoice[] {
	let result = items;
	if (filter.invoice_status?.length) {
		const statuses = new Set(filter.invoice_status);
		result = result.filter((i) => statuses.has(i.invoice_status));
	}
	if (filter.payment_status?.length) {
		const statuses = new Set(filter.payment_status);
		result = result.filter((i) => statuses.has(i.payment_status));
	}
	if (filter.invoice_ids?.length) {
		const ids = new Set(filter.invoice_ids);
		result = result.filter((i) => ids.has(i.id));
	}
	if (filter.invoice_type) {
		result = result.filter((i) => i.invoice_type === filter.invoice_type);
	}
	if (filter.subscription_id) {
		result = result.filter((i) => i.subscription_id === filter.subscription_id);
	}
	if (filter.amount_due_gt !== undefined) {
		result = result.filter((i) => i.amount_due > (filter.amount_due_gt as number));
	}
	if (filter.amount_remaining_gt !== undefined) {
		result = result.filter((i) => i.amount_remaining > (filter.amount_remaining_gt as number));
	}
	if (filter.period_end_gte) {
		result = result.filter((i) => !i.period_end || i.period_end >= (filter.period_end_gte as string));
	}
	if (filter.period_end_lte) {
		result = result.filter((i) => !i.period_end || i.period_end <= (filter.period_end_lte as string));
	}
	for (const f of filter.filters ?? []) {
		result = applyTypedFilter(result, f);
	}
	if (filter.skip_line_items) {
		result = result.map((i) => ({ ...i, line_items: [] }));
	}
	return result;
}

/** Flexprice VoidInvoicePayload（metadata 可携带 reason）→ OM void 输入：整单 100% discard。 */
export function buildOmVoidInput(payload?: VoidInvoicePayload): OmVoidInvoiceInput {
	const reason = payload?.metadata?.reason?.trim() || 'Voided via Flexprice UI';
	return {
		action: { percentage: 100, action: { type: 'discard' } },
		reason,
	};
}

/**
 * Flexprice CreateInvoicePayload（仅 ONE_OFF 固定金额行项目）→ OM 挂起行项目输入。
 * SUBSCRIPTION/CREDIT、订阅关联、优惠券与税率覆盖无法等价映射，调用方需先 ensureOneOffCreatable。
 */
export function ensureOneOffCreatable(payload: CreateInvoicePayload): void {
	if (payload.invoice_type && payload.invoice_type.toUpperCase() !== INVOICE_TYPE.ONE_OFF) {
		throw new Error(`OpenMeter 暂不支持创建 ${payload.invoice_type} 类型发票（仅 ONE_OFF）`);
	}
	if (payload.subscription_id) {
		throw new Error('OpenMeter 暂不支持创建订阅关联发票（仅一次性发票）');
	}
	if (payload.coupons?.length || payload.invoice_coupons?.length || payload.line_item_coupons?.length) {
		throw new Error('OpenMeter 暂不支持发票优惠券');
	}
	if (payload.tax_rate_overrides?.length) {
		throw new Error('OpenMeter 暂不支持税率覆盖');
	}
}

function nextMonth(from: Date): Date {
	return new Date(from.getFullYear(), from.getMonth() + 1, from.getDate());
}

/**
 * ONE_OFF 发票行 → OM 挂起行（flat 计价：amount 已含 quantity，页面上两者相乘后传入）。
 * period 缺省以 period_start/issue_date 起、后推一个月；invoiceAt 取 issue_date（补开发票场景）。
 */
export function buildOmPendingLineCreate(payload: CreateInvoicePayload): OmPendingLineCreateInput {
	const from = new Date(payload.period_start ?? payload.issue_date ?? Date.now());
	const to = payload.period_end ? new Date(payload.period_end) : nextMonth(from);
	const invoiceAt = new Date(payload.issue_date ?? from);
	const sourceLines = payload.line_items?.length
		? payload.line_items
		: [{ display_name: payload.description ?? 'One-off invoice', amount: payload.total ?? payload.amount_due ?? 0 }];
	return {
		currency: payload.currency,
		lines: sourceLines.map((line) => ({
			name: line.display_name?.trim() || 'Line item',
			period: { from, to },
			invoiceAt,
			rateCard: { price: { type: 'flat' as const, amount: String(line.amount ?? 0) } },
		})),
	};
}
