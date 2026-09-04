// src/api/CreditNoteApi.ts
// 空态垫片：贷记单为 Flexprice 发票冲抵域，OpenMeter OSS 无对应。
import {
	GetAllCreditNotesPayload,
	CreateCreditNoteParams,
	ProcessDraftCreditNoteParams,
	VoidCreditNoteParams,
	ListCreditNotesResponse,
	CreditNote,
} from '@/types/dto';
import { unsupportedLocalOperation } from '@/core/services/platform/localPlatform';

class CreditNoteApi {
	static async getCreditNotes(params: GetAllCreditNotesPayload = {}): Promise<ListCreditNotesResponse> {
		return { items: [], pagination: { limit: params.limit ?? 0, offset: params.offset ?? 0, total: 0 } };
	}

	static async getCreditNoteById(_creditNoteId: string): Promise<CreditNote> {
		unsupportedLocalOperation('获取贷记单详情');
	}

	static async createCreditNote(_params: CreateCreditNoteParams): Promise<CreditNote> {
		unsupportedLocalOperation('创建贷记单');
	}

	static async finalizeCreditNote(_params: ProcessDraftCreditNoteParams): Promise<CreditNote> {
		unsupportedLocalOperation('定稿贷记单');
	}

	/**
	 * @deprecated Use finalizeCreditNote instead
	 * This method is kept for backward compatibility
	 */
	static async processDraftCreditNote(params: ProcessDraftCreditNoteParams): Promise<CreditNote> {
		return this.finalizeCreditNote(params);
	}

	static async voidCreditNote(_params: VoidCreditNoteParams): Promise<CreditNote> {
		unsupportedLocalOperation('作废贷记单');
	}

	static async getCreditNotesByInvoice(invoiceId: string): Promise<ListCreditNotesResponse> {
		return this.getCreditNotes({ invoice_id: invoiceId });
	}
}

export default CreditNoteApi;
