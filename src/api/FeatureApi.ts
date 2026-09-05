// src/api/FeatureApi.ts
// OpenMeter 承载：feature CRUD 走 OM features（key↔lookup_key、meterSlug↔meter_id，
// description/unit/reporting_unit/group/alert/config 收进 OM metadata 的 flexprice.* 保留键）。
// OM 仅支持原位 PATCH unit_cost（updateFeatureUnitCost）；其余字段更新无原生 update，
// updateFeature 以 delete+create 重建（key/meter/metadata 保真，id 会变化；
// 被 plan/addon rate card 引用时 OM 会拒绝删除并如实报错）。
// 内嵌 meter 的创建（CreateFeatureRequest.meter）OM 需两步：先 meters.create 再 features.create。
import {
	CreateFeatureRequest,
	UpdateFeatureRequest,
	FeatureResponse,
	ListFeaturesResponse,
	FeatureFilter,
	GetFeaturesPayload,
	GetFeaturesResponse,
	GetFeatureByFilterPayload,
	UpdateFeaturePayload,
} from '@/types/dto';
import { Feature, FEATURE_TYPE } from '@/models';
import { getOpenMeterClient, requireOpenMeterClient } from '@/core/services/openmeter';
import type { OpenMeterClient } from '@/core/services/openmeter';
import { omV3 } from '@/core/services/openmeter/omFetch';
import {
	buildOmFeatureCreate,
	buildOmFeatureListQuery,
	buildOmMeterCreate,
	buildOmFeatureMetadata,
	filterFeaturesClientSide,
	mapOmFeature,
	mapOmMeter,
} from '@/core/services/openmeter/mappers/feature';
import type { OmMeterQueryPostBody } from '@/core/services/openmeter/mappers/meter';
import type { TypedBackendFilter } from '@/types/formatters/QueryBuilder';
import { DataType } from '@/types/common/QueryBuilder';

/**
 * Feature 单位成本配置：`manual` 固定单位成本（USD），`llm` 从 LLM 成本库按 provider/
 * model/token type 解析（三维度各自可静态指定或指向 meter group-by 属性，互斥）。
 */
export type FeatureUnitCostInput =
	| { type: 'manual'; amount: string }
	| {
			type: 'llm';
			provider?: string;
			provider_property?: string;
			model?: string;
			model_property?: string;
			token_type?: string;
			token_type_property?: string;
	  };

type OmFeature = NonNullable<Awaited<ReturnType<OpenMeterClient['features']['get']>>>;

class FeatureApi {
	/**
	 * Create a new feature
	 * @param data Feature creation data
	 * @returns Created feature response
	 */
	public static async createFeature(data: CreateFeatureRequest): Promise<FeatureResponse> {
		const client = requireOpenMeterClient();
		// Flexprice 允许内嵌 meter 一步建表；OM 分两步：先建 meter，再把 slug 挂到 feature 上。
		let meterSlug: string | undefined;
		if (data.type === FEATURE_TYPE.METERED && data.meter) {
			const meter = await client.meters.create(buildOmMeterCreate(data.meter));
			meterSlug = meter?.slug;
		} else if (data.meter_id) {
			meterSlug = data.meter_id;
		}
		if (data.type === FEATURE_TYPE.METERED && !meterSlug) {
			throw new Error('metered feature 需要 meter（内嵌 meter 或 meter_id）');
		}
		const om = await client.features.create(buildOmFeatureCreate(data, meterSlug));
		if (!om) throw new Error('创建 feature 失败');
		return mapOmFeature(om);
	}

	/**
	 * Get a feature by ID
	 * @param id Feature ID
	 * @returns Feature response
	 */
	public static async getFeatureById(id: string): Promise<FeatureResponse> {
		const om = await requireOpenMeterClient().features.get(id);
		if (!om) throw new Error(`feature ${id} 不存在`);
		const feature = mapOmFeature(om);
		// meter 详情尽力补全（expand=meters 语义）；meter 缺失不阻塞 feature 读取
		if (om.meterSlug) {
			try {
				const meter = await getOpenMeterClient()?.meters.get(om.meterSlug);
				if (meter) feature.meter = mapOmMeter(meter);
			} catch {
				// meter 已删除/不可读时仅缺省展开字段
			}
		}
		return feature;
	}

	/**
	 * List features with optional filtering (GET /features)
	 * @param filter Feature filter parameters
	 * @returns List of features with pagination
	 */
	public static async listFeatures(filter: FeatureFilter = {}): Promise<ListFeaturesResponse> {
		const client = getOpenMeterClient();
		if (!client) return { items: [], pagination: { limit: 0, offset: 0, total: 0 } };
		const omFeatures = (await client.features.list(buildOmFeatureListQuery(filter))) ?? [];
		const items = filterFeaturesClientSide(omFeatures.map(mapOmFeature), filter);
		return { items, pagination: { limit: filter.limit ?? items.length, offset: filter.offset ?? 0, total: items.length } };
	}

