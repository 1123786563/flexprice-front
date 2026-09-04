// src/api/WorkflowApi.ts
// 空态垫片：Temporal 工作流执行历史为 Flexprice 平台域，OpenMeter OSS 无对应。
import type {
	WorkflowExecutionFilterRequest,
	ListWorkflowsResponse,
	WorkflowDetailsResponse,
	WorkflowSummaryResponse,
	WorkflowTimelineResponse,
	BatchWorkflowsRequest,
	BatchWorkflowsResponse,
} from '@/types/dto';
import { unsupportedLocalOperation } from '@/core/services/platform/localPlatform';

class WorkflowApi {
	public static async search(payload: WorkflowExecutionFilterRequest): Promise<ListWorkflowsResponse> {
		return { items: [], pagination: { limit: payload.limit ?? 0, offset: payload.offset ?? 0, total: 0 } };
	}

	public static async getDetails(_workflowId: string, _runId: string): Promise<WorkflowDetailsResponse> {
		unsupportedLocalOperation('获取工作流执行详情');
	}

	public static async getSummary(_workflowId: string, _runId: string): Promise<WorkflowSummaryResponse> {
		unsupportedLocalOperation('获取工作流执行摘要');
	}

	public static async getTimeline(_workflowId: string, _runId: string): Promise<WorkflowTimelineResponse> {
		unsupportedLocalOperation('获取工作流执行时间线');
	}

	public static async getBatch(_payload: BatchWorkflowsRequest): Promise<BatchWorkflowsResponse> {
		return { workflows: [] };
	}
}

export default WorkflowApi;
