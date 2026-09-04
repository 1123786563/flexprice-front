// src/api/SecretKeysApi.ts
// 空态垫片：平台 API Key 管理由 Flexprice secrets 域承载，OpenMeter OSS 无鉴权/密钥体系。
import { Pagination, SecretKey } from '@/models';
import { GetAllSecretKeysResponse, CreateSecretKeyPayload, CreateSecretKeyResponse } from '@/types/dto';
import { unsupportedLocalOperation } from '@/core/services/platform/localPlatform';

// Utility function to format permissions for display
export const formatPermissionDisplay = (permissions: string[]): string => {
	const hasRead = permissions.includes('read');
	const hasWrite = permissions.includes('write');

	if (hasRead && hasWrite) {
		return 'full access';
	} else if (hasRead) {
		return 'read';
	} else if (hasWrite) {
		return 'write';
	} else {
		return 'none';
	}
};

class SecretKeysApi {
	public static async getAllSecretKeys(pagination: Pagination): Promise<GetAllSecretKeysResponse> {
		return { items: [], pagination: { limit: pagination.limit ?? 0, offset: pagination.offset ?? 0, total: 0 } };
	}

	public static async getSecretKeyById(_id: string): Promise<SecretKey> {
		unsupportedLocalOperation('获取 API Key 详情');
	}

	public static async createSecretKey(_data: CreateSecretKeyPayload): Promise<CreateSecretKeyResponse> {
		unsupportedLocalOperation('创建 API Key');
	}

	public static async deleteSecretKey(_id: string): Promise<void> {
		unsupportedLocalOperation('删除 API Key');
	}
}

export default SecretKeysApi;
