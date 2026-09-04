// src/core/services/openmeter/mappers/customer.ts
// OM customer ↔ Flexprice CustomerResponse 双向映射。
// OM 无对应字段（tenant/environment/created_by 等）填常量；integrations/tax_rate_overrides 明确不支持。
import type { OpenMeterClient } from '@/core/services/openmeter';
import { ENTITY_STATUS } from '@/models';
import type { CustomerResponse, CreateCustomerRequest, UpdateCustomerRequest, CustomerFilter } from '@/types/dto';
import type { Metadata } from '@/models';

export type OmCustomer = NonNullable<Awaited<ReturnType<OpenMeterClient['customers']['get']>>>;
export type OmCustomerPage = NonNullable<Awaited<ReturnType<OpenMeterClient['customers']['list']>>>;
export type OmCustomerCreate = Parameters<OpenMeterClient['customers']['create']>[0];
export type OmCustomerReplaceUpdate = NonNullable<Parameters<OpenMeterClient['customers']['update']>[1]>;
export type OmCustomerListQuery = NonNullable<Parameters<OpenMeterClient['customers']['list']>[0]>;
type OmAddress = NonNullable<OmCustomer['billingAddress']>;

/** OM 地址嵌套 → Flexprice 打平字段（缺省空串）。 */ function flattenAddress(address: OmAddress | null | undefined) {
	return {
		address_line1: address?.line1 ?? '',
		address_line2: address?.line2 ?? '',
		address_city: address?.city ?? '',
		address_state: address?.state ?? '',
		address_postal_code: address?.postalCode ?? '',
		address_country: address?.country ?? '',
	};
}

/** Flexprice 打平字段 → OM 地址嵌套（全空则省略）。 */
function nestAddress(fields: {
	address_line1?: string;
	address_line2?: string;
	address_city?: string;
	address_state?: string;
	address_postal_code?: string;
	address_country?: string;
}): OmAddress | undefined {
	const address: Record<string, string> = {};
	if (fields.address_line1) address.line1 = fields.address_line1;
	if (fields.address_line2) address.line2 = fields.address_line2;
	if (fields.address_city) address.city = fields.address_city;
	if (fields.address_state) address.state = fields.address_state;
	if (fields.address_postal_code) address.postalCode = fields.address_postal_code;
	if (fields.address_country) address.country = fields.address_country;
	return Object.keys(address).length ? (address as OmAddress) : undefined;
}

function toOmMetadata(metadata: Metadata | undefined): OmCustomerCreate['metadata'] {
	return metadata && Object.keys(metadata).length ? { ...metadata } : undefined;
}

export function mapOmCustomer(om: OmCustomer): CustomerResponse {
	const createdAt = om.createdAt instanceof Date ? om.createdAt.toISOString() : String(om.createdAt ?? '');
	const updatedAt = om.updatedAt instanceof Date ? om.updatedAt.toISOString() : String(om.updatedAt ?? '');
	return {
		id: om.id,
		name: om.name ?? om.key ?? om.id,
		email: om.primaryEmail ?? '',
		external_id: om.key ?? om.id,
		...flattenAddress(om.billingAddress),
		metadata: (om.metadata as Metadata | undefined) ?? {},
		status: ENTITY_STATUS.PUBLISHED,
		tenant_id: '',
		environment_id: '',
		created_by: '',
		updated_by: '',
		created_at: createdAt,
		updated_at: updatedAt,
	};
}

/** Flexprice CreateCustomerRequest → OM CustomerCreate（external_id 即 key；name 缺省回退 external_id）。 */
export function buildOmCustomerCreate(req: CreateCustomerRequest): OmCustomerCreate {
	const name = req.name?.trim() || req.external_id;
	return {
		name,
		key: req.external_id,
		...(req.email ? { primaryEmail: req.email } : {}),
		...(nestAddress(req) ? { billingAddress: nestAddress(req) } : {}),
		...(toOmMetadata(req.metadata) ? { metadata: toOmMetadata(req.metadata) } : {}),
	};
}

