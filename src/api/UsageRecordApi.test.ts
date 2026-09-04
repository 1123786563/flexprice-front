import { describe, it, expect } from 'vitest';

import UsageRecordApi from '@/api/UsageRecordApi';

describe('UsageRecordApi（OpenMeter 本地空态垫片）', () => {
	it('searchUsageRecords：外部计费对账域 OM 无对应，返回空列表并保留分页形状', async () => {
		const res = await UsageRecordApi.searchUsageRecords({
			limit: 10,
			offset: 0,
			customer_id: 'customer-1',
			synced: false,
		});
		expect(res.items).toEqual([]);
		expect(res.pagination).toEqual({ limit: 10, offset: 0, total: 0 });
	});

	it('searchUsageRecords：未传分页参数时 limit/offset 缺省 0', async () => {
		const res = await UsageRecordApi.searchUsageRecords({});
		expect(res.pagination).toEqual({ limit: 0, offset: 0, total: 0 });
	});
});
