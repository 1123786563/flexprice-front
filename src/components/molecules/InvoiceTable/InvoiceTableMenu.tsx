import { Invoice, INVOICE_STATUS, INVOICE_TYPE } from '@/models/Invoice';
import { InvoiceListItem } from '@/types/dto';
import { FC, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DropdownMenu, RecordPaymentTopup } from '..';
import InvoiceDownloadFormatDialog from '../InvoiceDownloadFormatDialog/InvoiceDownloadFormatDialog';
import { DropdownMenuOption, getCopyIdOption } from '../DropdownMenu/DropdownMenu';
import { useMutation } from '@tanstack/react-query';
import InvoiceApi from '@/api/InvoiceApi';
import toast from 'react-hot-toast';
import InvoiceStatusModal from './InvoiceStatusModal';
import InvoicePaymentStatusModal from './InvoicePaymentStatusModal';
import { useNavigate } from 'react-router';
import { refetchQueries } from '@/core/services/tanstack/ReactQueryProvider';
import { refetchInvoiceQueries } from '@/core/services/tanstack/queryKeys';
import { PAYMENT_DESTINATION_TYPE } from '@/models/Payment';
import { PAYMENT_STATUS } from '@/constants';
import { RouteNames } from '@/core/routes/Routes';
import { useCurrentUserPermissions } from '@/hooks/useCurrentUserPermissions';

interface Props {
	data: InvoiceListItem;
}

