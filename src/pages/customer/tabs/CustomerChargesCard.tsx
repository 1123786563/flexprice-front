import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Card, CardHeader, Loader } from '@/components/atoms';
import FlexpriceTable from '@/components/molecules/Table';
import type { ColumnData } from '@/components/molecules/Table';
import OmChargesApi from '@/api/OmChargesApi';
import type { OmCharge } from '@/api/OmChargesApi';

/**
 * 客户费用项（OpenMeter v3 charges，只读）：挂在客户上的固定/用量计费项。
 * 创建需要完整 OM 语义（invoice_at/settlement_mode 等），暂无 UI 表单。
 */
const CustomerChargesCard = ({ customerId }: { customerId: string }) => {
	const { t } = useTranslation('customers');

	const { data, isLoading } = useQuery({
		queryKey: ['customerCharges', customerId],
		queryFn: () => OmChargesApi.listCharges(customerId, { limit: 20 }),
		enabled: !!customerId,
	});

	const columns: ColumnData<OmCharge>[] = [
		{ title: t('tabPanels.charges.name'), render: (row) => <span>{row.name}</span> },
		{ title: t('tabPanels.charges.type'), render: (row) => <span>{row.type}</span> },
		{ title: t('tabPanels.charges.currency'), render: (row) => <span>{row.currency}</span> },
	];

	if (isLoading) {
		return (
			<Card variant='notched'>
				<CardHeader title={t('tabPanels.charges.title')} />
				<div className='flex justify-center py-8'>
					<Loader />
				</div>
			</Card>
		);
	}

	return (
		<Card variant='notched'>
			<CardHeader title={t('tabPanels.charges.title')} />
			<div className='px-5 pb-5'>
				{(data?.items.length ?? 0) === 0 ? (
					<p className='py-4 text-sm text-content-muted'>{t('tabPanels.charges.empty')}</p>
				) : (
					<FlexpriceTable columns={columns} data={data?.items ?? []} variant='no-bordered' showEmptyRow={false} />
				)}
			</div>
		</Card>
	);
};

export default CustomerChargesCard;
