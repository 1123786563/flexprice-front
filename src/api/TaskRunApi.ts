// src/api/TaskRunApi.ts
// 空态垫片：任务运行记录为 Flexprice 批处理域，OpenMeter OSS 无对应。
import { unsupportedLocalOperation } from '@/core/services/platform/localPlatform';

export interface TaskRun {
	id: string;
	task_type: string;
	entity_type: string;
	file_url: string;
	file_type: string;
	task_status: string;
	total_records: number;
	processed_records: number;
	successful_records: number;
	failed_records: number;
	error_summary: string | null;
	metadata: {
		completed_at?: string;
		end_time?: string;
		file_size_bytes?: number;
		start_time?: string;
	};
	started_at?: string;
	completed_at?: string;
	failed_at?: string;
	environment_id: string;
	tenant_id: string;
	status: string;
	created_at: string;
	updated_at: string;
	created_by: string;
	updated_by: string;
}

export interface GetTaskRunsPayload {
	scheduled_task_id?: string;
	task_status?: string;
	task_type?: string;
	limit?: number;
	offset?: number;
}

export interface GetTaskRunsResponse {
	items: TaskRun[];
	pagination: {
		total: number;
		limit: number;
		offset: number;
	};
}

class TaskRunApi {
	public static async getAllTaskRuns(payload: GetTaskRunsPayload = {}): Promise<GetTaskRunsResponse> {
		return { items: [], pagination: { total: 0, limit: payload.limit ?? 0, offset: payload.offset ?? 0 } };
	}

	public static async getTaskRunById(_id: string): Promise<TaskRun> {
		unsupportedLocalOperation('获取任务运行详情');
	}

	public static async getTaskRunsByScheduledTaskId(
		scheduledTaskId: string,
		payload: Omit<GetTaskRunsPayload, 'scheduled_task_id'> = {},
	): Promise<GetTaskRunsResponse> {
		return this.getAllTaskRuns({ ...payload, scheduled_task_id: scheduledTaskId });
	}
}

export default TaskRunApi;
