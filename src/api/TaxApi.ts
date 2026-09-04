// src/api/TaxApi.ts
// 空态垫片：税率与税务关联为 Flexprice 计税域，OpenMeter OSS 无对应。
import {
	CreateTaxRateRequest,
	UpdateTaxRateRequest,
	TaxRateResponse,
	ListTaxRatesResponse,
	TaxRateFilter,
	CreateTaxAssociationRequest,
	TaxAssociationUpdateRequest,
	TaxAssociationResponse,
	ListTaxAssociationsResponse,
	TaxAssociationFilter,
} from '@/types/dto';
import { unsupportedLocalOperation } from '@/core/services/platform/localPlatform';

class TaxApi {
	// Tax Rate Methods
	public static async createTaxRate(_payload: CreateTaxRateRequest): Promise<TaxRateResponse> {
		unsupportedLocalOperation('创建税率');
	}

	public static async getTaxRate(_id: string): Promise<TaxRateResponse> {
		unsupportedLocalOperation('获取税率详情');
	}

	public static async listTaxRates(filter?: TaxRateFilter): Promise<ListTaxRatesResponse> {
		return { items: [], pagination: { limit: filter?.limit ?? 0, offset: filter?.offset ?? 0, total: 0 } };
	}

	public static async updateTaxRate(_id: string, _payload: UpdateTaxRateRequest): Promise<TaxRateResponse> {
		unsupportedLocalOperation('更新税率');
	}

	public static async deleteTaxRate(_id: string): Promise<void> {
		unsupportedLocalOperation('删除税率');
	}

	// Tax Association Methods
	public static async createTaxAssociation(_payload: CreateTaxAssociationRequest): Promise<TaxAssociationResponse> {
		unsupportedLocalOperation('创建税务关联');
	}

	public static async getTaxAssociation(_id: string): Promise<TaxAssociationResponse> {
		unsupportedLocalOperation('获取税务关联详情');
	}

	public static async updateTaxAssociation(_id: string, _payload: TaxAssociationUpdateRequest): Promise<TaxAssociationResponse> {
		unsupportedLocalOperation('更新税务关联');
	}

	public static async deleteTaxAssociation(_id: string): Promise<void> {
		unsupportedLocalOperation('删除税务关联');
	}

	public static async listTaxAssociations(filter?: TaxAssociationFilter): Promise<ListTaxAssociationsResponse> {
		return { items: [], pagination: { limit: filter?.limit ?? 0, offset: filter?.offset ?? 0, total: 0 } };
	}
}

export default TaxApi;
