// src/api/SupportChatApi.ts
// 空态垫片：支持聊天身份令牌由 Flexprice 后端签发，OpenMeter OSS 无对应服务。
import { unsupportedLocalOperation } from '@/core/services/platform/localPlatform';

export interface SupportChatTokenResponse {
	token: string;
	expires_at: string;
}

class SupportChatApi {
	public static async getIdentityToken(): Promise<SupportChatTokenResponse> {
		unsupportedLocalOperation('获取支持聊天身份令牌');
	}
}

export default SupportChatApi;
