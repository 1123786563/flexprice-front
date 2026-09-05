import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router';
import { useTranslation } from 'react-i18next';
import AuthService from '@/core/auth/AuthService';
import BrandTemplate from './BrandTemplate';
import { AuthTab } from './authTabs';
import { config } from '@/config/config';
import { OIDC_AUTO_REDIRECT_AT_KEY, OIDC_AUTO_REDIRECT_COOLDOWN_MS, startOidcLogin } from './OidcSignin';

const AuthPage: React.FC = () => {
	const { t } = useTranslation('auth');
	const navigate = useNavigate();
	const location = useLocation();
	const [currentTab, setCurrentTab] = useState<AuthTab>(AuthTab.LOGIN);
	const signupEnabled = config.platform.signup.enabled;
	const [redirectingToSso, setRedirectingToSso] = useState(false);

	useEffect(() => {
		const searchParams = new URLSearchParams(location.search);
		if (searchParams.get('tab') === AuthTab.RESET_PASSWORD) return;
		const fetchUser = async () => {
			const tokenStr = await AuthService.getAcessToken();
			if (tokenStr) navigate('/');
		};
		fetchUser();
	}, [location.search, navigate]);

	// Signed-out visits go straight to the identity provider when OIDC SSO is
	// configured, so the login screen only appears when the round trip cannot
	// be launched. The bounce guard keeps a failing provider from trapping the
	// browser in a redirect loop: after one launch, the next mount within the
	// cooldown renders the login screen with its error and manual SSO button.
	useEffect(() => {
		const searchParams = new URLSearchParams(location.search);
		if (searchParams.get('tab')) return;

		if (!config.auth.oidcLoginUrl) return;

		let cancelled = false;

		const maybeAutoRedirect = async () => {
			const tokenStr = await AuthService.getAcessToken();
			if (tokenStr || cancelled) return;

			const lastLaunch = Number(sessionStorage.getItem(OIDC_AUTO_REDIRECT_AT_KEY) ?? 0);
			if (Number.isFinite(lastLaunch) && Date.now() - lastLaunch < OIDC_AUTO_REDIRECT_COOLDOWN_MS) return;

			setRedirectingToSso(true);
			startOidcLogin();
		};

		maybeAutoRedirect();

		return () => {
			cancelled = true;
		};
	}, [location.search]);

	useEffect(() => {
		const searchParams = new URLSearchParams(location.search);
		const tab = searchParams.get('tab');

		if (tab === AuthTab.SIGNUP && !signupEnabled) {
			navigate('/auth', { replace: true });
			return;
		}

		if (tab === AuthTab.SIGNUP || tab === AuthTab.FORGOT_PASSWORD || tab === AuthTab.RESET_PASSWORD) {
			setCurrentTab(tab as AuthTab);
		} else {
			setCurrentTab(AuthTab.LOGIN);
		}
	}, [location, navigate, signupEnabled]);

	const switchTab = (tab: AuthTab) => {
		if (tab === AuthTab.SIGNUP && !signupEnabled) {
			navigate('/auth');
			return;
		}
		navigate(`/auth?tab=${tab}`);
	};

	if (redirectingToSso) {
		return (
			<div className='flex min-h-screen items-center justify-center p-6'>
				<p className='text-sm text-content-secondary'>{t('sso.redirecting')}</p>
			</div>
		);
	}

	return <BrandTemplate currentTab={currentTab} switchTab={switchTab} />;
};

export default AuthPage;
