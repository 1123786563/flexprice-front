// src/api/InvoiceApi.ts
// OpenMeter 承载：发票读走 billing.invoices（status/totals/lines 映射，list 需 expand lines）。
// void→billing.void、finalize→billing.approve、create→createLineItems+invoicePendingLines（仅 ONE_OFF）、
// 重算→v1 taxes/recalculate（SDK billing.recalculateTax）。
// OM OSS 无 PDF、手工支付记账、订阅发票预览与通知触达——明确报错而非假成功。
import { Invoice } from '@/models';
import { INVOICE_STATUS } from '@/models/Invoice';
import { SortDirection } from '@/types/common/QueryBuilder';
import {
	GetInvoicesResponse,
	GetInvoicesListResponse,
	InvoiceFilter,
	UpdatePaymentStatusPayload,
	UpdateInvoiceStatusPayload,
	GetInvoicePreviewPayload,
	CreateInvoicePayload,
	VoidInvoicePayload,
	RecalculateInvoiceResponse,
} from '@/types/dto';
import { getOpenMeterClient, requireOpenMeterClient } from '@/core/services/openmeter';
import {
	buildOmInvoiceListQuery,
	buildOmPendingLineCreate,
	buildOmVoidInput,
	ensureOneOffCreatable,
	filterInvoicesClientSide,
	mapOmInvoice,
} from '@/core/services/openmeter/mappers/invoice';
import { toFlexpricePagination } from '@/core/services/openmeter/mappers/common';
import { downloadInvoiceLineItemsCsv } from '@/utils/invoices/downloadInvoiceLineItemsCsv';

class InvoiceApi {
	/**
	 * List/search invoices by filter (POST /invoices/search 语义)。
	 * 服务端下推：状态集、customer、periodStart 区间、分页与排序；
	 * payment_status / invoice_ids / 查询构造器 filters 客户端兜底过滤。
	 * `skip_line_items: true` 时不展开行项目（line_items 为空数组），需要行项目请用 getInvoiceById。
	 */
	public static async listInvoices(filter: InvoiceFilter = {}): Promise<GetInvoicesResponse> {
		const client = getOpenMeterClient();
		if (!client) return { items: [], pagination: { limit: 0, offset: 0, total: 0 } };
		const page = (await client.billing.invoices.list(buildOmInvoiceListQuery(filter))) ?? {
			items: [],
			totalCount: 0,
			page: 1,
			pageSize: 0,
		};
		const items = filterInvoicesClientSide(page.items.map(mapOmInvoice), filter);
		return { items, pagination: toFlexpricePagination(page, filter.limit, filter.offset) };
	}

	/** List invoices for a single customer（skip_line_items 语义保留：轻量列表不展开行项目）。 */
	public static async getCustomerInvoices(
		customerId: string,
		pagination?: { limit: number; offset: number },
	): Promise<GetInvoicesListResponse> {
		return await this.listInvoices({
			customer_id: customerId,
			// 与 Flexprice 版一致：显式传全量状态（含 SKIPPED），映射为 OM 全集即不过滤。
			invoice_status: Object.values(INVOICE_STATUS),
			skip_line_items: true,
			sort: [{ field: 'period_start', direction: SortDirection.DESC }],
			...pagination,
		});
	}

	public static async getInvoiceById(invoiceId: string): Promise<Invoice> {
		const om = await requireOpenMeterClient().billing.invoices.get(invoiceId);
		if (!om) throw new Error(`发票 ${invoiceId} 不存在`);
		return mapOmInvoice(om);
	}

	/** OM void：仅已出账发票可作废；整单 100% discard，payload.metadata.reason 作为作废理由。 */
	public static async voidInvoice(invoiceId: string, payload?: VoidInvoicePayload): Promise<Invoice> {
		const om = await requireOpenMeterClient().billing.invoices.void(invoiceId, buildOmVoidInput(payload));
		if (!om) throw new Error('作废发票失败');
		return mapOmInvoice(om);
	}

