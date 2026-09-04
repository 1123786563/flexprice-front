// src/api/PaymentApi.ts
// 空态垫片：支付记录与支付网关（Stripe/Moyasar）集成为 Flexprice 支付域，OpenMeter OSS 无对应。
import { Payment } from '@/models';
import { GetAllPaymentsPayload, GetAllPaymentsResponse, RecordPaymentPayload } from '@/types/dto';
import { unsupportedLocalOperation } from '@/core/services/platform/localPlatform';

class PaymentApi {
	public static async createPayment(_data: RecordPaymentPayload): Promise<Payment> {
		unsupportedLocalOperation('记录支付');
	}

	public static async getPaymentById(_id: string): Promise<Payment> {
		unsupportedLocalOperation('获取支付详情');
	}

	public static async updatePayment(_id: string, _data: Partial<Payment>): Promise<Payment> {
		unsupportedLocalOperation('更新支付');
	}

	public static async deletePayment(_id: string): Promise<void> {
		unsupportedLocalOperation('删除支付');
	}

	public static async getAllPayments(payload: GetAllPaymentsPayload): Promise<GetAllPaymentsResponse> {
		return { items: [], pagination: { limit: payload.limit ?? 0, offset: payload.offset ?? 0, total: 0 } };
	}

	public static async createSetupIntent(
		_customerId: string,
		_data: {
			success_url: string;
			cancel_url: string;
			provider: string;
			set_default?: boolean;
		},
	): Promise<{
		setup_intent_id: string;
		checkout_session_id: string;
		checkout_url: string;
		client_secret: string;
		status: string;
		usage: string;
		customer_id: string;
		created_at: number;
		expires_at: number;
	}> {
		unsupportedLocalOperation('创建支付设置意图');
	}

	public static async getMoyasarSetupIntent(
		_customerId: string,
		_successUrl?: string,
	): Promise<{
		status: string;
		customer_id: string;
		checkout_url: string;
	}> {
		unsupportedLocalOperation('创建 Moyasar 支付设置意图');
	}

	public static async processPayment(_id: string): Promise<Payment> {
		unsupportedLocalOperation('处理支付');
	}

	public static async getCustomerPaymentMethods(_customerId: string): Promise<unknown[]> {
		return [];
	}
}

export default PaymentApi;
