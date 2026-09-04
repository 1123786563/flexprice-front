// src/api/RbacApi.ts
// 本地 RBAC 垫片：仅 super_admin 通配角色，RouteGuard 全放行。
import { getLocalRoles, unsupportedLocalOperation } from '@/core/services/platform/localPlatform';

export interface RbacRole {
	id: string;
	name: string;
	description: string;
	permissions: {
		[entity: string]: string[];
	};
}

export interface GetRolesResponse {
	roles: RbacRole[];
}

// The only role ID given special handling in UI (exclusive selection, full-access semantics).
// All other role IDs are treated as opaque, server-driven data.
export const SUPER_ADMIN_ROLE_ID = 'super_admin';

class RbacApi {
	public static async getAllRoles(_userType?: 'user' | 'service_account'): Promise<RbacRole[]> {
		return await Promise.resolve(getLocalRoles());
	}

	public static async getRoleById(id: string): Promise<RbacRole> {
		const role = getLocalRoles().find((r) => r.id === id);
		if (!role) unsupportedLocalOperation(`查询角色 ${id}`);
		return await Promise.resolve(role);
	}
}

export default RbacApi;