	/** OM approve：审批并立即出账（draft→issued），对应 Flexprice finalize 语义。 */
	public static async finalizeInvoice(invoiceId: string): Promise<Invoice> {
		const om = await requireOpenMeterClient().billing.invoices.approve(invoiceId);
		if (!om) throw new Error('发票出账失败');
		return mapOmInvoice(om);
	}

	/**
	 * ONE_OFF 发票创建 → OM 两步：createLineItems（flat 计价挂起行）+ invoicePendingLines。
	 * SUBSCRIPTION/CREDIT、订阅关联、优惠券与税率覆盖无法等价映射，ensureOneOffCreatable 明确报错。
	 */
	public static async createInvoice(payload: CreateInvoicePayload): Promise<Invoice> {
		ensureOneOffCreatable(payload);
		const client = requireOpenMeterClient();
		const created = await client.billing.invoices.createLineItems(payload.customer_id, buildOmPendingLineCreate(payload));
		const lineIds = (created?.lines ?? []).map((line) => line.id);
		if (!lineIds.length) throw new Error('创建发票失败：OpenMeter 未创建行项目');
		const invoices = await client.billing.invoices.invoicePendingLines({
			customerId: payload.customer_id,
			filters: { lineIds },
		});
		const invoice = invoices?.[0];
		if (!invoice) throw new Error('创建发票失败：OpenMeter 未返回发票');
		return mapOmInvoice(invoice);
	}

	/** OM OSS 无手工支付记账——支付状态由发票状态推导（paid/payment_processing/uncollectible）。 */
	public static async updateInvoicePaymentStatus(_invoiceId: string, _payload: UpdatePaymentStatusPayload): Promise<Invoice> {
		throw new Error('OpenMeter 暂不支持手工更新发票支付状态（支付状态由发票状态自动推导）');
	}

	public static async updateInvoiceStatus(_payload: UpdateInvoiceStatusPayload): Promise<Invoice> {
		throw new Error('OpenMeter 暂不支持直接修改发票状态（请用作废/出账操作）');
	}

	public static async attemptPayment(_invoiceId: string) {
		throw new Error('OpenMeter 暂不支持手动发起收款');
	}

	public static async getInvoicePreview(_payload: GetInvoicePreviewPayload): Promise<Invoice> {
		throw new Error('OpenMeter 暂不支持订阅发票预览');
	}

	/** OM update 为整对象替换（supplier/customer/lines/workflow 必填），Flexprice 补丁语义无法等价映射。 */
	public static async updateInvoice(_invoiceId: string, _payload: Partial<Invoice>): Promise<Invoice> {
		throw new Error('OpenMeter 暂不支持补丁式更新发票（更新为整对象替换语义）');
	}

	/**
	 * 重算发票税额：v1 `POST /billing/invoices/{id}/taxes/recalculate`（同步返回重算后发票）。
	 * Flexprice 侧为异步 workflow 形状（message/workflow_id/run_id），调用方只消费成功/失败，
	 * workflow 字段以发票 id 回填。
	 */
	public static async recalculateInvoice(invoiceId: string): Promise<RecalculateInvoiceResponse> {
		const om = await requireOpenMeterClient().billing.invoices.recalculateTax(invoiceId);
		if (!om) throw new Error('重算发票失败');
		return { message: 'ok', workflow_id: om.id, run_id: om.id };
	}

	public static async getInvoicePdf(_invoiceId: string, _invoiceNo?: string): Promise<void> {
		throw new Error('OpenMeter 社区版未提供发票 PDF 下载');
	}

	public static async downloadInvoicePdf(_invoiceId: string): Promise<void> {
		throw new Error('OpenMeter 社区版未提供发票 PDF 下载');
	}

	/** 客户端导出行项目 CSV（amount > 0 触发下载），行为与 Flexprice 版一致。 */
	public static downloadInvoiceCsv(invoice: Invoice): number {
		return downloadInvoiceLineItemsCsv(invoice);
	}

	public static async triggerCommunication(_invoiceId: string) {
		throw new Error('OpenMeter 暂不支持手动触发发票通知');
	}
}

export default InvoiceApi;
