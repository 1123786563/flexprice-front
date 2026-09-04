// src/hooks/useOpenMeterEntitlements.ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { config } from '@/config/config';
import { getOpenMeterClient, OpenMeterClient, requireOpenMeterClient } from '@/core/services/openmeter';

/** v2 授权列表（GET /api/v2/entitlements），查询参数放在 options.query。 */
type EntitlementsV2ListOptions = NonNullable<Parameters<OpenMeterClient['entitlements']['list']>[0]>;
export type OpenMeterEntitlementsV2Filter = EntitlementsV2ListOptions['query'];
export type OpenMeterEntitlementsV2Page = NonNullable<Awaited<ReturnType<OpenMeterClient['entitlements']['list']>>>;
export type OpenMeterEntitlementV2 = OpenMeterEntitlementsV2Page['items'][number];
export type OpenMeterEntitlementGrantsPage = NonNullable<Awaited<ReturnType<OpenMeterClient['entitlements']['grants']['list']>>>;
export type OpenMeterEntitlementValue = NonNullable<Awaited<ReturnType<OpenMeterClient['entitlementsV1']['value']>>>;

export const openMeterEntitlementsKeys = {
	root: ['openmeter', 'entitlements'] as const,
	all: (filter: OpenMeterEntitlementsV2Filter = undefined) => ['openmeter', 'entitlements', { filter }] as const,
	detail: (id: string) => ['openmeter', 'entitlement', id] as const,
	grants: ['openmeter', 'entitlements', 'grants'] as const,
	value: (subjectOrCustomer: string, featureKey: string) => ['openmeter', 'entitlement-value', subjectOrCustomer, featureKey] as const,
};

const EMPTY_PAGE: OpenMeterEntitlementsV2Page = { items: [], totalCount: 0, page: 1, pageSize: 0 };

/** 列出 v2 授权。禁用时返回空页。 */
export function useOpenMeterEntitlements(filter: OpenMeterEntitlementsV2Filter = undefined) {
	return useQuery<OpenMeterEntitlementsV2Page>({
		queryKey: openMeterEntitlementsKeys.all(filter),
		queryFn: async () => {
			const client = getOpenMeterClient();
			if (!client) return EMPTY_PAGE;
			return (await client.entitlements.list({ query: filter })) ?? EMPTY_PAGE;
		},
		enabled: config.openmeter.enabled,
	});
}

/** 按 ID 取单个 v2 授权；不存在映射为 null。 */
export function useOpenMeterEntitlement(id: string) {
	return useQuery<OpenMeterEntitlementV2 | null>({
		queryKey: openMeterEntitlementsKeys.detail(id),
		queryFn: async () => {
			const client = getOpenMeterClient();
			if (!client) return null;
			return (await client.entitlements.get(id)) ?? null;
		},
		enabled: config.openmeter.enabled && Boolean(id),
	});
}

/** 列出 v2 授权额度（grants）。 */
export function useOpenMeterEntitlementGrants(filter: OpenMeterEntitlementsV2Filter = undefined) {
	return useQuery<OpenMeterEntitlementGrantsPage>({
		queryKey: openMeterEntitlementsKeys.grants,
		queryFn: async () => {
			const client = getOpenMeterClient();
			if (!client) return { items: [], totalCount: 0, page: 1, pageSize: 0 };
			return (await client.entitlements.grants.list({ query: filter })) ?? { items: [], totalCount: 0, page: 1, pageSize: 0 };
		},
		enabled: config.openmeter.enabled,
	});
}

/**
 * 查询主体（v1 授权）在某 feature 上的可用额度值 —— 运行时"是否有权益/还剩多少"的判定入口。
 * v2 授权请用 `useOpenMeterCustomerEntitlementValue`。
 */
export function useOpenMeterSubjectEntitlementValue(subjectIdOrKey: string, entitlementIdOrFeatureKey: string) {
	return useQuery<OpenMeterEntitlementValue | null>({
		queryKey: openMeterEntitlementsKeys.value(subjectIdOrKey, entitlementIdOrFeatureKey),
		queryFn: async () => {
			const client = getOpenMeterClient();
			if (!client) return null;
			return (await client.entitlementsV1.value(subjectIdOrKey, entitlementIdOrFeatureKey)) ?? null;
		},
		enabled: config.openmeter.enabled && Boolean(subjectIdOrKey) && Boolean(entitlementIdOrFeatureKey),
	});
}

/** 作废一笔授权额度；成功后失效 grants 列表。 */
export function useVoidOpenMeterEntitlementGrant() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: async (grantId: string) => {
			await requireOpenMeterClient().entitlements.grants.void(grantId);
			return grantId;
		},
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: openMeterEntitlementsKeys.grants });
		},
	});
}

export type OpenMeterCustomerEntitlementValue = NonNullable<Awaited<ReturnType<OpenMeterClient['customers']['entitlements']['value']>>>;

/** 查询客户（v2 授权体系）在某 feature 上的可用额度值。 */
export function useOpenMeterCustomerEntitlementValue(customerIdOrKey: string, featureKey: string) {
	return useQuery<OpenMeterCustomerEntitlementValue | null>({
		queryKey: ['openmeter', 'customer-entitlement-value', customerIdOrKey, featureKey] as const,
		queryFn: async () => {
			const client = getOpenMeterClient();
			if (!client) return null;
			return (await client.customers.entitlements.value(customerIdOrKey, featureKey)) ?? null;
		},
		enabled: config.openmeter.enabled && Boolean(customerIdOrKey) && Boolean(featureKey),
	});
}
