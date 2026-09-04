// src/api/AiPricingParseApi.ts
// 空态垫片：Gemini 定价解析是 Flexprice 后端代理能力（服务端持有 API Key），
// OpenMeter OSS 无对应 AI 服务，本地模式明确报错。
import type { PricingSchema } from '@/api/ai/types';
import { unsupportedLocalOperation } from '@/core/services/platform/localPlatform';

export type GeminiResponseSchema = Record<string, unknown>;

export interface ParseGeminiPricingRequest {
	systemPrompt: string;
	userPrompt: string;
	responseSchema: GeminiResponseSchema;
}

class AiPricingParseApi {
	public static async parseGemini(_body: ParseGeminiPricingRequest): Promise<PricingSchema> {
		unsupportedLocalOperation('AI 定价解析（parse-gemini）');
	}
}

export default AiPricingParseApi;