/**
 * Flexprice UpdateCustomerRequest → OM CustomerReplaceUpdate。
 * OM update 是整对象替换语义，必须先取当前值合并再发送；key 以现值为准
 * （OM key 被事件/订阅引用，external_id 变更不跟随，属已知限制）。
 */
export function buildOmCustomerUpdate(current: OmCustomer, req: UpdateCustomerRequest): OmCustomerReplaceUpdate {
	const merged = { ...current };
	if (req.name !== undefined) merged.name = req.name;
	if (req.email !== undefined) merged.primaryEmail = req.email;
	if (req.metadata !== undefined) merged.metadata = toOmMetadata(req.metadata) ?? null;
	const hasAddressField =
		req.address_line1 !== undefined ||
		req.address_line2 !== undefined ||
		req.address_city !== undefined ||
		req.address_state !== undefined ||
		req.address_postal_code !== undefined ||
		req.address_country !== undefined;
	if (hasAddressField) {
		merged.billingAddress = nestAddress({
			address_line1: req.address_line1 ?? current.billingAddress?.line1,
			address_line2: req.address_line2 ?? current.billingAddress?.line2,
			address_city: req.address_city ?? current.billingAddress?.city,
			address_state: req.address_state ?? current.billingAddress?.state,
			address_postal_code: req.address_postal_code ?? current.billingAddress?.postalCode,
			address_country: req.address_country ?? current.billingAddress?.country,
		});
	}
	return {
		name: merged.name ?? merged.key ?? merged.id,
		key: current.key,
		...(merged.description !== undefined ? { description: merged.description } : {}),
		...(merged.primaryEmail !== undefined ? { primaryEmail: merged.primaryEmail } : {}),
		...(merged.currency !== undefined ? { currency: merged.currency } : {}),
		...(merged.billingAddress ? { billingAddress: merged.billingAddress } : {}),
		...(merged.metadata ? { metadata: merged.metadata } : {}),
	};
}

/**
 * Flexprice CustomerFilter（GET 与 POST /search 共用）→ OM listCustomers 查询。
 * 服务端可下推：name / primaryEmail / key 部分匹配 + 分页；其余（customer_ids、
 * 复杂 TypedBackendFilter）由 CustomerApi 在客户端过滤。limit/offset 为 Flexprice
 * 分页（可为 null），转换为 OM 的 page/pageSize。
 */
export function buildOmCustomerListQuery(filter: CustomerFilter, extraNameContains?: string): OmCustomerListQuery {
	const limit = filter.limit ?? 100;
	const offset = filter.offset ?? 0;
	const page = Math.floor(offset / Math.max(1, limit)) + 1;
	const name = extraNameContains || filter.filters?.find((f) => f.field === 'name')?.value?.string;
	return {
		pageSize: limit,
		page,
		...(name ? { name } : {}),
		...(filter.email ? { primaryEmail: filter.email } : {}),
		...(filter.external_id ? { key: filter.external_id } : {}),
	};
}

/** 客户端兜底过滤：OM 不支持的字段（customer_ids/external_ids/精确 email）在返回集上执行。 */
export function filterCustomersClientSide(
	items: CustomerResponse[],
	filter: CustomerFilter & { customer_ids?: string[]; external_ids?: string[] },
): CustomerResponse[] {
	let result = items;
	if (filter.customer_ids?.length) {
		const ids = new Set(filter.customer_ids);
		result = result.filter((c) => ids.has(c.id));
	}
	if (filter.external_ids?.length) {
		const keys = new Set(filter.external_ids);
		result = result.filter((c) => keys.has(c.external_id));
	}
	if (filter.email) {
		const email = filter.email.toLowerCase();
		result = result.filter((c) => c.email.toLowerCase() === email || c.email.toLowerCase().includes(email));
	}
	return result;
}
