import { Page, Spacer, Chip, Card, CardHeader, Loader } from '@/components/atoms';
import { Detail, ApiDocsContent } from '@/components/molecules';
import { API_DOCS_TAGS } from '@/constants/apiDocsTags';
import { useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import CouponApi from '@/api/CouponApi';
import { COUPON_TYPE } from '@/types/common/Coupon';
import { ENTITY_STATUS } from '@/models';
import formatChips from '@/utils/common/format_chips';
import formatDate from '@/utils/common/format_date';
import toast from 'react-hot-toast';
import formatCadenceChip from '@/utils/common/format_cadence_chip';
import { getCurrencySymbol } from '@/utils/common/helper_functions';
import { useTranslation } from 'react-i18next';

const CouponDetails = () => {
	const { t } = useTranslation(['catalog', 'common']);
	const { id } = useParams<{ id: string }>();

	const {
		data: coupon,
		isLoading,
		isError,
	} = useQuery({
		queryKey: ['fetchCouponDetails', id],
		queryFn: () => CouponApi.getCouponById(id!),
		enabled: !!id,
	});

	if (isLoading) {
		return <Loader />;
	}

	if (isError || !coupon) {
		toast.error(t('toast.coupon.loadFailed'));
		return (
			<Page heading={t('common:errors.loadFailedShort')}>
				<div className='flex items-center justify-center h-64'>
					<div className='text-muted-foreground'>{t('catalog:coupons.details.loadError')}</div>
				</div>
			</Page>
		);
	}

	const details: Detail[] = [
		{
			label: 'Type',
			value: (
				<Chip
					variant='default'
					label={coupon.type === COUPON_TYPE.FIXED ? t('catalog:coupons.drawer.fixedAmount') : t('catalog:coupons.drawer.percentage')}
				/>
			),
		},
		{
			label: 'Coupon Code',
			value: coupon.coupon_code ? <code className='font-mono bg-muted px-1.5 py-0.5 rounded text-sm'>{coupon.coupon_code}</code> : '—',
		},
		{
			label: 'Discount',
			value:
				coupon.type === COUPON_TYPE.FIXED
					? `${getCurrencySymbol(coupon.currency)} ${coupon.amount_off || '0.00'}`
					: `${coupon.percentage_off || '0'}%`,
		},
		{
			label: 'Cadence',
			value: coupon.cadence ? <Chip variant='default' label={formatCadenceChip(coupon.cadence)} /> : 'Not set',
		},
		{
			label: 'Status',
			value: <Chip variant={coupon.status === ENTITY_STATUS.PUBLISHED ? 'success' : 'default'} label={formatChips(coupon.status)} />,
		},
		{
			label: 'Redemptions',
			value: `${coupon.total_redemptions}/${coupon.max_redemptions || '∞'}`,
		},
		{
			label: 'Duration in Periods',
			value: coupon.duration_in_periods?.toString() || 'Not set',
		},
		{
			label: 'Redeem After',
			value: coupon.redeem_after ? formatDate(coupon.redeem_after) : 'Not set',
		},
		{
			label: 'Redeem Before',
			value: coupon.redeem_before ? formatDate(coupon.redeem_before) : 'Not set',
		},
		{
			label: 'Created At',
			value: formatDate(coupon.created_at),
		},
		{
			label: 'Updated At',
			value: formatDate(coupon.updated_at),
		},
	];

	if (coupon.metadata && Object.keys(coupon.metadata).length > 0) {
		details.push({
			label: 'Metadata',
			value: <pre className='text-sm bg-muted p-3 rounded-md overflow-auto max-h-32'>{JSON.stringify(coupon.metadata, null, 2)}</pre>,
		});
	}

	return (
		<Page documentTitle={coupon.name} heading={coupon.name}>
			<ApiDocsContent tags={API_DOCS_TAGS.Coupons} />

			<Spacer className='!h-6' />

			<div className='space-y-6'>
				<Card variant='notched'>
					<CardHeader title={t('catalog:coupons.details.detailsTitle')} />
					<div className='p-6'>
						<div className='grid grid-cols-1 md:grid-cols-2 gap-6'>
							<div className='space-y-4'>
								{details.slice(0, Math.ceil(details.length / 2)).map((detail, index) => (
									<div key={index} className='flex flex-col space-y-1'>
										<span className='text-sm font-medium text-muted-foreground'>{detail.label}</span>
										<div className='text-sm'>{detail.value}</div>
									</div>
								))}
							</div>
							<div className='space-y-4'>
								{details.slice(Math.ceil(details.length / 2)).map((detail, index) => (
									<div key={index} className='flex flex-col space-y-1'>
										<span className='text-sm font-medium text-muted-foreground'>{detail.label}</span>
										<div className='text-sm'>{detail.value}</div>
									</div>
								))}
							</div>
						</div>
					</div>
				</Card>
			</div>
		</Page>
	);
};

export default CouponDetails;
