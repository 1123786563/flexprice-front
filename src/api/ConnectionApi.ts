// src/api/ConnectionApi.ts
// 空态垫片：数据源连接（导入/导出后端存储）为 Flexprice 平台域，OpenMeter OSS 无对应。
import { Connection, ENTITY_STATUS } from '@/models';
import { GetConnectionsPayload, GetConnectionsResponse, CreateConnectionPayload, UpdateConnectionPayload } from '@/types/dto';
import { unsupportedLocalOperation } from '@/core/services/platform/localPlatform';

class ConnectionApi {
	public static async List(payload: GetConnectionsPayload = {}): Promise<GetConnectionsResponse> {
		return {
			connections: [],
			total: 0,
			limit: payload.limit ?? 0,
			offset: payload.offset ?? 0,
		};
	}

	public static async Get(_id: string): Promise<Connection> {
		unsupportedLocalOperation('获取数据源连接详情');
	}

	public static async ListPublished(): Promise<GetConnectionsResponse> {
		return this.List({ status: ENTITY_STATUS.PUBLISHED });
	}

	public static async Create(_payload: CreateConnectionPayload): Promise<Connection> {
		unsupportedLocalOperation('创建数据源连接');
	}

	public static async Update(_id: string, _payload: Partial<UpdateConnectionPayload>): Promise<Connection> {
		unsupportedLocalOperation('更新数据源连接');
	}

	public static async Delete(_id: string): Promise<void> {
		unsupportedLocalOperation('删除数据源连接');
	}
}

export default ConnectionApi;
