import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@/core/services/openmeter', () => ({
	getOpenMeterClient: vi.fn(),
	requireOpenMeterClient: vi.fn(),
}));

import { getOpenMeterClient, requireOpenMeterClient } from '@/core/services/openmeter';
import NotificationApi from '@/api/NotificationApi';
import type { OmNotificationChannel, OmNotificationEvent, OmNotificationRule, OmNotificationRuleInput } from '@/api/NotificationApi';

const CHANNEL: OmNotificationChannel = {
	id: '01CHANNEL0000000000000000X',
	type: 'WEBHOOK',
	name: 'ntest-channel',
	url: 'https://example.com/webhook',
	disabled: false,
	customHeaders: { 'X-Env': 'test' },
	metadata: { env: 'test' },
	createdAt: new Date('2026-09-01T00:00:00Z'),
	updatedAt: new Date('2026-09-01T00:00:00Z'),
} as unknown as OmNotificationChannel;

const RULE_BALANCE_THRESHOLD: OmNotificationRule = {
	id: '01RULE000000000000000000XA',
	type: 'entitlements.balance.threshold',
	name: 'ntest-rule-balance',
	channels: [{ id: CHANNEL.id, type: 'WEBHOOK' }],
	thresholds: [{ value: 80, type: 'usage_percentage' }],
	features: [{ id: '01FEATURE00000000000000XA', key: 'api_calls', name: 'API Calls' }],
	createdAt: new Date('2026-09-01T00:00:00Z'),
	updatedAt: new Date('2026-09-01T00:00:00Z'),
} as unknown as OmNotificationRule;

const EVENT: OmNotificationEvent = {
	id: '01EVENT000000000000000000XA',
	type: 'entitlements.balance.threshold',
	createdAt: new Date('2026-09-01T00:00:00Z'),
	rule: RULE_BALANCE_THRESHOLD,
	deliveryStatus: [{ id: 'ds-1', channelId: CHANNEL.id, state: 'SUCCESS', totalAttempts: 1, attempts: [] }],
	payload: { id: '01EVENT000000000000000000XA', type: 'entitlements.balance.threshold', timestamp: new Date(), data: {} },
} as unknown as OmNotificationEvent;

function mockClient(overrides: Record<string, unknown> = {}) {
	const client = {
		notifications: {
			channels: {
				list: vi.fn().mockResolvedValue({ items: [CHANNEL], totalCount: 1, page: 1, pageSize: 100 }),
				get: vi.fn().mockResolvedValue(CHANNEL),
				create: vi.fn().mockResolvedValue(CHANNEL),
				update: vi.fn().mockResolvedValue(CHANNEL),
				delete: vi.fn().mockResolvedValue(undefined),
			},
			rules: {
				list: vi.fn().mockResolvedValue({ items: [RULE_BALANCE_THRESHOLD], totalCount: 1, page: 1, pageSize: 100 }),
				get: vi.fn().mockResolvedValue(RULE_BALANCE_THRESHOLD),
				create: vi.fn().mockResolvedValue(RULE_BALANCE_THRESHOLD),
				update: vi.fn().mockResolvedValue(RULE_BALANCE_THRESHOLD),
				delete: vi.fn().mockResolvedValue(undefined),
			},
			events: {
				list: vi.fn().mockResolvedValue({ items: [EVENT], totalCount: 1, page: 1, pageSize: 100 }),
				get: vi.fn().mockResolvedValue(EVENT),
				resend: vi.fn().mockResolvedValue(undefined),
			},
		},
		...overrides,
	};
	vi.mocked(getOpenMeterClient).mockReturnValue(client as never);
	vi.mocked(requireOpenMeterClient).mockReturnValue(client as never);
	return client;
}

