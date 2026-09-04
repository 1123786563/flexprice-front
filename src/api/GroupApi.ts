// src/api/GroupApi.ts
// 空态垫片：实体分组为 Flexprice 平台域，OpenMeter OSS 无对应。
import { Pagination } from '@/models';
import {
	CreateGroupRequest,
	UpdateGroupRequest,
	GroupResponse,
	ListGroupsResponse,
	GroupFilter,
	AddEntityToGroupRequest,
} from '@/types/dto';
import { unsupportedLocalOperation } from '@/core/services/platform/localPlatform';

export class GroupApi {
	public static async createGroup(_data: CreateGroupRequest): Promise<GroupResponse> {
		unsupportedLocalOperation('创建实体分组');
	}

	public static async getAllGroups({ limit, offset }: Pagination): Promise<ListGroupsResponse> {
		return { items: [], pagination: { limit, offset, total: 0 } };
	}

	public static async getGroupById(_id: string): Promise<GroupResponse> {
		unsupportedLocalOperation('获取实体分组详情');
	}

	public static async updateGroup(_id: string, _data: UpdateGroupRequest): Promise<GroupResponse> {
		unsupportedLocalOperation('更新实体分组');
	}

	public static async deleteGroup(_id: string): Promise<void> {
		unsupportedLocalOperation('删除实体分组');
	}

	public static async searchGroups(_query: string, { limit, offset }: Pagination): Promise<ListGroupsResponse> {
		return { items: [], pagination: { limit, offset, total: 0 } };
	}

	public static async getGroupsByFilter(payload: GroupFilter): Promise<ListGroupsResponse> {
		return { items: [], pagination: { limit: payload.limit ?? 0, offset: payload.offset ?? 0, total: 0 } };
	}

	public static async addEntityToGroup(_id: string, _data: AddEntityToGroupRequest): Promise<GroupResponse> {
		unsupportedLocalOperation('向分组添加实体');
	}
}
