// src/api/TaskApi.ts
// 空态垫片：导入任务与定时任务为 Flexprice 批处理域，OpenMeter OSS 无对应。
import { ImportTask, ScheduledTask } from '@/models';
import {
	GetTasksPayload,
	GetTasksResponse,
	AddTaskPayload,
	GetScheduledTasksPayload,
	GetScheduledTasksResponse,
	CreateScheduledTaskPayload,
	UpdateScheduledTaskPayload,
	ForceRunPayload,
	DownloadTaskFileResponse,
} from '@/types/dto';
import { unsupportedLocalOperation } from '@/core/services/platform/localPlatform';

class TaskApi {
	// Regular Task Methods
	public static async addTask(_data: AddTaskPayload): Promise<ImportTask> {
		unsupportedLocalOperation('创建导入任务');
	}

	public static async getTaskById(_id: string): Promise<ImportTask> {
		unsupportedLocalOperation('获取导入任务详情');
	}

	public static async updateTaskStatus(_id: string, _status: string): Promise<ImportTask> {
		unsupportedLocalOperation('更新导入任务状态');
	}

	public static async getAllTasks(payload: GetTasksPayload = {}): Promise<GetTasksResponse> {
		return { items: [], pagination: { limit: payload.limit ?? 0, offset: payload.offset ?? 0, total: 0 } };
	}

	// Scheduled Task Methods
	public static async getAllScheduledTasks(payload: GetScheduledTasksPayload = {}): Promise<GetScheduledTasksResponse> {
		return { items: [], pagination: { limit: payload.limit ?? 0, offset: payload.offset ?? 0, total: 0 } };
	}

	public static async getScheduledTaskById(_id: string): Promise<ScheduledTask> {
		unsupportedLocalOperation('获取定时任务详情');
	}

	public static async createScheduledTask(_payload: CreateScheduledTaskPayload): Promise<ScheduledTask> {
		unsupportedLocalOperation('创建定时任务');
	}

	public static async updateScheduledTask(_id: string, _payload: UpdateScheduledTaskPayload): Promise<ScheduledTask> {
		unsupportedLocalOperation('更新定时任务');
	}

	public static async deleteScheduledTask(_id: string): Promise<void> {
		unsupportedLocalOperation('删除定时任务');
	}

	public static async forceRunScheduledTask(_id: string, _payload?: ForceRunPayload): Promise<void> {
		unsupportedLocalOperation('手动触发定时任务');
	}

	// Download Task File
	public static async downloadTaskFile(_id: string): Promise<DownloadTaskFileResponse> {
		unsupportedLocalOperation('下载任务文件');
	}
}

export default TaskApi;