describe('NotificationApi（OpenMeter notifications 域薄壳）', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('listChannels：透传分页 query 并返回 OM 原生分页', async () => {
		const client = mockClient();
		const page = await NotificationApi.listChannels({ page: 2, pageSize: 50 });
		expect(client.notifications.channels.list).toHaveBeenCalledWith({ page: 2, pageSize: 50 });
		expect(page.items).toHaveLength(1);
		expect(page.items[0].type).toBe('WEBHOOK');
		expect(page.totalCount).toBe(1);
	});

	it('channels CRUD：get/create/update/delete 透传', async () => {
		const client = mockClient();
		// SDK 入参类型含服务端只读字段（id/createdAt/updatedAt 为必填），线上 schema 不消费
		const created = await NotificationApi.createChannel({
			id: '',
			type: 'WEBHOOK',
			name: 'ntest-channel',
			url: 'https://example.com/webhook',
			createdAt: new Date(),
			updatedAt: new Date(),
		});
		expect(client.notifications.channels.create).toHaveBeenCalledWith(
			expect.objectContaining({ type: 'WEBHOOK', url: 'https://example.com/webhook' }),
		);
		expect(created.id).toBe(CHANNEL.id);

		await NotificationApi.updateChannel(CHANNEL.id, { ...CHANNEL, name: 'ntest-channel-2' });
		expect(client.notifications.channels.update).toHaveBeenCalledWith(CHANNEL.id, expect.objectContaining({ name: 'ntest-channel-2' }));

		await NotificationApi.deleteChannel(CHANNEL.id);
		expect(client.notifications.channels.delete).toHaveBeenCalledWith(CHANNEL.id);

		client.notifications.channels.get.mockResolvedValue(undefined);
		await expect(NotificationApi.getChannel('missing')).rejects.toThrow('不存在');
	});

	it('listRules：透传 query；后端禁用时优雅降级为空集', async () => {
		const client = mockClient();
		const page = await NotificationApi.listRules();
		expect(client.notifications.rules.list).toHaveBeenCalledWith(undefined);
		expect(page.items[0].type).toBe('entitlements.balance.threshold');

		vi.mocked(getOpenMeterClient).mockReturnValue(null);
		const empty = await NotificationApi.listRules();
		expect(empty.items).toEqual([]);
		expect(empty.totalCount).toBe(0);
	});

	it('createRule：balance threshold 最小体（type 判别 + thresholds + channels）', async () => {
		const client = mockClient();
		const input: OmNotificationRuleInput = {
			type: 'entitlements.balance.threshold',
			name: 'ntest-rule-balance',
			channels: [CHANNEL.id],
			thresholds: [{ value: 80, type: 'usage_percentage' }],
			features: ['api_calls'],
		};
		await NotificationApi.createRule(input);
		expect(client.notifications.rules.create).toHaveBeenCalledWith(
			expect.objectContaining({
				type: 'entitlements.balance.threshold',
				name: 'ntest-rule-balance',
				channels: [CHANNEL.id],
				thresholds: [{ value: 80, type: 'usage_percentage' }],
				features: ['api_calls'],
			}),
		);
	});

	it('updateRule / deleteRule：透传 id 与 create 形状 body', async () => {
		const client = mockClient();
		await NotificationApi.updateRule(RULE_BALANCE_THRESHOLD.id, {
			type: 'invoice.created',
			name: 'ntest-rule-invoice',
			channels: [CHANNEL.id],
		});
		expect(client.notifications.rules.update).toHaveBeenCalledWith(
			RULE_BALANCE_THRESHOLD.id,
			expect.objectContaining({ type: 'invoice.created' }),
		);

		await NotificationApi.deleteRule(RULE_BALANCE_THRESHOLD.id);
		expect(client.notifications.rules.delete).toHaveBeenCalledWith(RULE_BALANCE_THRESHOLD.id);
	});

	it('listEvents：透传分页 query', async () => {
		const client = mockClient();
		const page = await NotificationApi.listEvents({ page: 1, pageSize: 100 });
		expect(client.notifications.events.list).toHaveBeenCalledWith({ page: 1, pageSize: 100 });
		expect(page.items[0].id).toBe(EVENT.id);
		expect(page.items[0].deliveryStatus[0].state).toBe('SUCCESS');
	});

	it('resendEvent：带 channels 时发 body，缺省时 body 为 undefined（OM 重发到全部渠道）', async () => {
		const client = mockClient();
		await NotificationApi.resendEvent(EVENT.id, [CHANNEL.id]);
		expect(client.notifications.events.resend).toHaveBeenCalledWith(EVENT.id, { channels: [CHANNEL.id] });

		await NotificationApi.resendEvent(EVENT.id);
		expect(client.notifications.events.resend).toHaveBeenCalledWith(EVENT.id, undefined);
	});
});
