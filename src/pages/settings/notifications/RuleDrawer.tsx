import { FC, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import { Plus, Trash2 } from 'lucide-react';
import { Button, Input, Select, Sheet, type SelectOption } from '@/components/atoms';
import MultiSelect from '@/components/atoms/MultiSelect';
import FeatureMultiSelect from '@/components/atoms/FeatureMultiSelect/FeatureMultiSelect';
import { Switch } from '@/components/ui';
import NotificationApi from '@/api/NotificationApi';
import type { OmNotificationRule, OmNotificationRuleInput, OmRuleThresholdType, OmRuleType } from '@/api/NotificationApi';
import { refetchAllNotifications, useNotificationChannels } from './useNotifications';

interface ThresholdRow {
	value: string;
	type: OmRuleThresholdType;
}

interface RuleFormState {
	type: OmRuleType;
	name: string;
	disabled: boolean;
	channelIds: string[];
	thresholds: ThresholdRow[];
	featureIds: string[];
}

interface Props {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/** Present in edit mode; `null`/`undefined` means create. */
	rule?: OmNotificationRule | null;
}

const RULE_TYPE_OPTIONS: { value: OmRuleType; labelKey: string }[] = [
	{ value: 'entitlements.balance.threshold', labelKey: 'notifications.types.balanceThreshold' },
	{ value: 'entitlements.reset', labelKey: 'notifications.types.entitlementsReset' },
	{ value: 'invoice.created', labelKey: 'notifications.types.invoiceCreated' },
	{ value: 'invoice.updated', labelKey: 'notifications.types.invoiceUpdated' },
];

const BASE_THRESHOLD_TYPES: OmRuleThresholdType[] = ['usage_percentage', 'usage_value', 'balance_value'];

const THRESHOLD_TYPE_LABEL_KEYS: Partial<Record<OmRuleThresholdType, string>> = {
	usage_percentage: 'notifications.rules.thresholdTypes.usagePercentage',
	usage_value: 'notifications.rules.thresholdTypes.usageValue',
	balance_value: 'notifications.rules.thresholdTypes.balanceValue',
};

const EMPTY_FORM: RuleFormState = {
	type: 'invoice.created',
	name: '',
	disabled: false,
	channelIds: [],
	thresholds: [{ value: '', type: 'usage_percentage' }],
	featureIds: [],
};

function isEntitlementsRuleType(type: OmRuleType): boolean {
	return type === 'entitlements.balance.threshold' || type === 'entitlements.reset';
}

function toFormState(rule: OmNotificationRule | null | undefined): RuleFormState {
	if (!rule) return { ...EMPTY_FORM, thresholds: [{ value: '', type: 'usage_percentage' }] };
	const thresholds =
		rule.type === 'entitlements.balance.threshold'
			? rule.thresholds.map((threshold) => ({ value: String(threshold.value), type: threshold.type }))
			: [{ value: '', type: 'usage_percentage' as const }];
	const featureIds =
		rule.type === 'entitlements.balance.threshold' || rule.type === 'entitlements.reset'
			? (rule.features ?? []).map((feature) => feature.id)
			: [];
	return {
		type: rule.type,
		name: rule.name,
		disabled: rule.disabled ?? false,
		channelIds: rule.channels.map((channel) => channel.id),
		thresholds,
		featureIds,
	};
}

/** Discriminated-union payload per rule type; invoice rules carry no per-type extras. */
function buildRuleInput(state: RuleFormState): OmNotificationRuleInput {
	const base = { name: state.name.trim(), disabled: state.disabled };
	switch (state.type) {
		case 'entitlements.balance.threshold':
			return {
				type: state.type,
				...base,
				channels: state.channelIds,
				thresholds: state.thresholds.filter((row) => row.value.trim() !== '').map((row) => ({ value: Number(row.value), type: row.type })),
				features: state.featureIds.length > 0 ? state.featureIds : undefined,
			};
		case 'entitlements.reset':
			return {
				type: state.type,
				...base,
				channels: state.channelIds,
				features: state.featureIds.length > 0 ? state.featureIds : undefined,
			};
		case 'invoice.created':
			return { type: state.type, ...base, channels: state.channelIds };
		case 'invoice.updated':
			return { type: state.type, ...base, channels: state.channelIds };
	}
}

const RuleDrawer: FC<Props> = ({ open, onOpenChange, rule }) => {
	const { t } = useTranslation(['settings', 'common']);
	const isEdit = !!rule;
	// The section remounts this drawer (via `key`) on every open, so one-shot
	// lazy init from `rule` is enough — no reset effect needed.
	const [form, setForm] = useState<RuleFormState>(() => toFormState(rule));
	const { channels } = useNotificationChannels();

	const saveMutation = useMutation({
		mutationFn: (state: RuleFormState) => {
			const payload = buildRuleInput(state);
			return isEdit ? NotificationApi.updateRule(rule.id, payload) : NotificationApi.createRule(payload);
		},
		onSuccess: () => {
			toast.success(t(isEdit ? 'notifications.rules.toast.updated' : 'notifications.rules.toast.created'));
			void refetchAllNotifications();
			onOpenChange(false);
		},
		onError: (error: Error) => toast.error(error.message || t('notifications.rules.toast.failed')),
	});

	const update = (patch: Partial<RuleFormState>) => setForm((prev) => ({ ...prev, ...patch }));

	const thresholdTypeOptions = (existing: ThresholdRow[]): SelectOption[] => {
		const extraTypes = existing.map((row) => row.type).filter((type) => !BASE_THRESHOLD_TYPES.includes(type));
		return [...BASE_THRESHOLD_TYPES, ...extraTypes].map((type) => {
			const labelKey = THRESHOLD_TYPE_LABEL_KEYS[type];
			return { value: type, label: labelKey ? t(labelKey) : type };
		});
	};

	const validThresholds = form.thresholds.filter((row) => row.value.trim() !== '' && !Number.isNaN(Number(row.value)));
	const canSave =
		form.name.trim() !== '' &&
		form.channelIds.length > 0 &&
		!saveMutation.isPending &&
		(form.type !== 'entitlements.balance.threshold' || validThresholds.length > 0);

	const handleSave = () => {
		if (!canSave) return;
		saveMutation.mutate(form);
	};

	const typeOptions: SelectOption[] = RULE_TYPE_OPTIONS.map(({ value, labelKey }) => ({ value, label: t(labelKey) }));
	const channelOptions = channels.map((channel) => ({ value: channel.id, label: channel.name }));
	const showThresholds = form.type === 'entitlements.balance.threshold';
	const showFeatures = isEntitlementsRuleType(form.type);

	return (
		<Sheet
			isOpen={open}
			onOpenChange={onOpenChange}
			size='lg'
			title={isEdit ? t('notifications.rules.drawer.editTitle') : t('notifications.rules.drawer.createTitle')}
			description={t('notifications.rules.drawer.description')}>
			<div className='mt-4 space-y-5'>
				<Select
					label={t('notifications.rules.drawer.type')}
					options={typeOptions}
					value={form.type}
					disabled={isEdit}
					onChange={(value) => update({ type: value as OmRuleType })}
				/>
				<Input
					label={t('notifications.rules.drawer.name')}
					placeholder={t('notifications.rules.drawer.namePlaceholder')}
					value={form.name}
					onChange={(value) => update({ name: value })}
				/>

				<div>
					<p className='mb-1 text-sm font-medium text-content-zinc'>{t('notifications.rules.drawer.channels')}</p>
					<MultiSelect
						options={channelOptions}
						defaultValue={form.channelIds}
						onValueChange={(values) => update({ channelIds: values })}
						placeholder={t('notifications.rules.drawer.channelsPlaceholder')}
					/>
					<p className='mt-1 text-xs text-content-slate-muted'>{t('notifications.rules.drawer.channelsDescription')}</p>
				</div>

				{showThresholds && (
					<div className='space-y-2'>
						<div className='flex items-center justify-between'>
							<span className='text-sm font-medium text-content-zinc'>{t('notifications.rules.drawer.thresholds')}</span>
							<Button
								type='button'
								variant='outline'
								size='xs'
								prefixIcon={<Plus className='size-3' />}
								onClick={() => update({ thresholds: [...form.thresholds, { value: '', type: 'usage_percentage' }] })}>
								{t('notifications.rules.drawer.addThreshold')}
							</Button>
						</div>
						{form.thresholds.map((row, index) => (
							<div key={index} className='flex items-center gap-2'>
								<div className='w-40'>
									<Input
										type='number'
										value={row.value}
										placeholder={t('notifications.rules.drawer.thresholdValuePlaceholder')}
										onChange={(value) => update({ thresholds: form.thresholds.map((r, i) => (i === index ? { ...r, value } : r)) })}
									/>
								</div>
								<div className='flex-1'>
									<Select
										options={thresholdTypeOptions(form.thresholds)}
										value={row.type}
										onChange={(value) =>
											update({
												thresholds: form.thresholds.map((r, i) => (i === index ? { ...r, type: value as OmRuleThresholdType } : r)),
											})
										}
									/>
								</div>
								<Button
									type='button'
									variant='ghost'
									size='icon'
									aria-label={t('common:actions.delete')}
									onClick={() => update({ thresholds: form.thresholds.filter((_, i) => i !== index) })}>
									<Trash2 className='size-4' />
								</Button>
							</div>
						))}
					</div>
				)}

				{showFeatures && (
					<div>
						<FeatureMultiSelect
							values={form.featureIds}
							label={t('notifications.rules.drawer.features')}
							placeholder={t('notifications.rules.drawer.featuresPlaceholder')}
							onChange={(features) => update({ featureIds: features.map((feature) => feature.id) })}
						/>
						<p className='mt-1 text-xs text-content-slate-muted'>{t('notifications.rules.drawer.featuresDescription')}</p>
					</div>
				)}

				<div className='flex items-center justify-between rounded-lg border border-line p-3'>
					<div>
						<p className='text-sm font-medium text-content-zinc'>{t('notifications.rules.drawer.enabled')}</p>
						<p className='text-xs text-content-slate-muted'>{t('notifications.rules.drawer.enabledDescription')}</p>
					</div>
					<Switch
						checked={!form.disabled}
						onCheckedChange={(enabled) => update({ disabled: !enabled })}
						aria-label={t('notifications.rules.drawer.enabled')}
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

export default RuleDrawer;
