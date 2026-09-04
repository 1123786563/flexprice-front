import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@/core/services/openmeter', () => ({
	getOpenMeterClient: vi.fn(),
	requireOpenMeterClient: vi.fn(),
}));

import { getOpenMeterClient, requireOpenMeterClient } from '@/core/services/openmeter';
import CustomerApi from '@/api/CustomerApi';
import type { OmCustomer } from '@/core/services/openmeter/mappers/customer';

const OM_CUSTOMER: OmCustomer = {
	id: '01M1980DE7NN9RXCFWS6Q63SKM',
	key: 'tenant-a',
	name: 'Tenant A',
	primaryEmail: 'a@example.com',
	billingAddress: { line1: 'Line 1', city: 'Beijing', country: 'CN' },
	metadata: { tier: 'pro' },
	createdAt: '2026-08-30T11:48:49.223127Z',
	updatedAt: '2026-08-30T11:48:49.223128Z',
	subscriptions: [
		{
			id: '01M1984YTRMQAAPYC0ZCHY9BS0',
			name: 'Drill Plan (issue-220)',
			status: 'active',
			customerId: '01M1980DE7NN9RXCFWS6Q63SKM',
			plan: { id: '01M1984JSY67Q5PYAYF47FNCXF', key: 'drill_plan_220', version: 1 },
			currency: 'USD',
			billingCadence: 'P1M',
			billingAnchor: '2026-08-30T11:51:18.095986Z',
			activeFrom: '2026-08-30T11:51:18.095986Z',
			createdAt: '2026-08-30T11:51:18.104009Z',
			updatedAt: '2026-08-30T11:51:18.104010Z',
		},
	],
} as unknown as OmCustomer;

function mockClient(overrides: Record<string, unknown> = {}) {
	const client = {
		customers: {
			get: vi.fn().mockResolvedValue(OM_CUSTOMER),
			list: vi.fn().mockResolvedValue({ items: [OM_CUSTOMER], totalCount: 1, page: 1, pageSize: 100 }),
			create: vi.fn().mockResolvedValue(OM_CUSTOMER),
			update: vi.fn().mockResolvedValue(OM_CUSTOMER),
			delete: vi.fn().mockResolvedValue(undefined),
		},
		subscriptions: {
			get: vi.fn().mockResolvedValue(OM_CUSTOMER.subscriptions![0]),
		},
		...overrides,
	};
	vi.mocked(getOpenMeterClient).mockReturnValue(client as never);
	vi.mocked(requireOpenMeterClient).mockReturnValue(client as never);
	return client;
}

describe('CustomerApi（OpenMeter 承载）', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('getCustomerById：key→external_id、primaryEmail→email、billingAddress 打平、常量字段兜底', async () => {
		mockClient();
		const c = await CustomerApi.getCustomerById('01M1980DE7NN9RXCFWS6Q63SKM');
		expect(c.id).toBe('01M1980DE7NN9RXCFWS6Q63SKM');
		expect(c.external_id).toBe('tenant-a');
		expect(c.email).toBe('a@example.com');
		expect(c.address_line1).toBe('Line 1');
		expect(c.address_city).toBe('Beijing');
		expect(c.address_country).toBe('CN');
		expect(c.address_line2).toBe('');
		expect(c.metadata).toEqual({ tier: 'pro' });
		expect(c.status).toBe('published');
		expect(c.created_at).toBe('2026-08-30T11:48:49.223127Z');
	});

	it('getCustomers：OM 分页 → Flexprice pagination；customer_ids 客户端过滤', async () => {
		const client = mockClient();
		const res = await CustomerApi.getCustomers({ limit: 10, offset: 0, customer_ids: ['01M1980DE7NN9RXCFWS6Q63SKM'] });
		expect(client.customers.list).toHaveBeenCalledWith({ pageSize: 10, page: 1 });
		expect(res.items).toHaveLength(1);
		expect(res.pagination.total).toBe(1);

		const empty = await CustomerApi.getCustomers({ customer_ids: ['other'] });
		expect(empty.items).toHaveLength(0);
	});

	it('getCustomersByFilters：name 过滤下推 OM，结果再走客户端过滤', async () => {
		const client = mockClient();
		const res = await CustomerApi.getCustomersByFilters({
			limit: 10,
			offset: 0,
			filters: [{ field: 'name', operator: 'contains' as never, data_type: 'STRING' as never, value: { string: 'Tenant' } }],
			sort: [],
		});
		expect(client.customers.list).toHaveBeenCalledWith(expect.objectContaining({ name: 'Tenant', pageSize: 10, page: 1 }));
		expect(res.items).toHaveLength(1);
	});

	it('createCustomer：external_id→key，缺省 name 回退 external_id', async () => {
		const client = mockClient();
		await CustomerApi.createCustomer({ external_id: 'new-key', email: 'n@e.com' });
		expect(client.customers.create).toHaveBeenCalledWith(
			expect.objectContaining({ key: 'new-key', name: 'new-key', primaryEmail: 'n@e.com' }),
		);
	});

	it('updateCustomer：先取当前值合并（替换语义下未覆盖字段不丢）', async () => {
		const client = mockClient();
		await CustomerApi.updateCustomer({ email: 'new@example.com' }, '01M1980DE7NN9RXCFWS6Q63SKM');
		expect(client.customers.get).toHaveBeenCalledWith('01M1980DE7NN9RXCFWS6Q63SKM');
		expect(client.customers.update).toHaveBeenCalledWith(
			'01M1980DE7NN9RXCFWS6Q63SKM',
			expect.objectContaining({
				name: 'Tenant A',
				key: 'tenant-a',
				primaryEmail: 'new@example.com',
				billingAddress: { line1: 'Line 1', city: 'Beijing', country: 'CN' },
			}),
		);
	});

	it('getCustomerSubscriptions：内嵌订阅映射并附带真实客户档案', async () => {
		mockClient();
		const res = await CustomerApi.getCustomerSubscriptions('01M1980DE7NN9RXCFWS6Q63SKM');
		expect(res.items).toHaveLength(1);
		const sub = res.items[0];
		expect(sub.subscription_status).toBe('active');
		expect(sub.billing_period).toBe('MONTHLY');
		expect(sub.currency).toBe('USD');
		expect(sub.plan_id).toBe('01M1984JSY67Q5PYAYF47FNCXF');
		expect(sub.plan.lookup_key).toBe('drill_plan_220');
		expect(sub.customer.name).toBe('Tenant A');
		expect(sub.current_period_start).toBeTruthy();
		expect(sub.current_period_end).toBeTruthy();
	});

	it('createDashboardSession 明确报错（OM OSS 无门户）', async () => {
		mockClient();
		await expect(CustomerApi.createDashboardSession('tenant-a')).rejects.toThrow(/门户/);
	});

	it('后端禁用时列表优雅降级为空', async () => {
		vi.mocked(getOpenMeterClient).mockReturnValue(null);
		const res = await CustomerApi.getCustomers({});
		expect(res.items).toEqual([]);
	});
});
