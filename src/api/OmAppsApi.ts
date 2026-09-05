// src/api/OmAppsApi.ts
// OpenMeter 应用域（apps）：Stripe 应用安装态（v1 marketplace/apps + v3 app 面向客户的
// 会话）。Stripe 应用是 OSS 集成域的主力：安装后为客户提供账单门户（portal session）
// 与收银台（checkout session）。Flexprice 的 provider 型集成目录（QuickBooks/HubSpot/
// LinkedIn 等）在 OM 无对应，仍由 IntegrationsApi 垫片承载。
import { getOpenMeterClient, requireOpenMeterClient, type OpenMeterClient } from '@/core/services/openmeter';
import { omV3 } from '@/core/services/openmeter/omFetch';

type OmApp = NonNullable<Awaited<ReturnType<OpenMeterClient['apps']['list']>>>['items'][number];

/** Stripe 账单门户会话（v1/v3 语义一致，OM 返回 returnUrl 供跳转）。 */
export interface StripePortalSession {
	id: string;
	stripeCustomerId: string;
	configurationId?: string;
	livemode: boolean;
	returnUrl?: string;
	created_at?: string;
}

function emptyAppPage(): { items: OmApp[]; totalCount: number; page: number; pageSize: number } {
	return { items: [], totalCount: 0, page: 1, pageSize: 0 };
}

class OmAppsApi {
	public static async listApps(): Promise<OmApp[]> {
		const client = getOpenMeterClient();
		if (!client) return [];
		const page = (await client.apps.list({ pageSize: 100 })) ?? emptyAppPage();
		return page.items ?? [];
	}

	/** 已安装的 Stripe 应用（无则返回 null——Stripe 会话/支付能力均不可用）。 */
	public static async getInstalledStripeApp(): Promise<OmApp | null> {
		const apps = await this.listApps();
		return apps.find((app) => app.type === 'stripe') ?? null;
	}

	/**
	 * 安装 Stripe 应用：v1 marketplace API-key 安装（type=stripe）。
	 * 默认同时创建 billing profile 并设为默认（替代 sandbox）。
	 */
	public static async installStripeApp(apiKey: string, name?: string): Promise<void> {
		const body = { apiKey, createBillingProfile: true, ...(name ? { name } : {}) } as Parameters<
			OpenMeterClient['apps']['marketplace']['installWithAPIKey']
		>[1];
		await requireOpenMeterClient().apps.marketplace.installWithAPIKey('stripe', body);
	}

	public static async updateStripeApiKey(appId: string, apiKey: string): Promise<void> {
		await requireOpenMeterClient().apps.stripe.updateApiKey(appId, { secretAPIKey: apiKey });
	}

	public static async uninstallApp(appId: string): Promise<void> {
		await requireOpenMeterClient().apps.uninstall(appId);
	}

	/** 客户的 Stripe 账单门户会话（管理支付方式/发票/订阅），跳转用 returnUrl/url。 */
	public static async createStripePortalSession(customerIdOrKey: string): Promise<StripePortalSession> {
		const session = await requireOpenMeterClient().customers.stripe.createPortalSession(customerIdOrKey, {});
		if (!session) throw new Error('创建 Stripe 账单门户会话失败');
		return { ...session, returnUrl: session.returnUrl ?? session.url } as StripePortalSession;
	}

	/** 客户的 Stripe 收银台会话（setup intent 绑卡）。 */
	public static async createStripeCheckoutSession(
		customerId: string,
		options: Record<string, unknown> = {},
	): Promise<{ sessionId: string; clientSecret?: string; setupIntentId?: string }> {
		return await omV3(`/customers/${customerId}/billing/stripe/checkout-sessions`, {
			method: 'POST',
			body: { stripe_options: options },
		});
	}
}

export default OmAppsApi;
