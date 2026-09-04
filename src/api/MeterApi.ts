// src/api/MeterApi.ts
// OpenMeter 承载：meters CRUD 走 OM（idOrSlug 语义，Flexprice id 即 OM id）。
// OM meters.list 无服务端分页，limit/offset 在客户端切片；OM 无 status 生命周期
// （disableMeter）与 meter 级过滤更新（updateMeter 仅 filters），明确报错。
import { Pagination } from '@/models';
import { CreateMeterRequest, UpdateMeterRequest, MeterResponse, GetAllMetersResponse, ListMetersResponse } from '@/types/dto';
import { getOpenMeterClient, requireOpenMeterClient } from '@/core/services/openmeter';
import type { OpenMeterMeter } from '@/core/services/openmeter';
import { mapOmMeter, buildOmMeterCreate } from '@/core/services/openmeter/mappers/meter';

async function listOmMeters(): Promise<OpenMeterMeter[]> {
	const client = getOpenMeterClient();
	if (!client) return [];
	return (await client.meters.list()) ?? [];
}

export class MeterApi {
	public static async createMeter(data: CreateMeterRequest): Promise<MeterResponse> {
		const om = await requireOpenMeterClient().meters.create(buildOmMeterCreate(data));
		if (!om) throw new Error('创建计量表失败');
		return mapOmMeter(om);
	}

	public static async getAllMeters({ limit, offset }: Pagination): Promise<GetAllMetersResponse> {
		const meters = (await listOmMeters()).map(mapOmMeter);
		return {
			items: meters.slice(offset ?? 0, (offset ?? 0) + (limit ?? meters.length)),
			pagination: { limit, offset, total: meters.length },
		};
	}

	/** OM meter 无 status 概念，全部视为活跃。 */
	public static async getAllActiveMeters(): Promise<GetAllMetersResponse> {
		const meters = (await listOmMeters()).map(mapOmMeter);
		return { items: meters, pagination: { limit: meters.length, offset: 0, total: meters.length } };
	}

	public static async getMeterById(id: string): Promise<MeterResponse> {
		const om = await requireOpenMeterClient().meters.get(id);
		if (!om) throw new Error(`计量表 ${id} 不存在`);
		return mapOmMeter(om);
	}

	/**
	 * Flexprice UpdateMeterRequest 仅含 filters；OM meter 可更新字段只有
	 * name/description/groupBy，meter 级事件过滤在 OM 中不存在，明确报错而非假成功。
	 */
	public static async updateMeter(_id: string, _data: UpdateMeterRequest): Promise<MeterResponse> {
		throw new Error('OpenMeter 本地模式不支持「更新计量表过滤条件」：OM meter 无事件级过滤，可更新字段仅 name/description/groupBy');
	}

	public static async deleteMeter(id: string): Promise<void> {
		await requireOpenMeterClient().meters.delete(id);
	}

	/** OM meter 无 status 生命周期（无发布/禁用状态机）。 */
	public static async disableMeter(_id: string): Promise<void> {
		throw new Error('OpenMeter 本地模式不支持「禁用计量表」：OM meter 无 status 生命周期');
	}

	public static async listMeters({ limit, offset }: Pagination): Promise<ListMetersResponse> {
		return await this.getAllMeters({ limit, offset });
	}
}
