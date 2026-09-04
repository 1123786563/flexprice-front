// src/hooks/useOpenMeterCustomers.ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { config } from '@/config/config';
import { getOpenMeterClient, OpenMeterClient, requireOpenMeterClient } from '@/core/services/openmeter';

export type OpenMeterCustomersFilter = NonNullable<Parameters<OpenMeterClient['customers']['list']>[0]>;
export type OpenMeterCustomersPage = NonNullable<Awaited<ReturnType<OpenMeterClient['customers']['list']>>>;
export type OpenMeterCustomer = OpenMeterCustomersPage['items'][number];
export type OpenMeterCustomerAccess = NonNullable<Awaited<ReturnType<OpenMeterClient['customers']['getAccess']>>>;
export type CustomerCreateInput = Parameters<OpenMeterClient['customers']['create']>[0];
export type CustomerUpdateInput = NonNullable<Parameters<OpenMeterClient['customers']['update']>[1]>;

export const openMeterCustomersKeys = {
	root: ['openmeter', 'customers'] as const,
	all: (filter: OpenMeterCustomersFilter = {}) => ['openmeter', 'customers', filter] as const,
	detail: (idOrKey: string) => ['openmeter', 'customer', idOrKey] as const,
	access: (idOrKey: string) => ['openmeter', 'customer', idOrKey, 'access'] as const,
};

const EMPTY_PAGE: OpenMeterCustomersPage = { items: [], totalCount: 0, page: 1, pageSize: 0 };

/** 列出计费客户（customers）。禁用时返回空页。 */
export function useOpenMeterCustomers(filter: OpenMeterCustomersFilter = {}) {
	return useQuery<OpenMeterCustomersPage>({
		queryKey: openMeterCustomersKeys.all(filter),
		queryFn: async () => {
			const client = getOpenMeterClient();
			if (!client) return EMPTY_PAGE;
			return (await client.customers.list(filter)) ?? EMPTY_PAGE;
		},
		enabled: config.openmeter.enabled,
	});
}

/** 按 ID 或 key 取单个客户；不存在映射为 null。 */
export function useOpenMeterCustomer(idOrKey: string) {
	return useQuery<OpenMeterCustomer | null>({
		queryKey: openMeterCustomersKeys.detail(idOrKey),
		queryFn: async () => {
			const client = getOpenMeterClient();
			if (!client) return null;
			return (await client.customers.get(idOrKey)) ?? null;
		},
		enabled: config.openmeter.enabled && Boolean(idOrKey),
	});
}

/** 客户门户访问信息（当前有效订阅、授权摘要等）。 */
export function useOpenMeterCustomerAccess(idOrKey: string) {
	return useQuery<OpenMeterCustomerAccess | null>({
		queryKey: openMeterCustomersKeys.access(idOrKey),
		queryFn: async () => {
			const client = getOpenMeterClient();
			if (!client) return null;
			return (await client.customers.getAccess(idOrKey)) ?? null;
		},
		enabled: config.openmeter.enabled && Boolean(idOrKey),
	});
}

export function useCreateOpenMeterCustomer() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: async (customer: CustomerCreateInput) => (await requireOpenMeterClient().customers.create(customer)) ?? null,
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: openMeterCustomersKeys.root });
		},
	});
}

export function useUpdateOpenMeterCustomer() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: async ({ idOrKey, customer }: { idOrKey: string; customer: CustomerUpdateInput }) =>
			(await requireOpenMeterClient().customers.update(idOrKey, customer)) ?? null,
		onSuccess: (_data, { idOrKey }) => {
			void queryClient.invalidateQueries({ queryKey: openMeterCustomersKeys.root });
			void queryClient.invalidateQueries({ queryKey: openMeterCustomersKeys.detail(idOrKey) });
		},
	});
}

export function useDeleteOpenMeterCustomer() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: async (idOrKey: string) => {
			await requireOpenMeterClient().customers.delete(idOrKey);
			return idOrKey;
		},
		onSuccess: (_data, idOrKey) => {
			void queryClient.invalidateQueries({ queryKey: openMeterCustomersKeys.root });
			void queryClient.invalidateQueries({ queryKey: openMeterCustomersKeys.detail(idOrKey) });
		},
	});
}
