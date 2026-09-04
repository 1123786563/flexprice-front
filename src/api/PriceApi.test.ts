import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@/core/services/openmeter', () => ({
	getOpenMeterClient: vi.fn(),
	requireOpenMeterClient: vi.fn(),
}));

import { getOpenMeterClient, requireOpenMeterClient } from '@/core/services/openmeter';
import { PriceApi } from '@/api/PriceApi';
import type { OmPlan } from '@/core/services/openmeter/mappers/plan';
import { DataType, FilterOperator } from '@/types/common/QueryBuilder';
import { BILLING_MODEL, PRICE_ENTITY_TYPE, PRICE_TYPE, PRICE_UNIT_TYPE, TIER_MODE, ENTITY_STATUS } from '@/models';
import { BILLING_PERIOD } from '@/models/Price';
import { INVOICE_CADENCE } from '@/models/Invoice';

const PLAN_ID = '01M1984JSY67Q5PYAYF47FNCXF';

const OM_PLAN: OmPlan = {
	id: PLAN_ID,
	key: 'drill_plan_220',
	name: 'Drill Plan (issue-220)',
	currency: 'USD',
	billingCadence: 'P1M',
	status: 'active',
	version: 1,
	createdAt: '2026-08-30T11:51:05.790633Z',
	updatedAt: '2026-08-30T11:51:06.761254Z',
	phases: [
		{
			key: 'drill_phase',
			name: 'Drill Phase',
			duration: null,
			rateCards: [
				{
					type: 'flat_fee',
					key: 'drill_flat',
					name: 'Drill Flat Fee',
					billingCadence: 'P1M',
					price: { type: 'flat', amount: '50', paymentTerm: 'in_arrears' },
				},
				{ type: 'usage_based', key: 'drill_unit', name: 'Drill Unit', billingCadence: 'P1M', price: { type: 'unit', amount: '0.01' } },
				{
					type: 'usage_based',
					key: 'drill_tiered',
					name: 'Drill Tiered',
					billingCadence: 'P1M',
					price: {
						type: 'tiered',
						mode: 'graduated',
						tiers: [
							{ upToAmount: '1000', flatPrice: null, unitPrice: { type: 'unit', amount: '2' } },
							{ flatPrice: { type: 'flat', amount: '5' }, unitPrice: { type: 'unit', amount: '1' } },
						],
					},
				},
			],
		},
	],
} as unknown as OmPlan;

const PRICE_ID_FLAT = `${PLAN_ID}:drill_phase:drill_flat`;
const PRICE_ID_TIERED = `${PLAN_ID}:drill_phase:drill_tiered`;

function mockClient(overrides: Record<string, unknown> = {}) {
	const client = {
		plans: {
			get: vi.fn().mockResolvedValue(OM_PLAN),
			list: vi.fn().mockResolvedValue({ items: [OM_PLAN], totalCount: 1, page: 1, pageSize: 100 }),
			create: vi.fn(),
			update: vi.fn().mockImplementation(async (_id: string, payload: Record<string, unknown>) => ({ ...OM_PLAN, ...payload })),
			delete: vi.fn(),
		},
		...overrides,
	};
	vi.mocked(getOpenMeterClient).mockReturnValue(client as never);
	vi.mocked(requireOpenMeterClient).mockReturnValue(client as never);
	return client;
}

