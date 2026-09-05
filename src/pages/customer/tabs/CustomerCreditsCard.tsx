import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import { Button, Card, CardHeader, Loader, NoDataCard, Spacer } from '@/components/atoms';
import FlexpriceTable from '@/components/molecules/Table';
import type { ColumnData } from '@/components/molecules/Table';
import { getCurrencySymbol } from '@/utils/common/helper_functions';
import { formatDateTime } from '@/utils/common/format_date';
import CustomerCreditApi from '@/api/CustomerCreditApi';
import type { CustomerCreditBalance, CustomerCreditGrant, CustomerCreditTransaction } from '@/api/CustomerCreditApi';
import { useState } from 'react';

const fundingMethodLabelKey: Record<string, string> = {
	none: 'tabPanels.credits.funding.none',
	invoice: 'tabPanels.credits.funding.invoice',
	external: 'tabPanels.credits.funding.external',
};

/**
 * 客户 OpenMeter Credits（v3 账本）卡片：余额（settled/live/pending）、发放记录、
 * 流水。与 Flexprice 钱包独立——credits 是后端账本支持的货币化余额，无需本地钱包记录。
 */
const CustomerCreditsCard = ({ customerId }: { customerId: string }) => {
	const { t } = useTranslation('customers');
	const queryClient = useQueryClient();
	const [cursor, setCursor] = useState<string | undefined>(undefined);

	const { data: balanceData, isLoading: isBalanceLoading } = useQuery({
		queryKey: ['customerCreditBalances', customerId],
		queryFn: () => CustomerCreditApi.getBalancesForDisplay(customerId),
		enabled: !!customerId,
	});

	const { data: grants, isLoading: isGrantsLoading } = useQuery({
		queryKey: ['customerCreditGrants', customerId],
		queryFn: () => CustomerCreditApi.listGrants(customerId, { limit: 20 }),
		enabled: !!customerId,
	});

	const {
		data: transactions,
		isLoading: isTransactionsLoading,
		refetch: refetchTransactions,
	} = useQuery({
		queryKey: ['customerCreditTransactions', customerId, cursor],
		queryFn: () => CustomerCreditApi.listTransactions(customerId, { limit: 10, cursor }),
		enabled: !!customerId,
	});

	const voidMutation = useMutation({
		mutationFn: (grantId: string) => CustomerCreditApi.voidGrant(customerId, grantId),
		onSuccess: async () => {
			toast.success(t('tabPanels.credits.toast.grantVoided'));
			await queryClient.invalidateQueries({ queryKey: ['customerCreditGrants', customerId] });
			await queryClient.invalidateQueries({ queryKey: ['customerCreditBalances', customerId] });
			await refetchTransactions();
		},
		onError: (error: Error) => toast.error(error.message || t('tabPanels.credits.toast.grantVoidFailed')),
	});

	if (isBalanceLoading || isGrantsLoading || isTransactionsLoading) {
		return (
			<Card variant='notched'>
				<CardHeader title={t('tabPanels.credits.title')} />
				<div className='flex justify-center py-8'>
					<Loader />
				</div>
			</Card>
		);
	}

	const balances: CustomerCreditBalance[] = balanceData?.balances ?? [];
	const grantColumns: ColumnData<CustomerCreditGrant>[] = [
		{ title: t('tabPanels.credits.grants.name'), render: (row) => <span>{row.name}</span> },
		{
			title: t('tabPanels.credits.grants.amount'),
			render: (row) => (
				<span>
					{getCurrencySymbol(row.currency)}
					{row.amount}
				</span>
			),
		},
		{ title: t('tabPanels.credits.grants.funding'), render: (row) => t(fundingMethodLabelKey[row.funding_method] ?? row.funding_method) },
		{
			title: t('tabPanels.credits.grants.status'),
			render: (row) =>
				row.deleted_at ? (
					<span className='text-xs text-content-muted'>{t('tabPanels.credits.grants.voided')}</span>
				) : (
					<span className='text-xs text-success'>{t('tabPanels.credits.grants.active')}</span>
				),
		},
		{
			title: '',
			align: 'right',
			render: (row) =>
				row.deleted_at ? null : (
					<Button
						variant='outline'
						size='sm'
						disabled={voidMutation.isPending}
						onClick={() => {
							if (window.confirm(t('tabPanels.credits.grants.voidConfirm', { name: row.name }))) voidMutation.mutate(row.id);
						}}>
						{t('tabPanels.credits.grants.void')}
					</Button>
				),
		},
	];

	const transactionColumns: ColumnData<CustomerCreditTransaction>[] = [
		{ title: t('tabPanels.credits.transactions.name'), render: (row) => <span>{row.name}</span> },
		{ title: t('tabPanels.credits.transactions.type'), render: (row) => <span>{row.type}</span> },
		{
			title: t('tabPanels.credits.transactions.amount'),
			render: (row) => (
				<span>
					{getCurrencySymbol(row.currency)}
					{row.amount}
				</span>
			),
		},
		{
			title: t('tabPanels.credits.transactions.bookedAt'),
			render: (row) => <span>{row.booked_at ? formatDateTime(row.booked_at) : t('common:labels.na')}</span>,
		},
	];

	return (
		<Card variant='notched'>
			<CardHeader title={t('tabPanels.credits.title')} />
			<p className='px-5 pb-1 text-xs text-content-muted'>{t('tabPanels.credits.description')}</p>
			<div className='px-5 pb-5'>
				{balances.length === 0 ? (
					<p className='py-4 text-sm text-content-muted'>{t('tabPanels.credits.noBalance')}</p>
				) : (
					<div className='grid grid-cols-1 gap-4 py-4 sm:grid-cols-2 lg:grid-cols-3'>
						{balances.map((balance) => (
							<div key={balance.currency} className='rounded-lg border border-line p-4'>
								<p className='text-xs font-medium text-content-muted'>{balance.currency}</p>
								<p className='mt-1 text-3xl font-medium text-content'>
									{getCurrencySymbol(balance.currency)}
									{balance.settled}
								</p>
								<p className='mt-1 text-xs text-content-muted'>
									{t('tabPanels.credits.liveLabel')}: {balance.live} · {t('tabPanels.credits.pendingLabel')}: {balance.pending}
								</p>
							</div>
						))}
					</div>
				)}

				<Spacer className='!h-2' />

				{(grants?.items.length ?? 0) > 0 && (
					<>
						<p className='mb-2 text-sm font-medium text-content-strong'>{t('tabPanels.credits.grants.title')}</p>
						<FlexpriceTable columns={grantColumns} data={grants?.items ?? []} variant='no-bordered' showEmptyRow={false} />
						<Spacer className='!h-4' />
					</>
				)}

				{(transactions?.items.length ?? 0) > 0 ? (
					<>
						<p className='mb-2 text-sm font-medium text-content-strong'>{t('tabPanels.credits.transactions.title')}</p>
						<FlexpriceTable columns={transactionColumns} data={transactions?.items ?? []} variant='no-bordered' showEmptyRow={false} />
						{transactions?.nextCursor && (
							<div className='mt-2 flex justify-end'>
								<Button variant='outline' size='sm' onClick={() => setCursor(transactions.nextCursor ?? undefined)}>
									{t('tabPanels.credits.transactions.loadMore')}
								</Button>
							</div>
						)}
					</>
				) : (
					<NoDataCard title={t('tabPanels.credits.transactions.emptyTitle')} subtitle={t('tabPanels.credits.transactions.emptySubtitle')} />
				)}
			</div>
		</Card>
	);
};

export default CustomerCreditsCard;