	/**
	 * Update a feature by ID
	 * @param id Feature ID
	 * @param data Feature update data
	 * @returns Updated feature response
	 */
	public static async updateFeature(id: string, data: UpdateFeatureRequest): Promise<FeatureResponse> {
		const client = requireOpenMeterClient();
		const current = await client.features.get(id);
		if (!current) throw new Error(`feature ${id} 不存在`);
		// OM 无 update 端点：保 key/meterSlug 与未覆盖的 metadata 保留键（含原 type），
		// delete+create 重建（id 会变化；被 rate card 引用时 OM 拒绝删除并如实报错）
		const create: Parameters<typeof client.features.create>[0] = {
			key: current.key,
			name: data.name ?? current.name,
			metadata: buildOmFeatureMetadata(
				{
					description: data.description,
					metadata: data.metadata,
					unit_singular: data.unit_singular,
					unit_plural: data.unit_plural,
					reporting_unit: data.reporting_unit,
					group_id: data.group_id,
					alert_settings: data.alert_settings,
					config_value: data.config_value,
				},
				current.metadata,
			),
			...(current.meterSlug ? { meterSlug: current.meterSlug } : {}),
		};
		await client.features.delete(id);
		const om = await client.features.create(create);
		if (!om) throw new Error('重建 feature 失败（原 feature 已删除）');
		return mapOmFeature(om);
	}

	/**
	 * 原位更新 feature 单位成本：OM v3 `PATCH /features/{id}`（OM 唯一可原位更新的
	 * feature 字段；name/filters 等结构变更无原生 update，仍需 updateFeature 的
	 * delete+create 重建）。传 null 清除单位成本。
	 */
	public static async updateFeatureUnitCost(id: string, unitCost: FeatureUnitCostInput | null): Promise<FeatureResponse> {
		const om = await omV3<OmFeature>(`/features/${id}`, { method: 'PATCH', body: { unit_cost: unitCost } });
		return mapOmFeature(om);
	}

	/**
	 * 按 OM meter 查询语义聚合该 feature 的成本（`POST /features/{id}/cost/query`）。
	 * 需先配置单位成本（manual 或 llm），否则后端报错。body 缺省为全时段聚合。
	 */
	public static async queryFeatureCost(id: string, query: OmMeterQueryPostBody = {}): Promise<Record<string, unknown>> {
		return await omV3<Record<string, unknown>>(`/features/${id}/cost/query`, { method: 'POST', body: query });
	}

	/** 读取原始单位成本配置（mapOmFeature 不透出该字段）。 */
	public static async getFeatureUnitCost(id: string): Promise<FeatureUnitCostInput | null> {
		const om = await omV3<{ unit_cost?: FeatureUnitCostInput | null }>(`/features/${id}`);
		return om.unit_cost ?? null;
	}

	/**
	 * Delete a feature by ID
	 * @param id Feature ID
	 */
	public static async deleteFeature(id: string): Promise<void> {
		await requireOpenMeterClient().features.delete(id);
	}

	/**
	 * List features by filter (POST /features/search)
	 * @param filter Feature filter parameters
	 * @returns List of features with pagination
	 */
	public static async listFeaturesByFilter(filter: FeatureFilter): Promise<ListFeaturesResponse> {
		return await this.listFeatures(filter);
	}

	// ============================================
	// Legacy methods (for backwards compatibility)
	// ============================================

	/**
	 * @deprecated Use listFeatures instead
	 */
	public static async getAllFeatures(payload: GetFeaturesPayload = {}): Promise<GetFeaturesResponse> {
		const { items, pagination } = await this.listFeatures(payload);
		return { items, pagination };
	}

	/**
	 * @deprecated Use listFeaturesByFilter instead
	 */
	public static async getFeaturesByFilter(payload: GetFeatureByFilterPayload): Promise<GetFeaturesResponse> {
		const client = getOpenMeterClient();
		if (!client) return { items: [], pagination: { limit: payload.limit ?? 0, offset: payload.offset ?? 0, total: 0 } };
		const omFeatures = (await client.features.list({ limit: Math.max(1, payload.limit ?? 100), offset: payload.offset ?? 0 })) ?? [];
		let items: Feature[] = omFeatures.map(mapOmFeature);
		for (const f of payload.filters ?? []) {
			items = applyClientFilter(items, f);
		}
		return { items, pagination: { limit: payload.limit ?? items.length, offset: payload.offset ?? 0, total: items.length } };
	}

	/**
	 * @deprecated Use updateFeature instead
	 */
	public static async updateFeatureLegacy(id: string, data: UpdateFeaturePayload): Promise<FeatureResponse> {
		return await this.updateFeature(id, {
			name: data.name,
			description: data.description,
			metadata: data.metadata,
			unit_singular: data.unit_singular,
			unit_plural: data.unit_plural,
			// Legacy payload 的 conversion_rate 可选，UpdateFeatureRequest 要求必填，缺省补空串
			reporting_unit: data.reporting_unit
				? { ...data.reporting_unit, conversion_rate: data.reporting_unit.conversion_rate ?? '' }
				: undefined,
			group_id: data.group_id,
			alert_settings: data.alert_settings,
			config_value: data.config_value,
		});
	}
}

/** TypedBackendFilter 支持子集（name/lookup_key/id/type/meter_id 的字符串匹配）；其余静默跳过。 */
function applyClientFilter(items: Feature[], f: TypedBackendFilter): Feature[] {
	if (f.data_type !== DataType.STRING || f.value?.string === undefined) return items;
	const v = String(f.value.string).toLowerCase();
	const equals = (s: string | undefined) => s?.toLowerCase() === v;
	switch (f.field) {
		case 'name':
			return items.filter((x) => equals(x.name));
		case 'lookup_key':
			return items.filter((x) => equals(x.lookup_key));
		case 'id':
			return items.filter((x) => equals(x.id));
		case 'type':
			return items.filter((x) => equals(x.type));
		case 'meter_id':
			return items.filter((x) => equals(x.meter_id));
		default:
			return items;
	}
}

export default FeatureApi;