describe('PriceApi（OpenMeter plan rateCards 合成）', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('searchPrices：flat_fee→FIXED/FLAT_FEE、unit→USAGE/FLAT_FEE、tiered→USAGE/TIERED；复合 id 与分页', async () => {
		mockClient();
		const res = await PriceApi.searchPrices({
			entity_ids: [PLAN_ID],
			entity_type: PRICE_ENTITY_TYPE.PLAN,
			filters: [
				{ field: 'status', operator: FilterOperator.EQUAL, data_type: DataType.STRING, value: { string: ENTITY_STATUS.PUBLISHED } },
			],
			limit: 10,
			offset: 0,
		});
		expect(res.items).toHaveLength(3);
		const flat = res.items.find((p) => p.lookup_key === 'drill_flat');
		expect(flat).toMatchObject({
			id: PRICE_ID_FLAT,
			type: PRICE_TYPE.FIXED,
			billing_model: BILLING_MODEL.FLAT_FEE,
			amount: '50',
			currency: 'USD',
			entity_id: PLAN_ID,
			billing_period: BILLING_PERIOD.MONTHLY,
			invoice_cadence: INVOICE_CADENCE.ARREAR,
			meter_id: '',
			price_unit_type: PRICE_UNIT_TYPE.FIAT,
		});
		const unit = res.items.find((p) => p.lookup_key === 'drill_unit');
		expect(unit).toMatchObject({ type: PRICE_TYPE.USAGE, billing_model: BILLING_MODEL.FLAT_FEE, amount: '0.01' });
		const tiered = res.items.find((p) => p.lookup_key === 'drill_tiered');
		expect(tiered).toMatchObject({ type: PRICE_TYPE.USAGE, billing_model: BILLING_MODEL.TIERED, tier_mode: TIER_MODE.SLAB });
		expect(tiered?.tiers).toEqual([
			{ flat_amount: '0', unit_amount: '2', up_to: 1000 },
			{ flat_amount: '5', unit_amount: '1', up_to: Number.MAX_SAFE_INTEGER },
		]);
		expect(res.pagination).toEqual({ total: 3, limit: 10, offset: 0 });
	});

	it('searchPrices：filters 中的 entity_id/entity_type 同样生效；display_name contains 客户端过滤；offset/limit 分页', async () => {
		const client = mockClient();
		const res = await PriceApi.searchPrices({
			filters: [
				{ field: 'entity_type', operator: FilterOperator.EQUAL, data_type: DataType.STRING, value: { string: PRICE_ENTITY_TYPE.PLAN } },
				{ field: 'entity_id', operator: FilterOperator.EQUAL, data_type: DataType.STRING, value: { string: PLAN_ID } },
				{ field: 'display_name', operator: FilterOperator.CONTAINS, data_type: DataType.STRING, value: { string: 'tiered' } },
			],
			limit: 1,
			offset: 0,
		});
		expect(client.plans.get).toHaveBeenCalledWith(PLAN_ID);
		expect(res.items).toHaveLength(1);
		expect(res.items[0].lookup_key).toBe('drill_tiered');
		expect(res.pagination?.total).toBe(1);
	});

	it('searchPrices：非 PLAN 实体返回空集；后端禁用同样空集', async () => {
		mockClient();
		const addon = await PriceApi.searchPrices({ entity_type: PRICE_ENTITY_TYPE.ADDON, entity_ids: ['a1'] });
		expect(addon.items).toEqual([]);
		vi.mocked(getOpenMeterClient).mockReturnValue(null);
		const disabled = await PriceApi.searchPrices({ entity_type: PRICE_ENTITY_TYPE.PLAN, entity_ids: [PLAN_ID] });
		expect(disabled.items).toEqual([]);
		expect(disabled.pagination?.total).toBe(0);
	});

	it('GetPriceById：复合 id 解析并映射；非法 id 与不存在均报错', async () => {
		mockClient();
		const price = await PriceApi.GetPriceById(PRICE_ID_TIERED);
		expect(price.id).toBe(PRICE_ID_TIERED);
		expect(price.tiers?.[0].unit_amount).toBe('2');
		await expect(PriceApi.GetPriceById('not-a-valid-id')).rejects.toThrow(/非法/);
		const client = mockClient({ plans: { get: vi.fn().mockResolvedValue(undefined) } });
		await expect(PriceApi.GetPriceById(`${PLAN_ID}:drill_phase:drill_flat`)).rejects.toThrow(/不存在/);
		expect(client.plans.get).toHaveBeenCalledWith(PLAN_ID);
	});

	it('CreatePrice：FIXED+FLAT_FEE 追加为 flat_fee rate card（首 phase），回读合成价格', async () => {
		const client = mockClient();
		const price = await PriceApi.CreatePrice({
			amount: '30',
			currency: 'USD',
			entity_type: PRICE_ENTITY_TYPE.PLAN,
			entity_id: PLAN_ID,
			type: PRICE_TYPE.FIXED,
			price_unit_type: PRICE_UNIT_TYPE.FIAT,
			billing_period: BILLING_PERIOD.MONTHLY,
			billing_model: BILLING_MODEL.FLAT_FEE,
			invoice_cadence: INVOICE_CADENCE.ADVANCE,
			lookup_key: 'new_flat',
			display_name: 'New Flat',
		});
		expect(client.plans.get).toHaveBeenCalledWith(PLAN_ID);
		const payload = client.plans.update.mock.calls[0][1];
		expect(payload.phases[0].rateCards).toHaveLength(4);
		const appended = payload.phases[0].rateCards[3];
		expect(appended).toMatchObject({ type: 'flat_fee', key: 'new_flat', name: 'New Flat', billingCadence: 'P1M' });
		expect(appended.price).toEqual({ type: 'flat', amount: '30' });
		expect(price.lookup_key).toBe('new_flat');
		expect(price.amount).toBe('30');
		expect(price.type).toBe(PRICE_TYPE.FIXED);
	});

	it('CreateBulkPrice：USAGE 价格映射（unit/package/tiered）；meter_id 丢弃并 warn 一次', async () => {
		const client = mockClient();
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const res = await PriceApi.CreateBulkPrice({
			items: [
				{
					amount: '0.5',
					currency: 'USD',
					entity_type: PRICE_ENTITY_TYPE.PLAN,
					entity_id: PLAN_ID,
					type: PRICE_TYPE.USAGE,
					price_unit_type: PRICE_UNIT_TYPE.FIAT,
					billing_period: BILLING_PERIOD.MONTHLY,
					billing_model: BILLING_MODEL.FLAT_FEE,
					invoice_cadence: INVOICE_CADENCE.ARREAR,
					lookup_key: 'per_unit',
					meter_id: 'meter-1',
				},
				{
					amount: '10',
					currency: 'USD',
					entity_type: PRICE_ENTITY_TYPE.PLAN,
					entity_id: PLAN_ID,
					type: PRICE_TYPE.USAGE,
					price_unit_type: PRICE_UNIT_TYPE.FIAT,
					billing_period: BILLING_PERIOD.MONTHLY,
					billing_model: BILLING_MODEL.PACKAGE,
					invoice_cadence: INVOICE_CADENCE.ARREAR,
					lookup_key: 'pkg',
					transform_quantity: { divide_by: 5, round: 'up' },
				},
				{
					amount: '0',
					currency: 'USD',
					entity_type: PRICE_ENTITY_TYPE.PLAN,
					entity_id: PLAN_ID,
					type: PRICE_TYPE.USAGE,
					price_unit_type: PRICE_UNIT_TYPE.FIAT,
					billing_period: BILLING_PERIOD.MONTHLY,
					billing_model: BILLING_MODEL.TIERED,
					invoice_cadence: INVOICE_CADENCE.ARREAR,
					lookup_key: 'tiers',
					tier_mode: TIER_MODE.VOLUME,
					tiers: [
						{ up_to: 100, unit_amount: '2' },
						{ up_to: null, unit_amount: '1', flat_amount: '3' },
					],
				},
			],
		});
		expect(warn).toHaveBeenCalledTimes(1);
		warn.mockRestore();
		expect(client.plans.update).toHaveBeenCalledTimes(1);
		const cards = client.plans.update.mock.calls[0][1].phases[0].rateCards;
		expect(cards).toHaveLength(6);
		expect(cards[3]).toMatchObject({ type: 'usage_based', key: 'per_unit' });
		expect(cards[3].price).toEqual({ type: 'unit', amount: '0.5' });
		expect(cards[4].price).toEqual({ type: 'package', amount: '10', quantityPerPackage: '5' });
		expect(cards[5].price).toEqual({
			type: 'tiered',
			mode: 'volume',
			tiers: [
				{ upToAmount: '100', flatPrice: null, unitPrice: { type: 'unit', amount: '2' } },
				{ flatPrice: { type: 'flat', amount: '3' }, unitPrice: { type: 'unit', amount: '1' } },
			],
		});
		expect(res.items).toHaveLength(3);
		expect(res.items.map((p) => p.lookup_key)).toEqual(['per_unit', 'pkg', 'tiers']);
		const pkg = res.items.find((p) => p.lookup_key === 'pkg');
		expect(pkg?.billing_model).toBe(BILLING_MODEL.PACKAGE);
		expect(pkg?.transform_quantity).toEqual({ divide_by: 5, round: 'up' });
	});

	it('CreatePrice：非 PLAN 实体与 CUSTOM 计价单位明确报错（禁止假成功）', async () => {
		mockClient();
		await expect(
			PriceApi.CreatePrice({
				currency: 'USD',
				entity_type: PRICE_ENTITY_TYPE.ADDON,
				entity_id: 'a1',
				type: PRICE_TYPE.FIXED,
				price_unit_type: PRICE_UNIT_TYPE.FIAT,
				billing_model: BILLING_MODEL.FLAT_FEE,
				invoice_cadence: INVOICE_CADENCE.ADVANCE,
			}),
		).rejects.toThrow(/entity_type=ADDON/);
		const client = mockClient();
		await expect(
			PriceApi.CreatePrice({
				currency: 'USD',
				entity_type: PRICE_ENTITY_TYPE.PLAN,
				entity_id: PLAN_ID,
				type: PRICE_TYPE.FIXED,
				price_unit_type: PRICE_UNIT_TYPE.CUSTOM,
				price_unit_config: { price_unit: 'BTC' },
				billing_model: BILLING_MODEL.FLAT_FEE,
				invoice_cadence: INVOICE_CADENCE.ADVANCE,
			}),
		).rejects.toThrow(/自定义计价单位/);
		expect(client.plans.update).not.toHaveBeenCalled();
	});

	it('UpdatePrice：amount 重建价格对象；不支持字段（effective_from/bucket_size）明确报错', async () => {
		const client = mockClient();
		const price = await PriceApi.UpdatePrice(PRICE_ID_FLAT, { amount: '60' });
		const payload = client.plans.update.mock.calls[0][1];
		const updatedCard = payload.phases[0].rateCards.find((c: { key: string }) => c.key === 'drill_flat');
		expect(updatedCard.price).toEqual({ type: 'flat', amount: '60' });
		expect(price.amount).toBe('60');

		mockClient();
		await expect(PriceApi.UpdatePrice(PRICE_ID_FLAT, { amount: '60', effective_from: '2026-10-01T00:00:00Z' })).rejects.toThrow(
			/effective_from/,
		);
		await expect(PriceApi.UpdatePrice(PRICE_ID_FLAT, { bucket_size: 'none' as never })).rejects.toThrow(/bucket_size/);
	});

	it('UpdatePrice：tiered 价格卡可用 tiers+tier_mode 重建', async () => {
		const client = mockClient();
		const price = await PriceApi.UpdatePrice(PRICE_ID_TIERED, {
			billing_model: BILLING_MODEL.TIERED,
			tier_mode: TIER_MODE.VOLUME,
			tiers: [{ up_to: null, unit_amount: '4' }],
		});
		const payload = client.plans.update.mock.calls[0][1];
		const updatedCard = payload.phases[0].rateCards.find((c: { key: string }) => c.key === 'drill_tiered');
		expect(updatedCard.price).toEqual({
			type: 'tiered',
			mode: 'volume',
			tiers: [{ flatPrice: null, unitPrice: { type: 'unit', amount: '4' } }],
		});
		expect(price.tier_mode).toBe(TIER_MODE.VOLUME);
	});

	it('DeletePrice：立即删除 = 从 phase 移除 rate card；调度式删除（end_date）明确报错', async () => {
		const client = mockClient();
		await PriceApi.DeletePrice(PRICE_ID_FLAT);
		const payload = client.plans.update.mock.calls[0][1];
		expect(payload.phases[0].rateCards.map((c: { key: string }) => c.key)).toEqual(['drill_unit', 'drill_tiered']);

		mockClient();
		await expect(PriceApi.DeletePrice(PRICE_ID_FLAT, { end_date: '2026-10-01T00:00:00Z' })).rejects.toThrow(/调度式删除/);
	});

	it('ListPrices：price_ids 按复合 id 解析定位；meter_ids 过滤必然为空（合成价格无 meter）', async () => {
		const client = mockClient();
		const res = await PriceApi.ListPrices({ price_ids: [PRICE_ID_FLAT] });
		expect(client.plans.get).toHaveBeenCalledWith(PLAN_ID);
		expect(res.items).toHaveLength(1);
		expect(res.items[0].id).toBe(PRICE_ID_FLAT);
		expect(res.total).toBe(1);

		const byMeter = await PriceApi.ListPrices({ meter_ids: ['meter-1'] });
		expect(byMeter.items).toEqual([]);
	});
});
