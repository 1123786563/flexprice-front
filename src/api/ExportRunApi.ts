// src/api/ExportRunApi.ts
// 空态垫片：导出任务运行记录为 Flexprice 定时导出域，OpenMeter OSS 无对应。
import { unsupportedLocalOperation } from '@/core/services/platform/localPlatform';

export interface ExportRun {
	id: string;
	scheduled_task_id: string;
	status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
	started_at?: string;
	completed_at?: string;
	error_message?: string;
	records_processed?: number;
	records_exported?: number;
	file_size_bytes?: number;
	file_path?: string;
	created_at: string;
	updated_at: string;
}

export interface GetExportRunsPayload {
	scheduled_task_id?: string;
	status?: string;
	limit?: number;
	offset?: number;
}

export interface GetExportRunsResponse {
	items: ExportRun[];
	pagination: {
		total: number;
		limit: number;
		offset: number;
	};
}

class ExportRunApi {
	public static async getAllExportRuns(payload: GetExportRunsPayload = {}): Promise<GetExportRunsResponse> {
		return { items: [], pagination: { total: 0, limit: payload.limit ?? 0, offset: payload.offset ?? 0 } };
	}

	public static async getExportRunById(_id: string): Promise<ExportRun> {
		unsupportedLocalOperation('获取导出运行详情');
	}

	public static async getExportRunsByTaskId(
		taskId: string,
		payload: Omit<GetExportRunsPayload, 'scheduled_task_id'> = {},
	): Promise<GetExportRunsResponse> {
		return this.getAllExportRuns({ ...payload, scheduled_task_id: taskId });
	}
}

export default ExportRunApi;
