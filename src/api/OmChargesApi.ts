// src/api/OmChargesApi.ts
// OpenMeter 客户费用项（v3 charges）：挂客户的固定/用量计费项（不依赖订阅）。
// OSS 无 charges 手工调整（credits/adjustments 恒 501）；费用创建需要 invoice_at/
// settlement_mode 等完整 OM 语义，先提供 API 面，UI 以只读列表为主。
import { omV3 } from '@/core/services/openmeter/omFetch';

export interface OmCharge {
	id: string;
	name: string;
	description?: string;
	type: 'flat_fee' | 'usage_based';
	currency: string;
	status: string;
	created_at: string;
	updated_at: string;
	deleted_at?: string | null;
	// 具体字段随 type 不同（flat: amount_before_proration；usage: price/feature），原样透出
	[key: string]: unknown;
}

interface OmChargePage {
	data?: OmCharge[];
	meta?: { page?: { total?: number; number?: number; size?: number } };
}

class OmChargesApi {
	public static async listCharges(
		customerId: string,
		params?: { limit?: number; page?: number },
	): Promise<{ items: OmCharge[]; total: number }> {
		const page = await omV3<OmChargePage>(`/customers/${customerId}/charges`, {
			query: { 'page[size]': params?.limit ?? 20, 'page[number]': params?.page ?? 1 },
		});
		return { items: page.data ?? [], total: page.meta?.page?.total ?? page.data?.length ?? 0 };
	}

	/**
	 * 创建费用项：body 按类型透传（flat_fee / usage_based 的完整 OM 请求体），
	 * 校验与必填约束由后端负责——调用方需自行组装 invoice_at/service_period 等字段。
	 */
	public static async createCharge(customerId: string, charge: Record<string, unknown>): Promise<OmCharge> {
		return await omV3<OmCharge>(`/customers/${customerId}/charges`, { method: 'POST', body: charge });
	}
}

export default OmChargesApi;
