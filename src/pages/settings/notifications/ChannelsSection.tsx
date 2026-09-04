import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import { Pencil, Trash2 } from 'lucide-react';
import { Button, Card, Loader, NoDataCard } from '@/components/atoms';
import { SettingsCardHeader } from '@/components/molecules';
import FlexpriceTable, { type ColumnData } from '@/components/molecules/Table';
import NotificationApi from '@/api/NotificationApi';
import type { OmNotificationChannel } from '@/api/NotificationApi';
import ChannelDrawer from './ChannelDrawer';
import { refetchAllNotifications, useNotificationChannels } from './useNotifications';

const ChannelsSection = () => {
	const { t } = useTranslation(['settings', 'common']);
	const { channels, isLoading } = useNotificationChannels();
	const [drawerOpen, setDrawerOpen] = useState(false);
	const [editingChannel, setEditingChannel] = useState<OmNotificationChannel | null>(null);

	const deleteMutation = useMutation({
		mutationFn: (id: string) => NotificationApi.deleteChannel(id),
		onSuccess: () => {
			toast.success(t('notifications.channels.toast.deleted'));
			void refetchAllNotifications();
		},
		onError: (error: Error) => toast.error(error.message || t('notifications.channels.toast.deleteFailed')),
	});

	const openCreate = () => {
		setEditingChannel(null);
		setDrawerOpen(true);
	};

	const openEdit = (channel: OmNotificationChannel) => {
		setEditingChannel(channel);
		setDrawerOpen(true);
	};

	const handleDelete = (channel: OmNotificationChannel) => {
		if (!window.confirm(t('notifications.channels.deleteConfirm', { name: channel.name }))) return;
		deleteMutation.mutate(channel.id);
	};

	const columns: ColumnData<OmNotificationChannel>[] = [
		{ fieldName: 'name', title: t('notifications.channels.table.name'), fieldVariant: 'title' },
		{ fieldName: 'type', title: t('notifications.channels.table.type') },
		{
			title: t('notifications.channels.table.url'),
			flex: 2,
			render: (row) => (
				<span className='block truncate font-mono text-xs text-content-slate-muted' title={row.url}>
					{row.url}
				</span>
			),
		},
		{
			title: t('notifications.channels.table.status'),
			render: (row) =>
				row.disabled ? (
					<span className='text-xs text-content-slate-muted'>{t('notifications.status.disabled')}</span>
				) : (
					<span className='text-xs text-success'>{t('notifications.status.enabled')}</span>
				),
		},
		{
			title: '',
			align: 'right',
			render: (row) => (
				<div className='flex justify-end gap-1'>
					<Button type='button' variant='ghost' size='icon' aria-label={t('common:actions.edit')} onClick={() => openEdit(row)}>
						<Pencil className='size-4' />
					</Button>
					<Button
						type='button'
						variant='ghost'
						size='icon'
						aria-label={t('common:actions.delete')}
						disabled={deleteMutation.isPending}
						onClick={() => handleDelete(row)}>
						<Trash2 className='size-4' />
					</Button>
				</div>
			),
		},
	];

	return (
		<Card variant='default' noPadding className='rounded-xl border-line bg-surface shadow-sm'>
			<div className='px-6 pt-6'>
				<SettingsCardHeader
					title={t('notifications.channels.title')}
					infoDescription={t('notifications.channels.description')}
					titleClassName='text-lg font-medium text-content-zinc-strong'
					className='mb-2'
					cta={
						<Button size='sm' onClick={openCreate}>
							{t('notifications.channels.create')}
						</Button>
					}
				/>
			</div>
			{isLoading ? (
				<div className='flex min-h-[160px] items-center justify-center'>
					<Loader />
				</div>
			) : channels.length === 0 ? (
				<div className='px-6 pb-6'>
					<NoDataCard
						title={t('notifications.channels.empty.title')}
						subtitle={t('notifications.channels.empty.subtitle')}
						cta={
							<Button size='sm' onClick={openCreate}>
								{t('notifications.channels.create')}
							</Button>
						}
					/>
				</div>
			) : (
				<div className='px-6 pb-6'>
					<FlexpriceTable columns={columns} data={channels} />
				</div>
			)}
			{/* Remount per open so the drawer's form state re-initializes from `editingChannel`. */}
			<ChannelDrawer
				key={drawerOpen ? `open-${editingChannel?.id ?? 'create'}` : 'closed'}
				open={drawerOpen}
				onOpenChange={setDrawerOpen}
				channel={editingChannel}
			/>
		</Card>
	);
};

export default ChannelsSection;
