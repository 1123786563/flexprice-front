import { useEffect } from 'react';
import { useSearchParams } from 'react-router';
import { rememberSessionToken, recallSessionToken } from '@/components/customer-portal/portalReturnUrl';
import useCheckoutTabHandoff from '@/components/customer-portal/useCheckoutTabHandoff';
import { useTranslation } from 'react-i18next';
import { RefreshCw, Shield } from 'lucide-react';
import { motion } from 'framer-motion';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/atoms/Button';
import { useForceLightTheme } from '@/hooks/useForceLightTheme';
import { config } from '@/config/config';
import AuthService from '@/core/auth/AuthService';
import { setPortalCustomerContext } from '@/api/CustomerPortalApi';
import CustomerPortal from './CustomerPortal';

/**
 * Wrapper component for CustomerPortal that:
 * - Extracts dashboard session token from URL query parameters (required)
 * - Passes the dashboard token to CustomerPortal
 *
 * Handles validation and error cases with proper UI components:
 * - Missing token: shows error card with refresh option
 */

interface ErrorStateProps {
	icon: React.ReactNode;
	title: string;
	description: string;
	actionLabel?: string;
	onAction?: () => void;
}

const ErrorState = ({ icon, title, description, actionLabel, onAction }: ErrorStateProps) => (
	<div className='min-h-screen flex items-center justify-center bg-[#fafafa] px-4 py-12 sm:px-6'>
		<motion.div
			initial={{ opacity: 0, y: 20 }}
			animate={{ opacity: 1, y: 0 }}
			transition={{ duration: 0.4, ease: 'easeOut' }}
			className='w-full max-w-lg'>
			<Card className='bg-white border border-[#E9E9E9] rounded-xl shadow-sm'>
				<CardHeader className='text-center pb-6 pt-10 px-8'>
					<div className='mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-[#FEE2E2]/30'>
						<div className='text-zinc-700'>{icon}</div>
					</div>
					<CardTitle className='text-[20px] font-medium text-zinc-950 mb-4 leading-normal'>{title}</CardTitle>
				</CardHeader>
				<CardContent className='text-center px-8 pb-10'>
					<p className='text-base text-zinc-600 mb-8 leading-normal max-w-md mx-auto'>{description}</p>
					{actionLabel && onAction && (
						<Button
							onClick={onAction}
							className='w-full sm:w-auto min-w-[140px] transition-all duration-200 hover:opacity-90'
							variant='outline'>
							<RefreshCw className='w-4 h-4 mr-2' />
							{actionLabel}
						</Button>
					)}
				</CardContent>
			</Card>
		</motion.div>
	</div>
);
const CustomerPortalWrapper = () => {
	// Tenant-facing: never inherit a Flexprice user's dark-mode preference.
	useForceLightTheme();
	const { t } = useTranslation('customer-portal');
	// A provider redirect lands in the tab the checkout was opened in, not the one
	// the customer left behind. That tab reports back and closes itself.
	const isHandingOff = useCheckoutTabHandoff();
	const [searchParams] = useSearchParams();
	// OpenMeter 模式：OSS portal token 服务是 noop 适配器，无法签发客户自助 token——
	// 门户改为管理员视图：`?customer=<id>` + 管理会话（localStorage 会话 JWT）驱动，
	// 数据由 CustomerPortalApi 从 admin API 组装。
	const omCustomer = config.openmeter.enabled ? searchParams.get('customer') : null;
	// Falls back to stored state so a customer returning from a hosted checkout
	// still authenticates: the return URL deliberately omits the token rather than
	// handing the session to the payment provider. The provider opens in a fresh
	// tab, so the store has to outlive this one — see portalReturnUrl.
	const urlToken = searchParams.get('token');
	const token = urlToken ?? recallSessionToken();

	useEffect(() => {
		if (urlToken) rememberSessionToken(urlToken);
	}, [urlToken]);

	// Scope the portal's data calls to this customer for as long as the view mounts.
	useEffect(() => {
		setPortalCustomerContext(omCustomer);
		return () => setPortalCustomerContext(null);
	}, [omCustomer]);

	// Nothing to show in a tab that is closing — and the invalid-link card in
	// particular would be wrong, since this tab's job is already done.
	if (isHandingOff) return null;

	// OpenMeter 管理员视图：需要 customer 参数与已登录的管理会话。
	if (config.openmeter.enabled) {
		const sessionToken = AuthService.peekStoredToken();
		if (!omCustomer || !sessionToken) {
			return (
				<ErrorState
					icon={<Shield className='h-9 w-9 text-zinc-700' />}
					title={t('wrapper.invalidLinkTitle')}
					description={t('wrapper.invalidLinkDescription')}
					actionLabel={t('wrapper.refreshPage')}
					onAction={() => window.location.reload()}
				/>
			);
		}
		return <CustomerPortal token={sessionToken} />;
	}

	// Validate required token parameter
	if (!token) {
		return (
			<ErrorState
				icon={<Shield className='h-9 w-9 text-zinc-700' />}
				title={t('wrapper.invalidLinkTitle')}
				description={t('wrapper.invalidLinkDescription')}
				actionLabel={t('wrapper.refreshPage')}
				onAction={() => window.location.reload()}
			/>
		);
	}

	// Pass dashboard token to CustomerPortal
	return <CustomerPortal token={token} />;
};

export default CustomerPortalWrapper;
