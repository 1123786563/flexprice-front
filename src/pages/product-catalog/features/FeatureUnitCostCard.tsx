import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import { Button, Card, CardHeader, Input } from '@/components/atoms';
import FeatureApi, { type FeatureUnitCostInput } from '@/api/FeatureApi';
import { refetchQueries } from '@/core/services/tanstack/ReactQueryProvider';

/**
 * Feature 单位成本卡片（OpenMeter v3 独有）：manual 固定每单位成本，llm 由 LLM 成本库
 * 解析。走 OM 原生 PATCH /features/{id}（唯一可原位更新的 feature 字段）；成本查询
 * 聚合近 30 天用量成本。
 */
const FeatureUnitCostCard = ({ featureId }: { featureId: string }) => {
	const { t } = useTranslation('catalog');
	const [amount, setAmount] = useState('');
	const [costResult, setCostResult] = useState<string | null>(null);

	const { data: unitCost, refetch } = useQuery({
		queryKey: ['featureUnitCost', featureId],
		queryFn: () => FeatureApi.getFeatureUnitCost(featureId),
		enabled: !!featureId,
	});

	const saveMutation = useMutation({
		mutationFn: async (next: FeatureUnitCostInput | null) => {
			await FeatureApi.updateFeatureUnitCost(featureId, next);
		},
		onSuccess: async (_data, next) => {
			toast.success(t('features.details.unitCostSaved'));
			await refetch();
			await refetchQueries(['fetchFeatureDetails', featureId]);
			if (next === null) setAmount('');
		},
		onError: (error: Error) => toast.error(error.message || t('features.details.unitCostSaveFailed')),
	});

	const queryMutation = useMutation({
		mutationFn: async () => {
			const to = new Date();
			const from = new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
			return await FeatureApi.queryFeatureCost(featureId, { from, to });
		},
		onSuccess: (result) => setCostResult(JSON.stringify(result, null, 2)),
		onError: (error: Error) => toast.error(error.message || t('features.details.unitCostQueryFailed')),
	});

	const isLlm = unitCost?.type === 'llm';
	const manualAmount = unitCost?.type === 'manual' ? unitCost.amount : '';

	return (
		<Card variant='notched'>
			<CardHeader title={t('features.details.title')} />
			<div className='space-y-3 px-5 pb-5'>
				<p className='text-xs text-content-muted'>{t('features.details.desc')}</p>

				{unitCost == null ? (
					<p className='text-sm text-content-muted'>{t('features.details.noCost')}</p>
				) : isLlm ? (
					<p className='text-sm text-content-heading'>{t('features.details.llmConfigured')}</p>
				) : (
					<div className='text-sm text-content-heading'>{t('features.details.currentValue', { value: manualAmount })}</div>
				)}

				{!isLlm && (
					<div className='flex items-center gap-2'>
						<Input
							label={t('features.details.manualAmount')}
							value={amount}
							onChange={setAmount}
							type='number'
							min='0'
							placeholder={manualAmount}
							className='max-w-[220px]'
						/>
						<Button
							variant='outline'
							size='sm'
							disabled={saveMutation.isPending || amount === ''}
							onClick={() => saveMutation.mutate({ type: 'manual', amount })}>
							{t('features.details.set')}
						</Button>
						{unitCost != null && (
							<Button variant='ghost' size='sm' disabled={saveMutation.isPending} onClick={() => saveMutation.mutate(null)}>
								{t('features.details.clear')}
							</Button>
						)}
					</div>
				)}

				<div className='flex items-center gap-2'>
					<Button variant='outline' size='sm' disabled={queryMutation.isPending || unitCost == null} onClick={() => queryMutation.mutate()}>
						{t('features.details.query')}
					</Button>
				</div>
				{costResult && (
					<div>
						<p className='mb-1 text-xs font-medium text-content-muted'>{t('features.details.queryResult')}</p>
						<pre className='max-h-56 overflow-auto rounded bg-surface-muted p-3 text-xs'>{costResult}</pre>
					</div>
				)}
			</div>
		</Card>
	);
};

export default FeatureUnitCostCard;
