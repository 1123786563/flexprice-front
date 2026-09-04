// src/api/AlertSettingApi.ts
// 空态垫片：告警规则设置为 Flexprice 告警域，OpenMeter OSS 无对应。
import {
	CreateAlertSettingsRequest,
	UpdateAlertSettingsRequest,
	AlertSettingResponse,
	SearchAlertSettingsRequest,
	SearchAlertSettingsResponse,
} from '@/types/dto';
import { unsupportedLocalOperation } from '@/core/services/platform/localPlatform';

class AlertSettingApi {
	public static async create(_data: CreateAlertSettingsRequest): Promise<AlertSettingResponse> {
		unsupportedLocalOperation('创建告警设置');
	}

	public static async get(_id: string): Promise<AlertSettingResponse> {
		unsupportedLocalOperation('获取告警设置详情');
	}

	public static async search(payload: SearchAlertSettingsRequest): Promise<SearchAlertSettingsResponse> {
		return { items: [], pagination: { total: 0, limit: payload.limit ?? 0, offset: payload.offset ?? 0 } };
	}

	public static async update(_id: string, _data: UpdateAlertSettingsRequest): Promise<AlertSettingResponse> {
		unsupportedLocalOperation('更新告警设置');
	}

	public static async delete(_id: string): Promise<void> {
		unsupportedLocalOperation('删除告警设置');
	}
}

export default AlertSettingApi;
