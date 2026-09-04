// src/core/services/openmeter/mappers/common.ts
// OM 分页响应 → Flexprice Pagination 的公共换算与 OM ISO-8601 billingCadence 解析。
import type { Pagination } from '@/models';
import { BILLING_PERIOD } from '@/constants/constants';

/** OM 分页响应的公共形状（list 端点统一返回）。 */
export interface OmPage {
	items: unknown[];
	totalCount: number;
	page: number;
	pageSize: number;
}

export function toFlexpricePagination(
	om: { totalCount: number; page: number; pageSize: number },
	limit?: number | null,
	offset?: number | null,
): Pagination {
	return {
		limit: limit ?? om.pageSize,
		offset: offset ?? (om.page - 1) * om.pageSize,
		total: om.totalCount,
	};
}

/** SDK 类型把时间声明为 Date，但 openapi-fetch 运行时返回的是 JSON 字符串——两者都归一为 ISO 字符串。 */
export function iso(value: Date | string | null | undefined): string {
	if (!value) return '';
	return typeof value === 'string' ? value : value.toISOString();
}

/** OM ISO-8601 billingCadence（P1M/P3M/P1Y…）→ Flexprice BILLING_PERIOD。 */
export function cadenceToBillingPeriod(cadence: string | undefined): BILLING_PERIOD {
	switch (cadence) {
		case 'P1D':
			return BILLING_PERIOD.DAILY;
		case 'P1W':
			return BILLING_PERIOD.WEEKLY;
		case 'P1M':
			return BILLING_PERIOD.MONTHLY;
		case 'P3M':
			return BILLING_PERIOD.QUARTERLY;
		case 'P6M':
			return BILLING_PERIOD.HALF_YEARLY;
		case 'P1Y':
			return BILLING_PERIOD.ANNUAL;
		default:
			return BILLING_PERIOD.MONTHLY;
	}
}

/** ISO-8601 时长（P1M/P1Y…）换算为月数；无法解析返回 null。 */
export function cadenceToMonths(cadence: string | undefined): number | null {
	const match = /^P(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)W)?(?:(\d+)D)?$/.exec(cadence ?? '');
	if (!match) return null;
	const years = Number(match[1] ?? 0);
	const months = Number(match[2] ?? 0);
	const weeks = Number(match[3] ?? 0);
	const days = Number(match[4] ?? 0);
	if (!years && !months && !weeks && !days) return null;
	return years * 12 + months + (weeks ? (weeks * 7) / 30 : 0) + days / 30;
}

/** 以 billingAnchor 为锚、按 cadence 推算包含 `now` 的当前账期区间。 */
export function currentPeriodFromCadence(
	billingAnchor: Date | string | undefined,
	cadence: string | undefined,
	now: Date = new Date(),
): { start: string; end: string } {
	const anchor = billingAnchor ? new Date(billingAnchor) : new Date();
	const months = cadenceToMonths(cadence) ?? 1;
	const msPerMonth = 30.44 * 24 * 3600 * 1000;
	const interval = months * msPerMonth;
	const anchorMs = anchor.getTime();
	// 无限早的锚点保护：锚点晚于 now 时当前账期即 [anchor, anchor+interval)。
	const elapsed = Math.max(0, now.getTime() - anchorMs);
	const periods = Math.floor(elapsed / interval);
	const start = new Date(anchorMs + periods * interval);
	const end = new Date(anchorMs + (periods + 1) * interval);
	return { start: start.toISOString(), end: end.toISOString() };
}
