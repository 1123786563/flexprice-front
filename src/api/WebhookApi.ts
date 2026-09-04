// src/api/WebhookApi.ts
// 空态垫片：Svix webhook 门户为 Flexprice 托管集成，OpenMeter OSS 无对应，svix_enabled 恒为 false。
import { WebhookDashboardResponse } from '@/types/dto/webhook';

class WebhookApi {
	static async getWebhookDashboardUrl(): Promise<WebhookDashboardResponse> {
		return { svix_enabled: false };
	}
}

export default WebhookApi;