const InvoiceTableMenu: FC<Props> = ({ data }) => {
	const navigate = useNavigate();
	const { t: tc } = useTranslation('common');
	const { t: tb } = useTranslation('billing');
	const { can } = useCurrentUserPermissions();
	const canWrite = can('invoice', 'write');
	const writeDeniedReason = canWrite ? undefined : "You don't have permission to modify invoices";

	const { mutate: triggerCommunication } = useMutation({
		mutationFn: async (invoice_id: string) => {
			return await InvoiceApi.triggerCommunication(invoice_id);
		},
		onSuccess: () => {
			toast.success(tb('toast.invoice.communicationTriggered'));
			void refetchInvoiceQueries();
		},
		onError: (error: Error) => {
			toast.error(error.message || tb('toast.invoice.communicationFailed'));
		},
	});

	const { mutateAsync: downloadInvoicePdfAsync, isPending: isPdfDownloadPending } = useMutation({
		mutationFn: async (invoice_id: string) => {
			return await InvoiceApi.downloadInvoicePdf(invoice_id);
		},
		onSuccess: () => {
			toast.success(tb('toast.invoice.downloaded'));
		},
		onError: (error: Error) => {
			toast.error(error.message || tb('toast.invoice.downloadFailed'));
		},
	});

	const { mutateAsync: downloadInvoiceCsvAsync, isPending: isCsvDownloadPending } = useMutation({
		mutationFn: async (invoice: InvoiceListItem) => {
			const fullInvoice: Invoice = invoice.line_items?.length ? (invoice as Invoice) : await InvoiceApi.getInvoiceById(invoice.id);
			return InvoiceApi.downloadInvoiceCsv(fullInvoice);
		},
		onSuccess: (rows) => {
			if (rows === 0) {
				toast.error(tb('toast.invoice.noBillableItems'));
			} else {
				toast.success(tb('toast.invoice.csvDownloaded'));
			}
		},
		onError: (error: Error) => {
			toast.error(error.message || tb('toast.invoice.csvDownloadFailed'));
		},
	});

	const { mutate: recalculateInvoice, isPending: isRecalculating } = useMutation({
		mutationFn: async (invoice_id: string) => {
			return await InvoiceApi.recalculateInvoice(invoice_id);
		},
		onSuccess: () => {
			toast.success(tb('toast.invoice.recalculationTriggered'));
			void refetchInvoiceQueries();
		},
		onError: (error: Error) => {
			toast.error(error.message || tb('toast.invoice.recalculationFailed'));
		},
	});

	const [isDownloadFormatOpen, setIsDownloadFormatOpen] = useState(false);

	const [state, setState] = useState<{
		isPaymentModalOpen: boolean;
		isStatusModalOpen: boolean;
		isRecordPaymentDrawerOpen: boolean;
		activeInvoice?: InvoiceListItem;
	}>({
		isPaymentModalOpen: false,
		isStatusModalOpen: false,
		isRecordPaymentDrawerOpen: false,
	});

	const menuOptions: DropdownMenuOption[] = [
		getCopyIdOption(data.id, tc, { entityType: 'Invoice' }),
		{
			label: 'Download Invoice',
			group: 'Actions',
			onSelect: () => {
				setIsDownloadFormatOpen(true);
			},
		},
		{
			label: 'Send Communication',
			group: 'Actions',
			onSelect: () => {
				triggerCommunication(data.id);
			},
			disabled: !canWrite,
			disabledReason: writeDeniedReason,
		},
		{
			label: 'Record Payment',
			group: 'Actions',
			onSelect: () => {
				setState({
					...state,
					isRecordPaymentDrawerOpen: true,
					activeInvoice: data,
				});
			},
			disabled:
				!canWrite ||
				data?.payment_status === PAYMENT_STATUS.SUCCEEDED ||
				data?.invoice_status === INVOICE_STATUS.VOIDED ||
				(data?.amount_remaining ?? 0) === 0,
			disabledReason: writeDeniedReason,
		},
		{
			label: 'Update Invoice Status',
			group: 'Actions',
			onSelect: () => {
				setState({
					...state,
					isStatusModalOpen: true,
					activeInvoice: data,
				});
			},
			disabled: !canWrite,
			disabledReason: writeDeniedReason,
		},
		{
			label: 'Update Payment Status',
			group: 'Actions',
			onSelect: () => {
				setState({
					...state,
					isPaymentModalOpen: true,
					activeInvoice: data,
				});
			},
			disabled: !canWrite,
			disabledReason: writeDeniedReason,
		},
		{
			label: 'Issue a Credit Note',
			group: 'Actions',
			disabled: !canWrite || data?.invoice_status !== 'FINALIZED' || data?.payment_status === 'REFUNDED',
			disabledReason: writeDeniedReason,
			onSelect: () => {
				navigate(`${RouteNames.customers}/${data?.customer_id}/invoice/${data?.id}/credit-note`);
			},
		},
		{
			label: 'Recalculate Invoice',
			group: 'Actions',
			disabled:
				!canWrite ||
				data?.invoice_status === INVOICE_STATUS.DRAFT ||
				data?.invoice_type !== INVOICE_TYPE.SUBSCRIPTION ||
				!!data?.recalculated_invoice_id ||
				isRecalculating,
			disabledReason: writeDeniedReason,
			onSelect: () => {
				recalculateInvoice(data.id);
			},
		},
		{
			label: 'View Customer',
			group: 'Connections',
			onSelect: () => {
				navigate(`${RouteNames.customers}/${data.customer_id}`);
			},
		},
		{
			label: 'View Subscription',
			group: 'Connections',
			onSelect() {
				navigate(`${RouteNames.customers}/${data.customer_id}/subscription/${data.subscription_id}`);
			},
		},
	];
	const handlePaymentSuccess = () => {
		void refetchInvoiceQueries();
		void refetchQueries(['payments', data.id]);
	};
	return (
		<div>
			<InvoiceDownloadFormatDialog
				open={isDownloadFormatOpen}
				onOpenChange={setIsDownloadFormatOpen}
				isPdfPending={isPdfDownloadPending}
				onSelectPdf={() => downloadInvoicePdfAsync(data.id)}
				onSelectCsv={() => {
					void downloadInvoiceCsvAsync(data).catch(() => undefined);
				}}
				isCsvPending={isCsvDownloadPending}
			/>
			<InvoiceStatusModal
				invoice={state.activeInvoice}
				isOpen={state.isStatusModalOpen}
				onOpenChange={(open) => {
					setState({
						...state,
						isStatusModalOpen: open,
					});
				}}
			/>
			<InvoicePaymentStatusModal
				invoice={state.activeInvoice}
				isOpen={state.isPaymentModalOpen}
				onOpenChange={(open) => {
					setState({
						...state,
						isPaymentModalOpen: open,
					});
				}}
			/>
			<RecordPaymentTopup
				isOpen={state.isRecordPaymentDrawerOpen}
				onOpenChange={(open: boolean) => {
					setState({
						...state,
						isRecordPaymentDrawerOpen: open,
					});
				}}
				destination_id={data.id}
				destination_type={PAYMENT_DESTINATION_TYPE.INVOICE}
				customer_id={data.customer_id}
				max_amount={Number(data?.amount_remaining ?? 0)}
				currency={data.currency}
				onSuccess={handlePaymentSuccess}
			/>
			<DropdownMenu options={menuOptions} />
		</div>
	);
};

export default InvoiceTableMenu;
