// src/api/CostSheetApi.ts
// 空态垫片：成本表与成本分析依赖 Flexprice 成本计费管线，OpenMeter OSS 无对应。
import { CostSheet } from '@/models';
import {
	CreateCostSheetRequest,
	UpdateCostSheetRequest,
	GetCostSheetsPayload,
	GetCostSheetsResponse,
	GetCostSheetsByFilterPayload,
	CostSheetResponse,
} from '@/types/dto';
import { GetCostAnalyticsRequest, GetDetailedCostAnalyticsResponse } from '@/types/dto/Cost';
import { unsupportedLocalOperation } from '@/core/services/platform/localPlatform';

class CostSheetApi {
	public static async ListCostSheets(payload: GetCostSheetsPayload = {}): Promise<GetCostSheetsResponse> {
		return { items: [], pagination: { limit: payload.limit ?? 0, offset: payload.offset ?? 0, total: 0 } };
	}

	public static async GetCostSheetById(_id: string): Promise<CostSheetResponse> {
		unsupportedLocalOperation('获取成本表详情');
	}

	public static async GetCostSheetByLookupKey(_lookupKey: string): Promise<CostSheetResponse> {
		unsupportedLocalOperation('按 lookup_key 获取成本表');
	}

	public static async CreateCostSheet(_data: CreateCostSheetRequest): Promise<CostSheet> {
		unsupportedLocalOperation('创建成本表');
	}

	public static async UpdateCostSheet(_id: string, _data: UpdateCostSheetRequest): Promise<CostSheet> {
		unsupportedLocalOperation('更新成本表');
	}

	public static async DeleteCostSheet(_id: string): Promise<void> {
		unsupportedLocalOperation('删除成本表');
	}

	public static async GetCostSheetsByFilter(payload: GetCostSheetsByFilterPayload): Promise<GetCostSheetsResponse> {
		return { items: [], pagination: { limit: payload.limit ?? 0, offset: payload.offset ?? 0, total: 0 } };
	}

	public static async GetActiveCostSheetForTenant(): Promise<CostSheetResponse> {
		unsupportedLocalOperation('获取租户当前生效成本表');
	}

	/** 成本分析（收入/成本/毛利/ROI 聚合）OM 无对应，返回零值空态并保留请求时间范围。 */
	public static async GetCostAnalytics(payload: GetCostAnalyticsRequest): Promise<GetDetailedCostAnalyticsResponse> {
		return {
			cost_analytics: [],
			total_revenue: '0',
			total_cost: '0',
			margin: '0',
			margin_percent: '0',
			roi: '0',
			roi_percent: '0',
			currency: 'USD',
			start_time: payload.start_time ?? '',
			end_time: payload.end_time ?? '',
		};
	}

	public static async GetCostAnalyticsV2(payload: GetCostAnalyticsRequest): Promise<GetDetailedCostAnalyticsResponse> {
		return this.GetCostAnalytics(payload);
	}
}

export default CostSheetApi;
