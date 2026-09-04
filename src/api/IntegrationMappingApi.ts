// src/api/IntegrationMappingApi.ts
// 空态垫片：集成配置与实体映射同步为 Flexprice 集成域，OpenMeter OSS 无对应。
import { Pagination } from '@/models';
import { IntegrationDelinkRequest, IntegrationDelinkResponse } from '@/types/dto';
import { unsupportedLocalOperation } from '@/core/services/platform/localPlatform';

export interface SyncConfig {
	inbound: boolean;
	outbound: boolean;
}

export interface IntegrationConfigItem {
	provider: string;
	base_config: Record<string, SyncConfig>;
	current_config: Record<string, SyncConfig>;
}

export interface IntegrationConfigResponse {
	integrations: IntegrationConfigItem[];
}

export interface IntegrationMappingItem {
	id: string;
	entity_id: string;
	entity_type: string;
	provider_type: string;
	provider_entity_id: string;
	provider_url: string;
	environment_id: string;
	tenant_id: string;
	status: string;
	created_at: string;
	updated_at: string;
	created_by: string;
	updated_by: string;
}

export interface IntegrationMappingsResponse {
	items: IntegrationMappingItem[];
	pagination: Pagination;
}

export interface IntegrationSyncRequest {
	entity_type: string;
	entity_id: string;
	method?: 'push' | 'pull';
}

export interface IntegrationLinkRequest {
	entity_type: string;
	entity_id: string;
	provider_type: string;
	provider_entity_id: string;
	metadata?: Record<string, string>;
}

export interface IntegrationLinkResponse {
	mapping: IntegrationMappingItem;
}

class IntegrationMappingApi {
	public static async getIntegrationConfig(): Promise<IntegrationConfigResponse> {
		return { integrations: [] };
	}

	public static async getIntegrationMappings(_entityType: string, _entityId: string): Promise<IntegrationMappingsResponse> {
		return { items: [], pagination: { limit: 0, offset: 0, total: 0 } };
	}

	public static async syncIntegration(_request: IntegrationSyncRequest): Promise<{ message: string }> {
		unsupportedLocalOperation('触发集成同步');
	}

	public static async linkIntegration(_request: IntegrationLinkRequest): Promise<IntegrationLinkResponse> {
		unsupportedLocalOperation('创建集成映射');
	}

	public static async delinkIntegration(_request: IntegrationDelinkRequest): Promise<IntegrationDelinkResponse> {
		unsupportedLocalOperation('解除集成映射');
	}
}

export default IntegrationMappingApi;
