import { useMemo } from 'react';
import CustomerApi from '@/api/CustomerApi';
import { config } from '@/config/config';
import { RouteNames } from '@/core/routes/Routes';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import { logger } from '@/utils/common/Logger';

/**
 * Custom hook to generate and manage customer portal URL
 * @param customerExternalId - The customer external ID to generate portal URL for
 * @returns Object with portalUrl and copyToClipboard function
 */
export const useCustomerPortalUrl = (customerExternalId: string | undefined) => {
	const { t } = useTranslation('customers');

	const portalUrl = useMemo(() => {
		if (!customerExternalId) return null;

		try {
			// Build the base customer portal URL (token will be added dynamically)
			const baseUrl = window.location.origin;
			const portalPath = RouteNames.customerPortal;
			const url = new URL(portalPath, baseUrl);

			return url.toString();
		} catch (error) {
			logger.error('Failed to generate customer portal URL', error);
			return null;
		}
	}, [customerExternalId]);

	/**
	 * OpenMeter 模式的门户链接：OSS portal token 服务是 noop，无法签发客户自助 token——
	 * 门户以管理员会话代客户查看，链接直接携带 `?customer=<id>`（无需会话往返）。
	 */
	const buildOmPortalUrl = (): string | null => {
		if (!portalUrl || !customerExternalId) return null;
		const url = new URL(portalUrl);
		url.searchParams.set('customer', customerExternalId);
		return url.toString();
	};

	/**
	 * Generates a complete portal URL with dashboard session token and copies it to clipboard
	 */
	const copyToClipboard = async () => {
		if (!customerExternalId) {
			toast.error(t('toast.customerPortal.missingExternalId'));
			return;
		}

		if (config.openmeter.enabled) {
			const omUrl = buildOmPortalUrl();
			if (!omUrl) {
				toast.error(t('toast.customerPortal.generateUrlFailed'));
				return;
			}
			await navigator.clipboard.writeText(omUrl);
			toast.success(t('toast.customerPortal.linkCopied'));
			return;
		}

		if (!portalUrl) {
			toast.error(t('toast.customerPortal.generateUrlFailed'));
			return;
		}

		try {
			// Create dashboard session to get token
			const sessionData = await CustomerApi.createDashboardSession(customerExternalId);
			if (!sessionData?.token) {
				toast.error(t('toast.customerPortal.createSessionFailed'));
				return;
			}

			// Add token to URL
			const urlWithToken = new URL(portalUrl);
			urlWithToken.searchParams.set('token', sessionData.token);

			// Copy to clipboard
			await navigator.clipboard.writeText(urlWithToken.toString());
			toast.success(t('toast.customerPortal.linkCopied'));
		} catch (error) {
			logger.error('Failed to copy customer portal link', error);
			toast.error(t('toast.customerPortal.copyFailed'));
		}
	};

	/**
	 * Opens the customer portal in a new tab with dashboard session token
	 */
	const openInNewTab = async () => {
		if (!customerExternalId) {
			toast.error(t('toast.customerPortal.missingExternalId'));
			return;
		}

		if (config.openmeter.enabled) {
			const omUrl = buildOmPortalUrl();
			if (!omUrl) {
				toast.error(t('toast.customerPortal.generateUrlFailed'));
				return;
			}
			window.open(omUrl, '_blank', 'noopener,noreferrer');
			return;
		}

		if (!portalUrl) {
			toast.error(t('toast.customerPortal.generateUrlFailed'));
			return;
		}

		try {
			// Create dashboard session to get token
			const sessionData = await CustomerApi.createDashboardSession(customerExternalId);
			if (!sessionData?.token) {
				toast.error(t('toast.customerPortal.createSessionFailed'));
				return;
			}

			// Add token to URL
			const urlWithToken = new URL(portalUrl);
			urlWithToken.searchParams.set('token', sessionData.token);

			// Open in new tab
			window.open(urlWithToken.toString(), '_blank', 'noopener,noreferrer');
		} catch (error) {
			logger.error('Failed to open customer portal', error);
			toast.error(t('toast.customerPortal.openFailed'));
		}
	};

	return {
		portalUrl,
		copyToClipboard,
		openInNewTab,
	};
};
