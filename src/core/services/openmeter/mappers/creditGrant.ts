// src/core/services/openmeter/mappers/creditGrant.ts
// OM entitlement grant → Flexprice CreditGrantResponse（最弱映射域）。
//
// 概念错位：Flexprice credit grant 是目录/订阅级credits定义（scope=PLAN/ADDON/SUBSCRIPTION、
// cadence/period/conversion_rate），OM grant 是挂在客户 entitlement 上的额度授予（amount/priority/
// expiration/recurrence）。映射策略：
// - credits ↔ amount、priority ↔ priority、start_date ↔ effectiveAt、expiration ↔ expiresAt；
// - cadence/period 由 recurrence 还原，无 recurrence 即 ONETIME；
// - scope/plan_id/addon_id/subscription_id/name 写进 OM grant metadata 保留键，list 时按其过滤
//   （外部创建的 grant 无这些键：带 scope 过滤时不匹配，不带过滤时按 SUBSCRIPTION 兜底展示）；
// - conversion_rate/topup_conversion_rate/period_count 无 OM 对应，丢弃（已知限制）。
import type { OpenMeterClient } from '@/core/services/openmeter';
import {
	CREDIT_GRANT_CADENCE,
	CREDIT_GRANT_EXPIRATION_TYPE,
	CREDIT_GRANT_PERIOD,
	CREDIT_GRANT_PERIOD_UNIT,
	CREDIT_GRANT_SCOPE,
	ENTITY_STATUS,
	type CreditGrant,
} from '@/models';
import type { CreateCreditGrantRequest, CreditGrantFilter } from '@/types/dto';
import { iso } from './common';

export type OmGrantV2 = NonNullable<Awaited<ReturnType<OpenMeterClient['entitlements']['grants']['list']>>>['items'][number];
export type OmGrantCreate = Parameters<OpenMeterClient['customers']['entitlements']['createGrant']>[2];

const META_PREFIX = 'flexprice.';
const META_NAME = `${META_PREFIX}name`;
const META_SCOPE = `${META_PREFIX}scope`;
const META_PLAN_ID = `${META_PREFIX}plan_id`;
const META_ADDON_ID = `${META_PREFIX}addon_id`;
const META_SUBSCRIPTION_ID = `${META_PREFIX}subscription_id`;

const PERIOD_BY_INTERVAL: Record<string, CREDIT_GRANT_PERIOD> = {
	DAY: CREDIT_GRANT_PERIOD.DAILY,
	P1D: CREDIT_GRANT_PERIOD.DAILY,
	WEEK: CREDIT_GRANT_PERIOD.WEEKLY,
	P1W: CREDIT_GRANT_PERIOD.WEEKLY,
	MONTH: CREDIT_GRANT_PERIOD.MONTHLY,
	P1M: CREDIT_GRANT_PERIOD.MONTHLY,
	YEAR: CREDIT_GRANT_PERIOD.ANNUAL,
	P1Y: CREDIT_GRANT_PERIOD.ANNUAL,
	P3M: CREDIT_GRANT_PERIOD.QUARTERLY,
	P6M: CREDIT_GRANT_PERIOD.HALF_YEARLY,
};

/** 用户可见 metadata：剥掉 `flexprice.*` 保留键。 */
function userMetadata(metadata: Record<string, string> | undefined | null): CreditGrant['metadata'] {
	const out: CreditGrant['metadata'] = {};
	for (const [k, v] of Object.entries(metadata ?? {})) {
		if (!k.startsWith(META_PREFIX)) out[k] = v;
	}
	return out;
}

/** Flexprice scope 值 ↔ OM metadata 保留键。 */
function readScope(metadata: Record<string, string> | undefined): CREDIT_GRANT_SCOPE {
	const raw = metadata?.[META_SCOPE];
	if (raw === CREDIT_GRANT_SCOPE.PLAN || raw === CREDIT_GRANT_SCOPE.ADDON) return raw;
	return CREDIT_GRANT_SCOPE.SUBSCRIPTION;
}

/** OM interval（enum 名或 ISO duration）→ Flexprice CREDIT_GRANT_PERIOD；识别不了 undefined。 */
export function intervalToGrantPeriod(interval: string | undefined): CREDIT_GRANT_PERIOD | undefined {
	return interval ? PERIOD_BY_INTERVAL[String(interval).toUpperCase()] : undefined;
}

