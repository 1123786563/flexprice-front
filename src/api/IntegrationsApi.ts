// src/api/IntegrationsApi.ts
// 空态垫片：第三方集成（LinkedIn 等）安装态由 Flexprice secrets 域管理，OpenMeter OSS 无对应。
import { CreateIntegrationRequest, IntegrationResponse, LinkedinIntegrationResponse } from '@/types/dto';
import { unsupportedLocalOperation } from '@/core/services/platform/localPlatform';

class IntegrationsApi {
	public static async installIntegration(request: CreateIntegrationRequest): Promise<void> {
		unsupportedLocalOperation(`安装集成 ${request.provider}`);
	}

	public static async getIntegration(_provider: string): Promise<IntegrationResponse> {
		return { items: [], pagination: { limit: 0, offset: 0, total: 0 } };
	}

	public static async getLinkedInIntegration(): Promise<LinkedinIntegrationResponse> {
		return { providers: [] };
	}

	public static async uninstallIntegration(provider: string): Promise<void> {
		unsupportedLocalOperation(`卸载集成 ${provider}`);
	}
}

export default IntegrationsApi;
