// src/api/CurrencyApi.ts
// OpenMeter 币种（v3）：ISO 法币枚举 + 自定义币种（credits 域联动）。表单静态
// `currencyOptions`（constants.ts）已覆盖 ISO 集合，此处承载自定义币种的 API 面
// 与未来动态币种源。
import { omV3 } from '@/core/services/openmeter/omFetch';

export interface OmCurrency {
	code: string;
	name: string;
	symbol: string;
	precision: number;
	decimal_mark: string;
	thousand_separator: string;
	type: 'fiat' | 'custom';
}

interface OmCurrencyPage {
	data?: OmCurrency[];
	meta?: { page?: { total?: number } };
}

class CurrencyApi {
	public static async listCurrencies(params?: { limit?: number; page?: number }): Promise<{ items: OmCurrency[]; total: number }> {
		const page = await omV3<OmCurrencyPage>('/currencies', {
			query: { 'page[size]': params?.limit ?? 250, 'page[number]': params?.page ?? 1 },
		});
		return { items: page.data ?? [], total: page.meta?.page?.total ?? page.data?.length ?? 0 };
	}

	/** 自定义币种（如积分/储值单位），可与自定义 cost-base 关联。 */
	public static async createCustomCurrency(payload: {
		code: string;
		name: string;
		symbol: string;
		precision: number;
		decimal_mark: string;
		thousand_separator: string;
	}): Promise<OmCurrency> {
		return await omV3<OmCurrency>('/currencies/custom', { method: 'POST', body: payload });
	}
}

export default CurrencyApi;