/** OM grant → Flexprice CreditGrantResponse。 */
export function mapOmGrant(om: OmGrantV2): CreditGrant {
	const metadata = om.metadata ?? {};
	const isVoided = om.voidedAt != null;
	const expiration = om.expiration;
	return {
		id: om.id,
		name: metadata[META_NAME] ?? om.id,
		credits: om.amount,
		cadence: om.recurrence ? CREDIT_GRANT_CADENCE.RECURRING : CREDIT_GRANT_CADENCE.ONETIME,
		metadata: userMetadata(metadata),
		period: intervalToGrantPeriod(om.recurrence?.interval),
		priority: om.priority,
		scope: readScope(metadata),
		...(metadata[META_PLAN_ID] ? { plan_id: metadata[META_PLAN_ID] } : {}),
		...(metadata[META_ADDON_ID] ? { addon_id: metadata[META_ADDON_ID] } : {}),
		...(metadata[META_SUBSCRIPTION_ID] ? { subscription_id: metadata[META_SUBSCRIPTION_ID] } : {}),
		expiration_type: expiration ? CREDIT_GRANT_EXPIRATION_TYPE.DURATION : CREDIT_GRANT_EXPIRATION_TYPE.NEVER,
		...(expiration ? { expiration_duration: expiration.count } : {}),
		...(expiration ? { expiration_duration_unit: expiration.duration as CREDIT_GRANT_PERIOD_UNIT } : {}),
		start_date: iso(om.effectiveAt),
		end_date: iso(om.expiresAt),
		credit_grant_anchor: iso(om.recurrence?.anchor),
		tenant_id: '',
		status: isVoided ? ENTITY_STATUS.DELETED : ENTITY_STATUS.PUBLISHED,
		environment_id: '',
		created_by: '',
		updated_by: '',
		created_at: iso(om.createdAt),
		updated_at: iso(om.updatedAt),
	};
}

/**
 * Flexprice CreateCreditGrantRequest → OM 客户 grant 创建体。
 * scope/plan/addon/subscription/name 写进保留键供 list 回读过滤；BILLING_CYCLE 过期与
 * conversion_rate 无 OM 对应，丢弃。subject/feature 由调用方解析（Flexprice 请求不含）。
 */
export function buildOmGrantCreate(req: CreateCreditGrantRequest): OmGrantCreate {
	const metadata: Record<string, string> = { ...req.metadata, [META_NAME]: req.name, [META_SCOPE]: req.scope };
	if (req.plan_id) metadata[META_PLAN_ID] = req.plan_id;
	if (req.addon_id) metadata[META_ADDON_ID] = req.addon_id;
	if (req.subscription_id) metadata[META_SUBSCRIPTION_ID] = req.subscription_id;

	const expiration =
		req.expiration_type === CREDIT_GRANT_EXPIRATION_TYPE.DURATION && req.expiration_duration != null && req.expiration_duration > 0
			? {
					duration: req.expiration_duration_unit ?? CREDIT_GRANT_PERIOD_UNIT.MONTHS,
					count: req.expiration_duration,
				}
			: undefined;

	const recurrence =
		req.cadence === CREDIT_GRANT_CADENCE.RECURRING
			? { interval: periodToIsoDuration(req.period ?? CREDIT_GRANT_PERIOD.MONTHLY) }
			: undefined;

	return {
		amount: req.credits,
		...(req.priority != null ? { priority: req.priority } : {}),
		effectiveAt: req.start_date ? new Date(req.start_date) : new Date(),
		...(expiration ? { expiration } : {}),
		...(recurrence ? { recurrence } : {}),
		metadata,
	};
}

/** Flexprice period → OM ISO duration。 */
function periodToIsoDuration(period: CREDIT_GRANT_PERIOD): string {
	switch (period) {
		case CREDIT_GRANT_PERIOD.DAILY:
			return 'P1D';
		case CREDIT_GRANT_PERIOD.WEEKLY:
			return 'P1W';
		case CREDIT_GRANT_PERIOD.QUARTERLY:
			return 'P3M';
		case CREDIT_GRANT_PERIOD.HALF_YEARLY:
			return 'P6M';
		case CREDIT_GRANT_PERIOD.ANNUAL:
			return 'P1Y';
		default:
			return 'P1M';
	}
}

/** 客户端过滤：OM 无目录维度过滤，plan/addon/subscription/scope/ids 在返回集上按保留键匹配。 */
export function filterGrantsClientSide(items: CreditGrant[], filter: CreditGrantFilter): CreditGrant[] {
	let result = items;
	if (filter.scope) {
		result = result.filter((g) => g.scope === filter.scope);
	}
	if (filter.plan_ids?.length) {
		const ids = new Set(filter.plan_ids);
		result = result.filter((g) => g.plan_id != null && ids.has(g.plan_id));
	}
	if (filter.addon_ids?.length) {
		const ids = new Set(filter.addon_ids);
		result = result.filter((g) => g.addon_id != null && ids.has(g.addon_id));
	}
	if (filter.subscription_ids?.length) {
		const ids = new Set(filter.subscription_ids);
		result = result.filter((g) => g.subscription_id != null && ids.has(g.subscription_id));
	}
	if (filter.credit_grant_ids?.length) {
		const ids = new Set(filter.credit_grant_ids);
		result = result.filter((g) => ids.has(g.id));
	}
	if (filter.status) {
		result = result.filter((g) => g.status === filter.status);
	}
	return result;
}
