// src/api/OAuthApi.ts
// 空态垫片：OAuth 授权流（后端保管凭据并交换 token）为 Flexprice 集成域，OpenMeter OSS 无对应。
import { unsupportedLocalOperation } from '@/core/services/platform/localPlatform';

// Request DTOs
export interface InitiateOAuthRequest {
	provider: string;
	name: string;
	credentials: Record<string, string>;
	metadata: Record<string, string>;
	sync_config?: {
		invoice?: {
			inbound: boolean;
			outbound: boolean;
		};
		customer?: {
			inbound: boolean;
			outbound: boolean;
		};
		payment?: {
			inbound: boolean;
			outbound: boolean;
		};
	};
}

export interface InitiateOAuthResponse {
	oauth_url: string;
	session_id: string;
}

export interface CompleteOAuthRequest {
	provider: string;
	session_id: string;
	code: string;
	state: string;
	realm_id?: string;
	organization_id?: string;
	organization_name?: string;
	location?: string;
	accounts_server?: string;
}

export interface CompleteOAuthResponse {
	success: boolean;
	connection_id: string;
}

/**
 * OAuthApi - Generic OAuth 2.0 API for all providers
 *
 * 本地空态垫片：OAuth 授权需要后端安全保管/交换凭据，OM OSS 无该后端，两个入口均明确报错。
 */
class OAuthApi {
	public static async InitiateOAuth(_payload: InitiateOAuthRequest): Promise<InitiateOAuthResponse> {
		unsupportedLocalOperation('发起 OAuth 授权');
	}

	public static async CompleteOAuth(_payload: CompleteOAuthRequest): Promise<CompleteOAuthResponse> {
		unsupportedLocalOperation('完成 OAuth 授权');
	}
}

export default OAuthApi;
