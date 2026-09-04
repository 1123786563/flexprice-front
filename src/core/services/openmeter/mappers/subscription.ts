// src/core/services/openmeter/mappers/subscription.ts
// OM subscription（v2：phases/rateCards 计费模型）→ Flexprice SubscriptionResponse。
// OM 无行项目级暴露：line_items 由 plan rateCards 合成（slice 深化时补价格细节），此处给结构完整的骨架。
import { Customer, Plan, Subscription as SubscriptionModel, SUBSCRIPTION_STATUS } from '@/models';
import type { SubscriptionResponse } from '@/types/dto/Subscription';
import { INVOICE_CADENCE } from '@/models/Invoice';
import { BILLING_PERIOD } from '@/constants/constants';
import { cadenceToBillingPeriod, currentPeriodFromCadence, iso } from './common';
import type { OmCustomer } from './customer';

/**
 * OM 订阅形状：取 customer.get 内嵌的 Subscription schema（不含 phases 明细）。
 * subscriptions.get 的完整返回（含 phases）是其超集，可直接传入。
 */
export type OmSubscription = NonNullable<OmCustomer['subscriptions']>[number];

/** OM SubscriptionStatus → Flexprice SUBSCRIPTION_STATUS。 */
export function mapSubscriptionStatus(om: OmSubscription['status']): SUBSCRIPTION_STATUS {
	switch (om) {
		case 'active':
			return SUBSCRIPTION_STATUS.ACTIVE;
		case 'canceled':
		case 'inactive':
			// canceled/inactive 均为终态，Flexprice 最接近的是 cancelled
			return SUBSCRIPTION_STATUS.CANCELLED;
		case 'scheduled':
			return SUBSCRIPTION_STATUS.DRAFT;
	}
}

/** OM 订阅 → Plan 骨架（id/key/version + 订阅名兜底 name）。 */
export function synthPlanFromSubscription(om: OmSubscription): Plan {
	return {
		id: om.plan?.id ?? '',
		name: om.name ?? om.plan?.key ?? '',
		description: om.description ?? '',
		lookup_key: om.plan?.key ?? '',
		status: 'published',
		tenant_id: '',
		environment_id: '',
		created_by: '',
		updated_by: '',
		created_at: iso(om.createdAt),
		updated_at: iso(om.updatedAt),
		metadata: {},
	} as Plan;
}

export interface MapSubscriptionOptions {
	/** 订阅所属客户（有则填真实档案，无则骨架兜底）。 */
	customer?: Customer;
	/** 行项目来源（默认空数组；slice 深化时由 plan rateCards 合成）。 */
	lineItems?: SubscriptionModel['line_items'];
}

export function mapOmSubscription(om: OmSubscription, options: MapSubscriptionOptions = {}): SubscriptionResponse {
	const customer: Customer =
		options.customer ??
		({
			id: om.customerId,
			name: om.customerId,
			email: '',
			external_id: om.customerId,
			address_line1: '',
			address_line2: '',
			address_city: '',
			address_state: '',
			address_postal_code: '',
			address_country: '',
			metadata: {},
			status: 'published',
			tenant_id: '',
			environment_id: '',
			created_by: '',
			updated_by: '',
			created_at: iso(om.createdAt),
			updated_at: iso(om.updatedAt),
		} as Customer);
	const period = currentPeriodFromCadence(om.billingAnchor, om.billingCadence);
	const billingPeriod: BILLING_PERIOD = cadenceToBillingPeriod(om.billingCadence);

	return {
		id: om.id,
		lookup_key: om.id,
		customer_id: om.customerId,
		plan_id: om.plan?.id ?? '',
		environment_id: '',
		tenant_id: '',
		subscription_status: mapSubscriptionStatus(om.status),
		currency: om.currency ?? 'USD',
		billing_anchor: iso(om.billingAnchor),
		start_date: iso(om.activeFrom),
		end_date: iso(om.activeTo),
		current_period_start: period.start,
		current_period_end: period.end,
		cancelled_at: iso(om.deletedAt),
		cancel_at: '',
		cancel_at_period_end: false,
		trial_start: '',
		trial_end: '',
		billing_period: billingPeriod,
		billing_period_count: 1,
		invoice_cadence: INVOICE_CADENCE.ARREAR,
		version: om.plan?.version ?? 1,
		metadata: {},
		customer,
		billing_cycle: 'calendar',
		line_items: options.lineItems ?? [],
		plan: synthPlanFromSubscription(om),
		subscription_type: 'standalone',
		schedule: {
			id: om.id,
			subscription_id: om.id,
			status: 'published',
			current_phase_index: 0,
			end_behavior: '',
			start_date: iso(om.activeFrom),
			phases: [],
			metadata: {},
			tenant_id: '',
			environment_id: '',
			created_by: '',
			updated_by: '',
			created_at: iso(om.createdAt),
			updated_at: iso(om.updatedAt),
		},
		created_at: iso(om.createdAt),
		updated_at: iso(om.updatedAt),
		created_by: '',
		updated_by: '',
		status: 'published',
	} as SubscriptionResponse;
}
