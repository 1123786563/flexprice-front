// src/api/TaxApi.ts
// OpenMeter 承载：税码走 OM v3 /tax-codes CRUD。OM tax code 是给外部税务应用（如 Stripe）
// 的引用编码，没有 Flexprice 的 percentage/fixed 数值概念——数值收进 OM labels 的
// flexprice.* 保留键（与 FeatureApi 的 flexprice.* metadata 惯例一致），展示与编辑往返保值；
// 实际计税由 OM 在发票/费率卡层按 tax_code 引用执行。
// 客户级「税务关联」OM 无对应端点（OM 在 charge/rate-card/profile 层挂 tax_config），明确报错。
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
import { omV3 } from '@/core/services/openmeter/omFetch';
import { ENTITY_STATUS } from '@/models';
import { TAX_RATE_STATUS, TAX_RATE_SCOPE, TAX_RATE_TYPE } from '@/models/Tax';
import { Pagination } from '@/models';

/** OM tax code 的 wire 形状（v3 openapi BillingTaxCode）。 */
interface OmTaxCode {
	id: string;
	key: string;
	name: string;
	description?: string;
	labels?: Record<string, string> | null;
	app_mappings: { app_type: string; tax_code: string }[];
	created_at: string;
	updated_at: string;
	deleted_at?: string | null;
}

interface OmTaxCodePage {
	data?: OmTaxCode[];
	items?: OmTaxCode[];
	meta?: { page?: { size?: number; number?: number; total?: number } };
}

// Flexprice 数值在 OM labels 中的保留键
const LABEL_TAX_RATE_TYPE = 'flexprice.tax_rate_type';
const LABEL_PERCENTAGE_VALUE = 'flexprice.percentage_value';
const LABEL_FIXED_VALUE = 'flexprice.fixed_value';
const LABEL_SCOPE = 'flexprice.scope';

function mapOmTaxCode(om: OmTaxCode): TaxRateResponse {
	const labels = om.labels ?? {};
	const type = (labels[LABEL_TAX_RATE_TYPE] as TAX_RATE_TYPE) ?? TAX_RATE_TYPE.PERCENTAGE;
	const deleted = !!om.deleted_at;
	return {
		id: om.id,
		name: om.name,
		description: om.description ?? '',
		code: om.key,
		status: deleted ? ENTITY_STATUS.ARCHIVED : ENTITY_STATUS.PUBLISHED,
		tax_rate_status: deleted ? TAX_RATE_STATUS.DELETED : TAX_RATE_STATUS.ACTIVE,
		tax_rate_type: type,
		scope: (labels[LABEL_SCOPE] as TAX_RATE_SCOPE) ?? TAX_RATE_SCOPE.INTERNAL,
		percentage_value: labels[LABEL_PERCENTAGE_VALUE] !== undefined ? Number(labels[LABEL_PERCENTAGE_VALUE]) : undefined,
		fixed_value: labels[LABEL_FIXED_VALUE] !== undefined ? Number(labels[LABEL_FIXED_VALUE]) : undefined,
		metadata: labels,
		environment_id: '',
		tenant_id: '',
		created_at: om.created_at,
		updated_at: om.updated_at,
		created_by: '',
		updated_by: '',
	};
}

function buildLabels(payload: Partial<CreateTaxRateRequest>, base?: Record<string, string> | null): Record<string, string> {
	const labels = { ...(base ?? {}) };
	if (payload.tax_rate_type) labels[LABEL_TAX_RATE_TYPE] = payload.tax_rate_type;
	if (payload.percentage_value !== undefined) labels[LABEL_PERCENTAGE_VALUE] = String(payload.percentage_value);
	if (payload.fixed_value !== undefined) labels[LABEL_FIXED_VALUE] = String(payload.fixed_value);
	if (payload.scope) labels[LABEL_SCOPE] = payload.scope;
	// flexprice.* 保留键之外合并调用方 metadata
	return { ...labels, ...Object.fromEntries(Object.entries(payload.metadata ?? {}).filter(([k]) => !k.startsWith('flexprice.'))) };
}

