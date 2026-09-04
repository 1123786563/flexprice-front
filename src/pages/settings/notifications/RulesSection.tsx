import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import { Pencil, Trash2 } from 'lucide-react';
import { Button, Card, Loader, NoDataCard } from '@/components/atoms';
import { SettingsCardHeader } from '@/components/molecules';
import FlexpriceTable, { type ColumnData } from '@/components/molecules/Table';
import NotificationApi from '@/api/NotificationApi';
import type { OmNotificationRule } from '@/api/NotificationApi';
import RuleDrawer from './RuleDrawer';
import { refetchAllNotifications, useNotificationChannels, useNotificationRules } from './useNotifications';
import { ruleTypeLabelKey } from './labels';

const RulesSection = () => {
	const { t } = useTranslation(['settings', 'common']);
	const { rules, isLoading } = useNotificationRules();
	const { channels } = useNotificationChannels();
	const [drawerOpen, setDrawerOpen] = useState(false);
	const [editingRule, setEditingRule] = useState<OmNotificationRule | null>(null);

	const deleteMutation = useMutation({
		mutationFn: (id: string) => NotificationApi.deleteRule(id),
		onSuccess: () => {
			toast.success(t('notifications.rules.toast.deleted'));
			void refetchAllNotifications();
		},
		onError: (error: Error) => toast.error(error.message || t('notifications.rules.toast.deleteFailed')),
	});

	const openCreate = () => {
		setEditingRule(null);
		setDrawerOpen(true);
	};

	const openEdit = (rule: OmNotificationRule) => {
		setEditingRule(rule);
		setDrawerOpen(true);
	};

	const handleDelete = (rule: OmNotificationRule) => {
		if (!window.confirm(t('notifications.rules.deleteConfirm', { name: rule.name }))) return;
		deleteMutation.mutate(rule.id);
	};

	// OM rule responses only carry channel ids (NotificationChannelMeta), so resolve
	// display names against the channels collection and fall back to a short id.
	const channelNameById = new Map(channels.map((channel) => [channel.id, channel.name]));

	const columns: ColumnData<OmNotificationRule>[] = [
		{ fieldName: 'name', title: t('notifications.rules.table.name'), fieldVariant: 'title' },
		{
			title: t('notifications.rules.table.type'),
			render: (row) => t(ruleTypeLabelKey(row.type)),
		},
		{
			title: t('notifications.rules.table.channels'),
			flex: 2,
			render: (row) => {
				const names = row.channels.map((channel) => channelNameById.get(channel.id) ?? `…${channel.id.slice(-6)}`);
				return (
					<span className='block truncate text-xs text-content-slate-muted' title={names.join(', ')}>
						{names.join(', ')}
					</span>
				);
			},
		},
		{
			title: t('notifications.rules.table.status'),
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
					title={t('notifications.rules.title')}
					infoDescription={t('notifications.rules.description')}
					titleClassName='text-lg font-medium text-content-zinc-strong'
					className='mb-2'
					cta={
						<Button size='sm' onClick={openCreate}>
							{t('notifications.rules.create')}
						</Button>
					}
				/>
			</div>
			{isLoading ? (
				<div className='flex min-h-[160px] items-center justify-center'>
					<Loader />
				</div>
			) : rules.length === 0 ? (
				<div className='px-6 pb-6'>
					<NoDataCard
						title={t('notifications.rules.empty.title')}
						subtitle={t('notifications.rules.empty.subtitle')}
						cta={
							<Button size='sm' onClick={openCreate}>
								{t('notifications.rules.create')}
							</Button>
						}
					/>
				</div>
			) : (
				<div className='px-6 pb-6'>
					<FlexpriceTable columns={columns} data={rules} />
				</div>
			)}
			{/* Remount per open so the drawer's form state re-initializes from `editingRule`. */}
			<RuleDrawer
				key={drawerOpen ? `open-${editingRule?.id ?? 'create'}` : 'closed'}
				open={drawerOpen}
				onOpenChange={setDrawerOpen}
				rule={editingRule}
			/>
		</Card>
	);
};

export default RulesSection;
