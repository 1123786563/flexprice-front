// src/api/EntityIntegrationMappingApi.ts
// 空态垫片：实体↔外部系统 ID 映射为 Flexprice 集成域，OpenMeter OSS 无对应。
import { Pagination } from '@/models';
import { unsupportedLocalOperation } from '@/core/services/platform/localPlatform';

export interface EntityIntegrationMapping {
	id: string;
	entity_type: string; // e.g., 'customer', 'subscription', 'invoice'
	entity_id: string;
	integration_provider: string; // e.g., 'stripe', 'hubspot', 'razorpay'
	external_id: string; // ID in the external system
	metadata?: Record<string, any>;
	created_at: string;
	updated_at: string;
}

export interface CreateEntityIntegrationMappingRequest {
	entity_type: string;
	entity_id: string;
	integration_provider: string;
	external_id: string;
	metadata?: Record<string, any>;
}

export interface ListEntityIntegrationMappingsResponse {
	items: EntityIntegrationMapping[];
	total: number;
	pagination: Pagination;
}

class EntityIntegrationMappingApi {
	public static async createEntityIntegrationMapping(_data: CreateEntityIntegrationMappingRequest): Promise<EntityIntegrationMapping> {
		unsupportedLocalOperation('创建实体集成映射');
	}

	public static async listEntityIntegrationMappings(
		payload: Pagination = { limit: 10, offset: 0 },
	): Promise<ListEntityIntegrationMappingsResponse> {
		return {
			items: [],
			total: 0,
			pagination: { limit: payload.limit ?? 0, offset: payload.offset ?? 0, total: 0 },
		};
	}

	public static async getEntityIntegrationMapping(_id: string): Promise<EntityIntegrationMapping> {
		unsupportedLocalOperation('获取实体集成映射详情');
	}

	public static async deleteEntityIntegrationMapping(_id: string): Promise<void> {
		unsupportedLocalOperation('删除实体集成映射');
	}
}

export default EntityIntegrationMappingApi;
