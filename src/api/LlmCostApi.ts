// src/api/LlmCostApi.ts
// OpenMeter AI 计量成本面（v3）：LLM 成本价格库（provider/model 定价，只读聚合自
// 内置数据库）+ 组织级价格覆盖（overrides）。feature 的单位成本（unit_cost=llm）
// 依此解析，成本经 features/{id}/cost/query 聚合（FeatureApi.queryFeatureCost）。
import { omV3 } from '@/core/services/openmeter/omFetch';

/** LLM 成本价格（数据库内置或覆盖产生）。 */
export interface LlmCostPrice {
	id: string;
	provider: string;
	model: { id?: string; name?: string } & Record<string, unknown>;
	pricing: Record<string, unknown>;
	currency: string;
	source: string;
	effective_from: string;
	created_at: string;
	updated_at: string;
}

export interface LlmCostOverride {
	id: string;
	provider: string;
	model_id: string;
	model_name?: string;
	pricing: Record<string, unknown>;
	currency: string;
	effective_from: string;
}

interface OmLlmCostPage<T> {
	data?: T[];
	meta?: { page?: { total?: number; number?: number; size?: number } };
}

class LlmCostApi {
	public static async listPrices(params?: {
		limit?: number;
		page?: number;
		provider?: string;
	}): Promise<{ items: LlmCostPrice[]; total: number }> {
		const page = await omV3<OmLlmCostPage<LlmCostPrice>>('/llm-cost/prices', {
			query: {
				'page[size]': params?.limit ?? 50,
				'page[number]': params?.page ?? 1,
				...(params?.provider ? { provider: params.provider } : {}),
			},
		});
		return { items: page.data ?? [], total: page.meta?.page?.total ?? page.data?.length ?? 0 };
	}

	public static async listOverrides(params?: { limit?: number; page?: number }): Promise<{ items: LlmCostOverride[]; total: number }> {
		const page = await omV3<OmLlmCostPage<LlmCostOverride>>('/llm-cost/overrides', {
			query: { 'page[size]': params?.limit ?? 50, 'page[number]': params?.page ?? 1 },
		});
		return { items: page.data ?? [], total: page.meta?.page?.total ?? page.data?.length ?? 0 };
	}

	/**
	 * 覆盖某 provider/model 的 token 定价（pricing 结构同 LLM 成本库：input/output 等
	 * token 类型到每 token 单价的映射）。
	 */
	public static async upsertOverride(payload: {
		provider: string;
		model_id: string;
		model_name?: string;
		currency: string;
		effective_from: string;
		pricing: Record<string, unknown>;
	}): Promise<LlmCostOverride> {
		return await omV3<LlmCostOverride>('/llm-cost/overrides', { method: 'POST', body: payload });
	}

	public static async deleteOverride(priceId: string): Promise<void> {
		await omV3(`/llm-cost/overrides/${priceId}`, { method: 'DELETE' });
	}
}

export default LlmCostApi;
