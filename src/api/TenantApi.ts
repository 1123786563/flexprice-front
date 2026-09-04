// src/api/TenantApi.ts
// 本地租户垫片：租户资料/元数据保存在 localStorage（onboarding 进度依赖 metadata.onboarding_completed）。
import { Tenant } from '@/models';
import { GetBillingdetailsResponse, UpdateTenantRequest } from '@/types/dto';
import { getLocalTenant, updateLocalTenant, unsupportedLocalOperation, LOCAL_TENANT_ID } from '@/core/services/platform/localPlatform';

class TenantApi {
	public static async getTenantById(id: string) {
		if (id !== LOCAL_TENANT_ID) unsupportedLocalOperation(`查询租户 ${id}`);
		return await Promise.resolve<Tenant>(getLocalTenant());
	}

	public static async updateTenant(data: UpdateTenantRequest) {
		return await Promise.resolve<Tenant>(updateLocalTenant(data));
	}

	public static async getTenantBillingDetails(): Promise<GetBillingdetailsResponse> {
		unsupportedLocalOperation('租户计费信息');
	}
}

export default TenantApi;
