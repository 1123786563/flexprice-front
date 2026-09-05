// src/api/NotificationApi.ts
// OpenMeter 原生 notifications 域薄壳：channels（WEBHOOK 单类型）/ rules（type 判别 4 类）/
// events（投递记录 + resend）。概念与 OM 一一对应，不做 DTO 映射，类型全部从 SDK client 派生。
import { getOpenMeterClient, requireOpenMeterClient, type OpenMeterClient } from '@/core/services/openmeter';
import { omV1 } from '@/core/services/openmeter/omFetch';

type NotificationChannels = OpenMeterClient['notifications']['channels'];
type NotificationRules = OpenMeterClient['notifications']['rules'];
type NotificationEvents = OpenMeterClient['notifications']['events'];

// ---- Channels（WEBHOOK 单类型）----
export type OmNotificationChannel = NonNullable<Awaited<ReturnType<NotificationChannels['get']>>>;
export type OmNotificationChannelPage = NonNullable<Awaited<ReturnType<NotificationChannels['list']>>>;
/** SDK create/update 入参为完整 Channel（含服务端只读字段）；线上仅消费 CreateRequest 字段，其余被忽略。 */
export type OmNotificationChannelInput = Parameters<NotificationChannels['create']>[0];
export type OmNotificationChannelUpdateInput = Parameters<NotificationChannels['update']>[1];
export type OmNotificationChannelListQuery = Parameters<NotificationChannels['list']>[0];

// ---- Rules（type 判别联合）----
export type OmNotificationRule = NonNullable<Awaited<ReturnType<NotificationRules['get']>>>;
export type OmNotificationRulePage = NonNullable<Awaited<ReturnType<NotificationRules['list']>>>;
export type OmNotificationRuleInput = Parameters<NotificationRules['create']>[0];
export type OmNotificationRuleListQuery = Parameters<NotificationRules['list']>[0];

export type OmRuleType = OmNotificationRule['type'];
export type OmBalanceThresholdRule = Extract<OmNotificationRule, { type: 'entitlements.balance.threshold' }>;
export type OmEntitlementResetRule = Extract<OmNotificationRule, { type: 'entitlements.reset' }>;
/** 两个 entitlements.* 规则均可挂 feature 过滤（invoice.* 规则无此字段）。 */
export type OmEntitlementsRule = OmBalanceThresholdRule | OmEntitlementResetRule;
/** 阈值类型以 SDK schema 为准：balance_value / usage_percentage / usage_value（PERCENT、NUMBER 为废弃别名）。 */
export type OmRuleThreshold = OmBalanceThresholdRule['thresholds'][number];
export type OmRuleThresholdType = OmRuleThreshold['type'];
export type OmRuleChannelMeta = OmBalanceThresholdRule['channels'][number];

// ---- Events（只读 + resend）----
export type OmNotificationEvent = NonNullable<Awaited<ReturnType<NotificationEvents['get']>>>;
export type OmNotificationEventPage = NonNullable<Awaited<ReturnType<NotificationEvents['list']>>>;
export type OmNotificationEventListQuery = Parameters<NotificationEvents['list']>[0];

/** OM 分页响应缺页时（后端禁用/空响应）的兜底空集。 */
function emptyPage<T>(): { totalCount: number; page: number; pageSize: number; items: T[] } {
	return { items: [], totalCount: 0, page: 1, pageSize: 0 };
}

class NotificationApi {
	// ---- Channels ----
	public static async listChannels(query?: OmNotificationChannelListQuery): Promise<OmNotificationChannelPage> {
		const client = getOpenMeterClient();
		if (!client) return emptyPage<OmNotificationChannel>();
		return (await client.notifications.channels.list(query)) ?? emptyPage<OmNotificationChannel>();
	}

	public static async getChannel(id: string): Promise<OmNotificationChannel> {
		const channel = await requireOpenMeterClient().notifications.channels.get(id);
		if (!channel) throw new Error(`通知渠道 ${id} 不存在`);
		return channel;
	}

	public static async createChannel(input: OmNotificationChannelInput): Promise<OmNotificationChannel> {
		const channel = await requireOpenMeterClient().notifications.channels.create(input);
		if (!channel) throw new Error('创建通知渠道失败');
		return channel;
	}

	public static async updateChannel(id: string, input: OmNotificationChannelUpdateInput): Promise<OmNotificationChannel> {
		const channel = await requireOpenMeterClient().notifications.channels.update(id, input);
		if (!channel) throw new Error(`更新通知渠道 ${id} 失败`);
		return channel;
	}

	public static async deleteChannel(id: string): Promise<void> {
		await requireOpenMeterClient().notifications.channels.delete(id);
	}

	// ---- Rules ----
	public static async listRules(query?: OmNotificationRuleListQuery): Promise<OmNotificationRulePage> {
		const client = getOpenMeterClient();
		if (!client) return emptyPage<OmNotificationRule>();
		return (await client.notifications.rules.list(query)) ?? emptyPage<OmNotificationRule>();
	}

	public static async getRule(id: string): Promise<OmNotificationRule> {
		const rule = await requireOpenMeterClient().notifications.rules.get(id);
		if (!rule) throw new Error(`通知规则 ${id} 不存在`);
		return rule;
	}

	public static async createRule(input: OmNotificationRuleInput): Promise<OmNotificationRule> {
		const rule = await requireOpenMeterClient().notifications.rules.create(input);
		if (!rule) throw new Error('创建通知规则失败');
		return rule;
	}

	public static async updateRule(id: string, input: OmNotificationRuleInput): Promise<OmNotificationRule> {
		const rule = await requireOpenMeterClient().notifications.rules.update(id, input);
		if (!rule) throw new Error(`更新通知规则 ${id} 失败`);
		return rule;
	}

	public static async deleteRule(id: string): Promise<void> {
		await requireOpenMeterClient().notifications.rules.delete(id);
	}

	/** 发送随机数据的测试事件（v1 `POST /notification/rules/{id}/test`），返回投递记录。 */
	public static async testRule(id: string): Promise<OmNotificationEvent> {
		const event = await omV1<OmNotificationEvent>(`/notification/rules/${id}/test`, { method: 'POST' });
		if (!event) throw new Error('发送测试事件失败');
		return event;
	}

	// ---- Events ----
	public static async listEvents(query?: OmNotificationEventListQuery): Promise<OmNotificationEventPage> {
		const client = getOpenMeterClient();
		if (!client) return emptyPage<OmNotificationEvent>();
		return (await client.notifications.events.list(query)) ?? emptyPage<OmNotificationEvent>();
	}

	public static async getEvent(id: string): Promise<OmNotificationEvent> {
		const event = await requireOpenMeterClient().notifications.events.get(id);
		if (!event) throw new Error(`通知事件 ${id} 不存在`);
		return event;
	}

	/** channels 缺省时 OM 会重发到规则挂载的全部渠道。 */
	public static async resendEvent(id: string, channels?: string[]): Promise<void> {
		await requireOpenMeterClient().notifications.events.resend(id, channels ? { channels } : undefined);
	}
}

export default NotificationApi;
