// src/api/PriceUnitApi.ts
// 空态垫片：计价单位目录为 Flexprice 价格域扩展，OpenMeter OSS 无对应。
import {
	CreatePriceUnitRequest,
	UpdatePriceUnitRequest,
	PriceUnitResponse,
	CreatePriceUnitResponse,
	ListPriceUnitsResponse,
	PriceUnitFilter,
} from '@/types/dto';
import { unsupportedLocalOperation } from '@/core/services/platform/localPlatform';

export class PriceUnitApi {
	public static async CreatePriceUnit(_data: CreatePriceUnitRequest): Promise<CreatePriceUnitResponse> {
		unsupportedLocalOperation('创建计价单位');
	}

	public static async ListPriceUnits(filters?: PriceUnitFilter): Promise<ListPriceUnitsResponse> {
		return { items: [], pagination: { limit: filters?.limit ?? 0, offset: filters?.offset ?? 0, total: 0 } };
	}

	public static async GetPriceUnit(_id: string): Promise<PriceUnitResponse> {
		unsupportedLocalOperation('获取计价单位详情');
	}

	public static async GetPriceUnitByCode(_code: string): Promise<PriceUnitResponse> {
		unsupportedLocalOperation('按 code 获取计价单位');
	}

	public static async UpdatePriceUnit(_id: string, _data: UpdatePriceUnitRequest): Promise<PriceUnitResponse> {
		unsupportedLocalOperation('更新计价单位');
	}

	public static async DeletePriceUnit(_id: string): Promise<void> {
		unsupportedLocalOperation('删除计价单位');
	}

	public static async ListPriceUnitsByFilter(filter: PriceUnitFilter): Promise<ListPriceUnitsResponse> {
		return { items: [], pagination: { limit: filter.limit ?? 0, offset: filter.offset ?? 0, total: 0 } };
	}
}
