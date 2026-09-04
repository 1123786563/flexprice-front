import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import { RotateCcw } from 'lucide-react';
import { Button, Card, Loader, NoDataCard } from '@/components/atoms';
import { SettingsCardHeader } from '@/components/molecules';
import FlexpriceTable, { type ColumnData } from '@/components/molecules/Table';
import NotificationApi from '@/api/NotificationApi';
import type { OmNotificationEvent } from '@/api/NotificationApi';
import { formatDateTimeWithSecondsAndTimezone } from '@/utils/common/format_date';
import { refetchAllNotifications, useNotificationEvents } from './useNotifications';
import { eventTypeLabelKey } from './labels';

const EventsSection = () => {
	const { t } = useTranslation(['settings', 'common']);
	const { events, isLoading } = useNotificationEvents();

	const resendMutation = useMutation({
		mutationFn: (id: string) => NotificationApi.resendEvent(id),
		onSuccess: () => {
			toast.success(t('notifications.events.toast.resent'));
			void refetchAllNotifications();
		},
		onError: (error: Error) => toast.error(error.message || t('notifications.events.toast.resendFailed')),
	});

	const columns: ColumnData<OmNotificationEvent>[] = [
		{
			title: t('notifications.events.table.id'),
			render: (row) => (
				<span className='block max-w-[220px] truncate font-mono text-xs text-content-slate-muted' title={row.id}>
					{row.id}
				</span>
			),
		},
		{ title: t('notifications.events.table.type'), render: (row) => t(eventTypeLabelKey(row)) },
		{
			title: t('notifications.events.table.rule'),
			flex: 2,
			render: (row) => <span className='text-xs text-content-slate-muted'>{row.rule.name}</span>,
		},
		{
			title: t('notifications.events.table.status'),
			render: (row) => {
				const states = [...new Set(row.deliveryStatus.map((status) => status.state))];
				return (
					<span className='text-xs text-content-slate-muted'>
						{states.map((state) => t(`notifications.events.states.${state}`)).join(', ')}
					</span>
				);
			},
		},
		{
			title: t('notifications.events.table.createdAt'),
			render: (row) => (
				<span className='whitespace-nowrap text-xs text-content-slate-muted'>{formatDateTimeWithSecondsAndTimezone(row.createdAt)}</span>
			),
		},
		{
			title: '',
			align: 'right',
			render: (row) => (
				<Button
					type='button'
					variant='outline'
					size='xs'
					prefixIcon={<RotateCcw className='size-3' />}
					disabled={resendMutation.isPending && resendMutation.variables === row.id}
					onClick={() => resendMutation.mutate(row.id)}>
					{t('notifications.events.resend')}
				</Button>
			),
		},
	];

	return (
		<Card variant='default' noPadding className='rounded-xl border-line bg-surface shadow-sm'>
			<div className='px-6 pt-6'>
				<SettingsCardHeader
					title={t('notifications.events.title')}
					infoDescription={t('notifications.events.description')}
					titleClassName='text-lg font-medium text-content-zinc-strong'
					className='mb-2'
				/>
			</div>
			{isLoading ? (
				<div className='flex min-h-[160px] items-center justify-center'>
					<Loader />
				</div>
			) : events.length === 0 ? (
				<div className='px-6 pb-6'>
					<NoDataCard title={t('notifications.events.empty.title')} subtitle={t('notifications.events.empty.subtitle')} />
				</div>
			) : (
				<div className='px-6 pb-6'>
					<FlexpriceTable columns={columns} data={events} />
				</div>
			)}
		</Card>
	);
};

export default EventsSection;
