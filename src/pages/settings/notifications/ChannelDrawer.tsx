import { FC, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import { Plus, Trash2 } from 'lucide-react';
import { Button, Input, Sheet } from '@/components/atoms';
import { Switch } from '@/components/ui';
import NotificationApi from '@/api/NotificationApi';
import type { OmNotificationChannel, OmNotificationChannelInput } from '@/api/NotificationApi';
import { refetchAllNotifications } from './useNotifications';

interface HeaderRow {
	key: string;
	value: string;
}

interface ChannelFormState {
	name: string;
	url: string;
	disabled: boolean;
	signingSecret: string;
	headerRows: HeaderRow[];
}

interface Props {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/** Present in edit mode; `null`/`undefined` means create. */
	channel?: OmNotificationChannel | null;
}

const EMPTY_FORM: ChannelFormState = { name: '', url: '', disabled: false, signingSecret: '', headerRows: [] };

function toFormState(channel: OmNotificationChannel | null | undefined): ChannelFormState {
	if (!channel) return { ...EMPTY_FORM };
	return {
		name: channel.name,
		url: channel.url,
		disabled: channel.disabled ?? false,
		signingSecret: channel.signingSecret ?? '',
		headerRows: Object.entries(channel.customHeaders ?? {}).map(([key, value]) => ({ key, value })),
	};
}

function toHeaderMap(rows: HeaderRow[]): Record<string, string> | undefined {
	const entries = rows.filter((row) => row.key.trim() !== '').map((row) => [row.key.trim(), row.value] as const);
	return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

/**
 * Builds the SDK write payload. The SDK types create/update as the full Channel (server-only
 * readonly fields, including a required `id`, included) while the wire schema only consumes the
 * create-request fields, so placeholders on create and carried-through values on update are
 * ignored by the backend.
 */
function buildChannelPayload(state: ChannelFormState, channel: OmNotificationChannel | undefined): OmNotificationChannelInput {
	const base = {
		id: channel?.id ?? '',
		type: 'WEBHOOK' as const,
		name: state.name.trim(),
		url: state.url.trim(),
		disabled: state.disabled,
		customHeaders: toHeaderMap(state.headerRows),
		signingSecret: state.signingSecret.trim() || undefined,
		createdAt: channel?.createdAt ?? new Date(),
		updatedAt: new Date(),
	};
	return channel ? { ...channel, ...base } : base;
}

const ChannelDrawer: FC<Props> = ({ open, onOpenChange, channel }) => {
	const { t } = useTranslation(['settings', 'common']);
	const isEdit = !!channel;
	// The section remounts this drawer (via `key`) on every open, so one-shot
	// lazy init from `channel` is enough — no reset effect needed.
	const [form, setForm] = useState<ChannelFormState>(() => toFormState(channel));

	const saveMutation = useMutation({
		mutationFn: (state: ChannelFormState) => {
			const payload = buildChannelPayload(state, channel ?? undefined);
			return isEdit ? NotificationApi.updateChannel(channel.id, payload) : NotificationApi.createChannel(payload);
		},
		onSuccess: () => {
			toast.success(t(isEdit ? 'notifications.channels.toast.updated' : 'notifications.channels.toast.created'));
			void refetchAllNotifications();
			onOpenChange(false);
		},
		onError: (error: Error) => toast.error(error.message || t('notifications.channels.toast.failed')),
	});

	const update = (patch: Partial<ChannelFormState>) => setForm((prev) => ({ ...prev, ...patch }));

	const handleSave = () => {
		if (!form.name.trim() || !form.url.trim() || !/^https?:\/\//i.test(form.url.trim())) return;
		saveMutation.mutate(form);
	};

	const urlInvalid = form.url.trim() !== '' && !/^https?:\/\//i.test(form.url.trim());
	const canSave = form.name.trim() !== '' && form.url.trim() !== '' && !urlInvalid && !saveMutation.isPending;

	return (
		<Sheet
			isOpen={open}
			onOpenChange={onOpenChange}
			size='md'
			title={isEdit ? t('notifications.channels.drawer.editTitle') : t('notifications.channels.drawer.createTitle')}
			description={t('notifications.channels.drawer.description')}>
			<div className='mt-4 space-y-5'>
				<Input
					label={t('notifications.channels.drawer.name')}
					placeholder={t('notifications.channels.drawer.namePlaceholder')}
					value={form.name}
					onChange={(value) => update({ name: value })}
				/>
				<Input
					label={t('notifications.channels.drawer.url')}
					placeholder={t('notifications.channels.drawer.urlPlaceholder')}
					value={form.url}
					error={urlInvalid ? t('notifications.channels.drawer.urlInvalid') : undefined}
					onChange={(value) => update({ url: value })}
				/>

				<div className='space-y-2'>
					<div className='flex items-center justify-between'>
						<span className='text-sm font-medium text-content-zinc'>{t('notifications.channels.drawer.customHeaders')}</span>
						<Button
							type='button'
							variant='outline'
							size='xs'
							prefixIcon={<Plus className='size-3' />}
							onClick={() => update({ headerRows: [...form.headerRows, { key: '', value: '' }] })}>
							{t('notifications.channels.drawer.addHeader')}
						</Button>
					</div>
					{form.headerRows.map((row, index) => (
						<div key={index} className='flex items-center gap-2'>
							<div className='flex-1'>
								<Input
									value={row.key}
									placeholder={t('notifications.channels.drawer.headerKeyPlaceholder')}
									onChange={(value) => update({ headerRows: form.headerRows.map((r, i) => (i === index ? { ...r, key: value } : r)) })}
								/>
							</div>
							<div className='flex-1'>
								<Input
									value={row.value}
									placeholder={t('notifications.channels.drawer.headerValuePlaceholder')}
									onChange={(value) => update({ headerRows: form.headerRows.map((r, i) => (i === index ? { ...r, value } : r)) })}
								/>
							</div>
							<Button
								type='button'
								variant='ghost'
								size='icon'
								aria-label={t('common:actions.delete')}
								onClick={() => update({ headerRows: form.headerRows.filter((_, i) => i !== index) })}>
								<Trash2 className='size-4' />
							</Button>
						</div>
					))}
				</div>

				<Input
					label={t('notifications.channels.drawer.signingSecret')}
					placeholder={t('notifications.channels.drawer.signingSecretPlaceholder')}
					value={form.signingSecret}
					description={t('notifications.channels.drawer.signingSecretDescription')}
					onChange={(value) => update({ signingSecret: value })}
				/>

				<div className='flex items-center justify-between rounded-lg border border-line p-3'>
					<div>
						<p className='text-sm font-medium text-content-zinc'>{t('notifications.channels.drawer.enabled')}</p>
						<p className='text-xs text-content-slate-muted'>{t('notifications.channels.drawer.enabledDescription')}</p>
					</div>
					<Switch
						checked={!form.disabled}
						onCheckedChange={(enabled) => update({ disabled: !enabled })}
						aria-label={t('notifications.channels.drawer.enabled')}
					/>
				</div>

				<div className='flex justify-end gap-2'>
					<Button type='button' variant='outline' onClick={() => onOpenChange(false)}>
						{t('common:actions.cancel')}
					</Button>
					<Button type='button' disabled={!canSave} isLoading={saveMutation.isPending} onClick={handleSave}>
						{isEdit ? t('common:actions.save') : t('common:actions.create')}
					</Button>
				</div>
			</div>
		</Sheet>
	);
};

export default ChannelDrawer;
