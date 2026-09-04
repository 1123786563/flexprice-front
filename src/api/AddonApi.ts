// src/api/AddonApi.ts
// OpenMeter 承载：addon CRUD 走 OM addons（key↔lookup_key）。OM addon 的 entitlements/价格
// 全部住在 rateCards：带 featureKey+entitlementTemplate 的卡合成 entitlements，带价格的 flat_fee
// 卡合成 prices。CreateAddonRequest 无价格/实例/币种字段，OM 必填项取 single/USD/空卡缺省。
import { Addon } from '@/models';
import {
	CreateAddonRequest,
	UpdateAddonRequest,
	GetAddonsPayload,
	GetAddonsResponse,
	GetAddonByFilterPayload,
	AddonResponse,
} from '@/types/dto';
import { ListEntitlementsResponse } from '@/types/dto/Entitlement';
import { getOpenMeterClient, requireOpenMeterClient } from '@/core/services/openmeter';
import {
	buildOmAddonCreate,
	buildOmAddonUpdate,
	mapOmAddon,
	mapOmAddonToModel,
	type OmAddon,
} from '@/core/services/openmeter/mappers/addon';
import { toFlexpricePagination } from '@/core/services/openmeter/mappers/common';
import type { TypedBackendFilter } from '@/types/formatters/QueryBuilder';
import { DataType } from '@/types/common/QueryBuilder';

class AddonApi {
	public static async List(payload: GetAddonsPayload = {}): Promise<GetAddonsResponse> {
		const client = getOpenMeterClient();
		if (!client) return { items: [], pagination: { limit: 0, offset: 0, total: 0 }, limit: 0, offset: 0, total: 0 };
		const limit = payload.limit ?? 100;
		const offset = payload.offset ?? 0;
		const page = (await client.addons.list({ pageSize: limit, page: Math.floor(offset / Math.max(1, limit)) + 1 })) ?? {
			items: [],
			totalCount: 0,
			page: 1,
			pageSize: 0,
		};
		// entitlement 展开需要 feature 档案；一次拉全量 feature 建 key→档案映射
		const features = (await client.features.list()) ?? [];
		const items = page.items.map((om: OmAddon) => mapOmAddon(om, features));
		const pagination = toFlexpricePagination(page, limit, offset);
		return { items, pagination, ...pagination };
	}

	public static async Get(id: string): Promise<AddonResponse> {
		const client = requireOpenMeterClient();
		const om = await client.addons.get(id);
		if (!om) throw new Error(`addon ${id} 不存在`);
		const features = (await client.features.list()) ?? [];
		return mapOmAddon(om, features);
	}

	public static async GetByLookupKey(lookupKey: string): Promise<AddonResponse> {
		const client = requireOpenMeterClient();
		const page = await client.addons.list({ key: [lookupKey] });
		const om = page?.items[0];
		if (!om) throw new Error(`lookup_key 为 ${lookupKey} 的 addon 不存在`);
		const features = (await client.features.list()) ?? [];
		return mapOmAddon(om, features);
	}

	public static async Create(data: CreateAddonRequest): Promise<Addon> {
		const om = await requireOpenMeterClient().addons.create(buildOmAddonCreate(data));
		if (!om) throw new Error('创建 addon 失败');
		return mapOmAddonToModel(om);
	}

	public static async Update(id: string, data: UpdateAddonRequest): Promise<Addon> {
		const client = requireOpenMeterClient();
		const current = await client.addons.get(id);
		if (!current) throw new Error(`addon ${id} 不存在`);
		const om = await client.addons.update(id, buildOmAddonUpdate(current, data));
		if (!om) throw new Error('更新 addon 失败');
		return mapOmAddonToModel(om);
	}

	public static async Delete(id: string): Promise<void> {
		await requireOpenMeterClient().addons.delete(id);
	}

	public static async ListByFilter(payload: GetAddonByFilterPayload) {
		const client = getOpenMeterClient();
		if (!client)
			return {
				items: [],
				pagination: { limit: payload.limit ?? 0, offset: payload.offset ?? 0, total: 0 },
				limit: payload.limit ?? 0,
				offset: payload.offset ?? 0,
				total: 0,
			};
		const { items, pagination } = await this.List({ limit: payload.limit ?? 100, offset: payload.offset ?? 0 });
		let filtered = items;
		for (const f of payload.filters ?? []) {
			filtered = applyClientFilter(filtered, f);
		}
		const result = {
			items: filtered,
			pagination: { ...pagination, total: filtered.length },
			limit: pagination.limit,
			offset: pagination.offset,
			total: filtered.length,
		};
		return result;
	}

	public static async GetEntitlements(addonId: string): Promise<ListEntitlementsResponse> {
		const addon = await this.Get(addonId);
		return {
			items: addon.entitlements,
			pagination: { limit: addon.entitlements.length, offset: 0, total: addon.entitlements.length },
		};
	}
}

/** TypedBackendFilter 支持子集（name/lookup_key/id/status 的字符串匹配）；其余静默跳过。 */
function applyClientFilter(items: AddonResponse[], f: TypedBackendFilter): AddonResponse[] {
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
		case 'status':
			return items.filter((x) => equals(x.status));
		default:
			return items;
	}
}

export default AddonApi;
