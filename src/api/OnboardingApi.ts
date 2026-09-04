// src/api/OnboardingApi.ts
// OpenMeter 本地模式：generateEvents 复用 EventsApi.fireEvents（OM events.ingest）；
// setupDemo（后端演示数据初始化）OM 无对应，明确报错；recordOnboardingData 保留
// 原有 Google Sheets fetch 逻辑（与 Flexprice 后端无关，不经过 axios）。
import { config } from '@/config/config';
import EventsApi from '@/api/EventsApi';
import { FireEventsPayload } from '@/types/dto';
import { unsupportedLocalOperation } from '@/core/services/platform/localPlatform';

export interface SetupDemoRequest {
	// Add fields based on backend requirements
	// This may need to be updated once backend structure is known
	[key: string]: any;
}

export interface SetupDemoResponse {
	// Add fields based on backend response
	// This may need to be updated once backend structure is known
	message?: string;
	[key: string]: any;
}

export type OnboardingDataRequest = Record<string, string>;

class OnboardingApi {
	/**
	 * Generate events for onboarding
	 * OM 承载：走 EventsApi.fireEvents → OM events.ingest（CloudEvents）。
	 */
	public static async generateEvents(payload: FireEventsPayload): Promise<void> {
		return await EventsApi.fireEvents(payload);
	}

	/**
	 * Setup demo
	 * 演示租户/客户/订阅数据初始化为 Flexprice 后端能力，OM 无对应。
	 */
	public static async setupDemo(_payload: SetupDemoRequest): Promise<SetupDemoResponse> {
		unsupportedLocalOperation('初始化演示数据（setup demo）');
	}

	/**
	 * Record onboarding data to Google Sheets
	 * POST to Google Apps Script Web App URL
	 */
	public static async recordOnboardingData(payload: OnboardingDataRequest): Promise<void> {
		const webAppUrl = config.integrations.googleSheetsWebAppUrl;

		if (!webAppUrl) {
			console.warn('VITE_GOOGLE_SHEETS_WEB_APP_URL is not configured. Skipping onboarding data recording.');
			return;
		}

		// Use a "simple" fetch request to avoid CORS preflight (OPTIONS) where possible.
		// Note: `Content-Type: application/json` would trigger a preflight in browsers.
		const controller = new AbortController();
		const timeoutId = window.setTimeout(() => controller.abort(), 10_000);

		try {
			const res = await fetch(webAppUrl, {
				method: 'POST',
				headers: {
					// Keep request "simple" to reduce preflight chances (Google Apps Script can still read raw body).
					'Content-Type': 'text/plain;charset=UTF-8',
				},
				body: JSON.stringify(payload),
				signal: controller.signal,
			});

			// This is non-critical telemetry; don't hard-fail onboarding on sheet issues.
			if (!res.ok) {
				const text = await res.text().catch(() => '');
				console.warn('Failed to record onboarding data to Google Sheets.', {
					status: res.status,
					statusText: res.statusText,
					body: text,
				});
			}
		} catch (err) {
			console.warn('Failed to record onboarding data to Google Sheets.', err);
		} finally {
			window.clearTimeout(timeoutId);
		}
	}
}

export default OnboardingApi;
