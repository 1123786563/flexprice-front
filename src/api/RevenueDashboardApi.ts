// src/api/RevenueDashboardApi.ts
// 空态垫片：收入仪表盘依赖 Flexprice 计费管线（发票/订阅收入聚合），OpenMeter OSS 无对应。
import { RevenueDashboardRequest, RevenueDashboardResponse } from '@/types/dto/RevenueDashboard';

class RevenueDashboardApi {
	public static async getRevenueDashboard(_payload: RevenueDashboardRequest): Promise<RevenueDashboardResponse> {
		return { summaries: {}, items: [], graph: null };
	}
}

export default RevenueDashboardApi;
