// src/hooks/useOpenMeterInvoices.ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { config } from '@/config/config';
import { getOpenMeterClient, OpenMeterClient, requireOpenMeterClient } from '@/core/services/openmeter';

export type OpenMeterInvoicesFilter = NonNullable<Parameters<OpenMeterClient['billing']['invoices']['list']>[0]>;
export type OpenMeterInvoicesPage = NonNullable<Awaited<ReturnType<OpenMeterClient['billing']['invoices']['list']>>>;
export type OpenMeterInvoice = OpenMeterInvoicesPage['items'][number];
export type InvoiceVoidInput = NonNullable<Parameters<OpenMeterClient['billing']['invoices']['void']>[1]>;

export const openMeterInvoicesKeys = {
	root: ['openmeter', 'invoices'] as const,
	all: (filter: OpenMeterInvoicesFilter = {}) => ['openmeter', 'invoices', filter] as const,
	detail: (id: string) => ['openmeter', 'invoice', id] as const,
};

const EMPTY_PAGE: OpenMeterInvoicesPage = { items: [], totalCount: 0, page: 1, pageSize: 0 };

/** 列出发票（invoices）。禁用时返回空页。 */
export function useOpenMeterInvoices(filter: OpenMeterInvoicesFilter = {}) {
	return useQuery<OpenMeterInvoicesPage>({
		queryKey: openMeterInvoicesKeys.all(filter),
		queryFn: async () => {
			const client = getOpenMeterClient();
			if (!client) return EMPTY_PAGE;
			return (await client.billing.invoices.list(filter)) ?? EMPTY_PAGE;
		},
		enabled: config.openmeter.enabled,
	});
}

/** 按 ID 取单张发票；不存在映射为 null。 */
export function useOpenMeterInvoice(id: string) {
	return useQuery<OpenMeterInvoice | null>({
		queryKey: openMeterInvoicesKeys.detail(id),
		queryFn: async () => {
			const client = getOpenMeterClient();
			if (!client) return null;
			return (await client.billing.invoices.get(id)) ?? null;
		},
		enabled: config.openmeter.enabled && Boolean(id),
	});
}

/** 发票状态机动作：推进草稿 → 待审批 → 触发开票。 */
export function useAdvanceOpenMeterInvoice() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: async (id: string) => (await requireOpenMeterClient().billing.invoices.advance(id)) ?? null,
		onSuccess: (_data, id) => {
			void queryClient.invalidateQueries({ queryKey: openMeterInvoicesKeys.root });
			void queryClient.invalidateQueries({ queryKey: openMeterInvoicesKeys.detail(id) });
		},
	});
}

export function useApproveOpenMeterInvoice() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: async (id: string) => (await requireOpenMeterClient().billing.invoices.approve(id)) ?? null,
		onSuccess: (_data, id) => {
			void queryClient.invalidateQueries({ queryKey: openMeterInvoicesKeys.root });
			void queryClient.invalidateQueries({ queryKey: openMeterInvoicesKeys.detail(id) });
		},
	});
}

export function useRetryOpenMeterInvoice() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: async (id: string) => (await requireOpenMeterClient().billing.invoices.retry(id)) ?? null,
		onSuccess: (_data, id) => {
			void queryClient.invalidateQueries({ queryKey: openMeterInvoicesKeys.root });
			void queryClient.invalidateQueries({ queryKey: openMeterInvoicesKeys.detail(id) });
		},
	});
}

export function useVoidOpenMeterInvoice() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: async ({ id, body }: { id: string; body: InvoiceVoidInput }) =>
			(await requireOpenMeterClient().billing.invoices.void(id, body)) ?? null,
		onSuccess: (_data, { id }) => {
			void queryClient.invalidateQueries({ queryKey: openMeterInvoicesKeys.root });
			void queryClient.invalidateQueries({ queryKey: openMeterInvoicesKeys.detail(id) });
		},
	});
}
