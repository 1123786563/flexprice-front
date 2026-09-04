import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { PageLoader } from '@/components/atoms';
import { RouteNames } from '@/core/routes/Routes';
import { SSO_PENDING_KEY, SSO_STATE_KEY } from './SamlSignin';
import { OIDC_PENDING_KEY, OIDC_STATE_KEY } from './OidcSignin';

/**
 * Landing page for a completed SSO login (SAML or OIDC).
 *
 * The backend validates the assertion or authorization code and redirects the
 * browser here with the token it minted, so this page only has to store it in
 * the shape the rest of the app already reads and get the token out of the URL.
 */
const SamlCallback = () => {
	const { t } = useTranslation('auth');
	const navigate = useNavigate();
	const [error, setError] = useState<string | null>(null);
	// Runs once: React 18 mounts effects twice in development, and the second
	// pass would find the token already stripped from the URL and report a
	// failure over a login that actually succeeded.
	const hasProcessed = useRef(false);

	useEffect(() => {
		if (hasProcessed.current) return;
		hasProcessed.current = true;

		// Read only from the URL fragment. A fragment is never sent to a server, so
		// it stays out of the access logs of every proxy and CDN in the path and
		// out of the Referer header of every later request; a query parameter
		// reaches all of those, and this token is valid for thirty days.
		//
		// Deliberately no query-string fallback. The backend that puts the token in
		// the fragment ships with this change, so the only thing a fallback could
		// accept is a token that had already travelled somewhere it should not
		// have — and accepting it would keep that path alive indefinitely.
		const fragment = new URLSearchParams(window.location.hash.replace(/^#/, ''));
		const token = fragment.get('token');
		if (!token) {
			setError(t('sso.missingToken'));
			return;
		}

		// Only accept a token for a login this tab actually started. This route is
		// public and stores whatever it is handed, so without this check anyone
		// could send a victim `/auth/callback#token=<their own token>` and have the
		// victim's dashboard adopt the attacker's session — everything the victim
		// then did would happen inside the attacker's account, including anything
		// they typed or uploaded.
		//
		// The markers are cleared either way, so a token cannot be replayed into a
		// second tab by reusing the same URL.
		const samlPending = sessionStorage.getItem(SSO_PENDING_KEY);
		sessionStorage.removeItem(SSO_PENDING_KEY);

		const oidcPending = sessionStorage.getItem(OIDC_PENDING_KEY);
		sessionStorage.removeItem(OIDC_PENDING_KEY);

		// Same shape the password login writes, so everything downstream — the
		// axios client, useUser, logout — treats an SSO session identically. Only
		// `token` is read for authentication; the user is loaded from /users/me.
		//
		// The tenant is never taken from a fragment a marker did not vouch for:
		// for SAML it comes from the marker this tab set (the fragment is
		// attacker-supplied), for OIDC the nonce comparison below has already
		// bound the whole fragment to the login this tab started, so the
		// backend-written tenant_id is trustworthy by the time it is read.
		// `user_id` is omitted — nothing downstream reads it, and the user is
		// loaded from /users/me against the token itself.
		let storedTenantId: string;

		if (samlPending) {
			// The marker holds the tenant the login was started for, and it has to
			// match. A marker that only proved "some login began" would still accept a
			// token for a different tenant: an attacker who gets the victim to click
			// Sign in with SSO, then to open a link carrying the attacker's own token,
			// would have that token adopted because a marker existed. Comparing the
			// tenant closes that — the callback now only completes the login this tab
			// actually started.
			// Required, not optional. Treating a missing tenant as "nothing to check"
			// let an attacker skip the comparison by simply leaving it out of the URL,
			// which defeats the whole guard. The backend always sends it.
			const callbackTenant = fragment.get('tenant_id');
			if (!callbackTenant || callbackTenant !== samlPending) {
				window.history.replaceState(null, '', window.location.pathname);
				setError(t('sso.unsolicitedToken'));
				return;
			}

			// The nonce ties the response to this specific login, which the tenant
			// alone cannot: every login to a tenant carries the same tenant. It went
			// out as SAML RelayState and comes back with the assertion, so a token
			// from any other login — including one an attacker starts and completes
			// themselves — does not carry it.
			const expectedState = sessionStorage.getItem(SSO_STATE_KEY);
			sessionStorage.removeItem(SSO_STATE_KEY);
			if (!expectedState || fragment.get('state') !== expectedState) {
				window.history.replaceState(null, '', window.location.pathname);
				setError(t('sso.unsolicitedToken'));
				return;
			}

			storedTenantId = samlPending;
		} else if (oidcPending) {
			// OIDC names no tenant up front — the provider decides which organization
			// the user lands in — so the nonce is the only thing that distinguishes
			// this login from any other. It went out as the login URL's `state` query
			// parameter and comes back in the fragment; a token from any other login,
			// including an attacker's, does not carry it.
			const expectedState = sessionStorage.getItem(OIDC_STATE_KEY);
			sessionStorage.removeItem(OIDC_STATE_KEY);
			if (!expectedState || fragment.get('state') !== expectedState) {
				window.history.replaceState(null, '', window.location.pathname);
				setError(t('sso.unsolicitedToken'));
				return;
			}

			storedTenantId = fragment.get('tenant_id') ?? '';
		} else {
			window.history.replaceState(null, '', window.location.pathname);
			setError(t('sso.unsolicitedToken'));
			return;
		}

		localStorage.setItem('token', JSON.stringify({ token, tenant_id: storedTenantId }));

		// Clear the fragment before navigating. replace: true keeps the token out
		// of history, where it would otherwise be recoverable with the back button
		// after a logout, and the token is already stored by this point.
		window.history.replaceState(null, '', window.location.pathname);
		navigate(RouteNames.home, { replace: true });
	}, [navigate, t]);

	if (error) {
		return (
			<div className='flex min-h-screen items-center justify-center p-6'>
				<div className='max-w-md text-center'>
					<p className='mb-4 text-sm text-red-600'>{error}</p>
					<button className='text-sm underline' onClick={() => navigate(RouteNames.login, { replace: true })}>
						{t('buttons.backToLogin')}
					</button>
				</div>
			</div>
		);
	}

	return <PageLoader />;
};

export default SamlCallback;
