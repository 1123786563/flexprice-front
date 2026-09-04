// src/api/SettingsApi.ts
// 空态垫片：租户级设置存储为 Flexprice 平台域，OpenMeter OSS 无对应。
// 读操作返回 value:null（消费方均有默认值合并兜底，如 useCustomerPortalConfig 的 DEFAULT 合并），
// 写操作明确报错；reset 语义为「清除覆盖回到默认」，本地无覆盖，直接返回默认。
import { unsupportedLocalOperation } from '@/core/services/platform/localPlatform';

export interface Setting {
	key: string;
	value: any;
	created_at?: string;
	updated_at?: string;
}

export interface UpdateSettingRequest {
	value: any;
}

class SettingsApi {
	public static async getSettingByKey(key: string): Promise<Setting> {
		return { key, value: null };
	}

	public static async updateSettingByKey(key: string, _data: UpdateSettingRequest): Promise<Setting> {
		unsupportedLocalOperation(`更新设置 ${key}`);
	}

	public static async deleteSettingByKey(key: string): Promise<void> {
		unsupportedLocalOperation(`删除设置 ${key}`);
	}

	/** 本地模式从未保存覆盖，重置即默认值本身。 */
	public static async resetSettingToDefaults(key: string): Promise<Setting> {
		return this.getSettingByKey(key);
	}
}

export default SettingsApi;
