// src/api/UsageRecordApi.ts
// 空态垫片：usage-records 为 Flexprice 外部计费系统对账域（供应商侧用量同步记录），
// OpenMeter OSS 无对应概念，返回空列表保持页面/hooks 零改动。
import { UsageRecordFilter, ListUsageRecordsResponse } from '@/types/dto';

class UsageRecordApi {
	public static async searchUsageRecords(payload: UsageRecordFilter): Promise<ListUsageRecordsResponse> {
		return {
			items: [],
			pagination: { limit: payload.limit ?? 0, offset: payload.offset ?? 0, total: 0 },
		};
	}
}

export default UsageRecordApi;