class TaxApi {
	// Tax Rate Methods（OM tax codes）
	public static async createTaxRate(payload: CreateTaxRateRequest): Promise<TaxRateResponse> {
		const om = await omV3<OmTaxCode>('/tax-codes', {
			method: 'POST',
			body: {
				name: payload.name,
				key: payload.code,
				...(payload.description ? { description: payload.description } : {}),
				app_mappings: [],
				labels: buildLabels(payload),
			},
		});
		return mapOmTaxCode(om);
	}

	public static async getTaxRate(id: string): Promise<TaxRateResponse> {
		const om = await omV3<OmTaxCode>(`/tax-codes/${id}`);
		return mapOmTaxCode(om);
	}

	public static async listTaxRates(filter?: TaxRateFilter): Promise<ListTaxRatesResponse> {
		// v3 PagePaginationQuery 为 deepObject 风格：page[size] / page[number]
		const page = await omV3<OmTaxCodePage>('/tax-codes', {
			query: {
				'page[size]': filter?.limit ?? 100,
				'page[number]': filter?.offset ? Math.floor(filter.offset / (filter.limit ?? 100)) + 1 : 1,
			},
		});
		const items = (page.data ?? page.items ?? []).map(mapOmTaxCode);
		const pagination: Pagination = {
			limit: filter?.limit ?? items.length,
			offset: filter?.offset ?? 0,
			total: page.meta?.page?.total ?? items.length,
		};
		return { items, pagination };
	}

	/**
	 * 更新税码：OM PUT 为整对象 upsert，先 GET 合并（key 不可变；app_mappings 由
	 * 集成域维护，原样保留）。
	 */
	public static async updateTaxRate(id: string, payload: UpdateTaxRateRequest): Promise<TaxRateResponse> {
		const current = await omV3<OmTaxCode>(`/tax-codes/${id}`);
		if (payload.code && payload.code !== current.key) {
			throw new Error('OpenMeter 税码 key 不可修改；如需更换编码请新建税码');
		}
		const om = await omV3<OmTaxCode>(`/tax-codes/${id}`, {
			method: 'PUT',
			body: {
				name: payload.name ?? current.name,
				...(payload.description !== undefined ? { description: payload.description } : {}),
				app_mappings: current.app_mappings ?? [],
				labels: buildLabels({ metadata: payload.metadata }, current.labels ?? undefined),
			},
		});
		return mapOmTaxCode(om);
	}

	public static async deleteTaxRate(id: string): Promise<void> {
		await omV3(`/tax-codes/${id}`, { method: 'DELETE' });
	}

	// Tax Association Methods
	// OM 无客户级税务关联端点：税码通过 charge/rate-card 的 tax_config 与组织默认税码
	// （/defaults/tax-codes）生效。明确报错并给出替代路径，禁止假成功。
	public static async createTaxAssociation(_payload: CreateTaxAssociationRequest): Promise<TaxAssociationResponse> {
		throw new Error('OpenMeter 不支持客户级税务关联：请在费率卡/费用的税配置（tax_config）中选择税码，或设置组织默认税码');
	}

	public static async getTaxAssociation(_id: string): Promise<TaxAssociationResponse> {
		throw new Error('OpenMeter 不支持客户级税务关联：请在费率卡/费用的税配置（tax_config）中选择税码，或设置组织默认税码');
	}

	public static async updateTaxAssociation(_id: string, _payload: TaxAssociationUpdateRequest): Promise<TaxAssociationResponse> {
		throw new Error('OpenMeter 不支持客户级税务关联：请在费率卡/费用的税配置（tax_config）中选择税码，或设置组织默认税码');
	}

	public static async deleteTaxAssociation(_id: string): Promise<void> {
		throw new Error('OpenMeter 不支持客户级税务关联：请在费率卡/费用的税配置（tax_config）中选择税码，或设置组织默认税码');
	}

	public static async listTaxAssociations(_filter?: TaxAssociationFilter): Promise<ListTaxAssociationsResponse> {
		return { items: [], pagination: { limit: _filter?.limit ?? 0, offset: _filter?.offset ?? 0, total: 0 } };
	}
}

export default TaxApi;
