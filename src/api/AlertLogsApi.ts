// src/api/AlertLogsApi.ts
// 空态垫片：告警日志由 Flexprice 告警管线产生，OpenMeter OSS 无对应。
import { TypedBackendFilter, TypedBackendSort } from '@/types/formatters/QueryBuilder';
import { Pagination } from '@/models';

export interface AlertLog {
	id: string;
	alert_type: string;
	entity_type: string;
	entity_id: string;
	message: string;
	severity: 'info' | 'warning' | 'error' | 'critical';
	status: 'active' | 'resolved' | 'acknowledged';
	metadata?: Record<string, any>;
	created_at: string;
	updated_at: string;
}

export interface ListAlertLogsByFilterPayload extends Pagination {
	filters: TypedBackendFilter[];
	sort: TypedBackendSort[];
}

export interface ListAlertLogsResponse {
	items: AlertLog[];
	total: number;
	pagination: Pagination;
}

class AlertLogsApi {
	public static async listAlertLogsByFilter(payload: ListAlertLogsByFilterPayload): Promise<ListAlertLogsResponse> {
		return {
			items: [],
			total: 0,
			pagination: { limit: payload.limit ?? 0, offset: payload.offset ?? 0, total: 0 },
		};
	}
}

export default AlertLogsApi;
