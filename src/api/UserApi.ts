// src/api/UserApi.ts
// 本地用户垫片：/users/me 返回本地单管理员；成员/服务账户管理在 OpenMeter OSS 无对应能力，
// 读返回本账户（或空），写明确报错。updateUser（settings 里的租户信息编辑）落到本地租户状态。
import { User } from '@/models';
import { CreateUserRequest, UpdateTenantPayload } from '@/types/dto';
import {
	CreateServiceAccountPayload,
	CreateTenantUserRequest,
	CreateTenantUserResponse,
	GetServiceAccountsResponse,
} from '@/types/dto/UserApi';
import { getLocalUser, updateLocalTenant, unsupportedLocalOperation, LOCAL_USER_ID } from '@/core/services/platform/localPlatform';

export interface GetTenantMembersParams {
	limit: number;
	offset: number;
}

function pageOf(items: User[], limit: number, offset: number): GetServiceAccountsResponse {
	return {
		items: items.slice(offset, offset + limit),
		pagination: { total: items.length, limit, offset },
	};
}

export class UserApi {
	/** 成员列表：本地模式只有当前管理员一个账户。 */
	public static async getTenantMembers(params: GetTenantMembersParams): Promise<GetServiceAccountsResponse> {
		return await Promise.resolve(pageOf([getLocalUser()], params.limit, params.offset));
	}

	public static async getAllUsers(): Promise<GetServiceAccountsResponse> {
		return await Promise.resolve(pageOf([getLocalUser()], 1000, 0));
	}

	public static async getUserById(userId: string): Promise<User | undefined> {
		return await Promise.resolve(userId === LOCAL_USER_ID ? getLocalUser() : undefined);
	}

	public static async getServiceAccounts(
		params: { limit: number; offset: number } = { limit: 10, offset: 0 },
	): Promise<GetServiceAccountsResponse> {
		return await Promise.resolve(pageOf([], params.limit, params.offset));
	}

	public static async createUser(_data: CreateUserRequest): Promise<User> {
		unsupportedLocalOperation('创建成员');
	}

	public static async addUserToTenant(_data: CreateTenantUserRequest): Promise<CreateTenantUserResponse> {
		unsupportedLocalOperation('添加成员');
	}

	public static async createServiceAccount(_data: CreateServiceAccountPayload): Promise<User> {
		unsupportedLocalOperation('创建服务账户');
	}

	/** settings 的账户/租户资料编辑：落到本地租户状态。 */
	public static async updateUser(data: UpdateTenantPayload): Promise<User> {
		updateLocalTenant(data);
		return await Promise.resolve(getLocalUser());
	}

	public static async updateServiceAccount(_id: string, _data: { name?: string; metadata?: Record<string, string> }): Promise<User> {
		unsupportedLocalOperation('编辑服务账户');
	}

	public static async removeUserFromTenant(_userId: string): Promise<void> {
		unsupportedLocalOperation('移除成员');
	}

	public static async deleteUser(_userId: string): Promise<void> {
		unsupportedLocalOperation('删除账户');
	}

	public static async updateUserRoles(_id: string, _roles: string[]): Promise<User> {
		return await Promise.resolve(getLocalUser());
	}

	public static async me(): Promise<User> {
		return await Promise.resolve(getLocalUser());
	}
}

export default UserApi;
