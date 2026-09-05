import { useTranslation } from 'react-i18next';
import { Button } from '@/components/atoms';
import { config } from '@/config/config';

/**
 * sessionStorage key marking that this browser tab started an OIDC login.
 *
 * Same purpose as the SAML marker in SamlSignin: the /auth/callback route is
 * public and stores whatever token it is handed, so without a marker this tab
 * set itself, anyone could send a victim `/auth/callback#token=<attacker's
 * token>` and have the victim's dashboard adopt the attacker's session.
 *
 * sessionStorage rather than localStorage: per tab and cleared when the tab
 * closes, so an abandoned login does not leave the callback armed indefinitely.
 */
export const OIDC_PENDING_KEY = 'oidc_login_pending';

/**
 * sessionStorage key holding the nonce for the OIDC login in progress.
 *
 * The nonce is generated per sign-in, sent to the backend as the login URL's
 * `state` query parameter, carried through the provider round-trip in a
 * server-side cookie, and returned in the callback redirect fragment for the
 * comparison in the callback page. A token from any other login — including
 * one an attacker starts and completes themselves — does not carry it.
 */
export const OIDC_STATE_KEY = 'oidc_login_state';

/**
 * sessionStorage key stamping when this tab last launched an OIDC login.
 *
 * The auto-redirect on the auth page uses it as a bounce guard: if the round
 * trip comes straight back (provider down, misconfigured client, denied
 * consent), re-launching on every mount would loop the browser between the
 * app and the provider forever. A recent stamp means the next auth-page mount
 * renders the normal login screen instead, where the manual SSO button and a
 * visible error can take over.
 */
export const OIDC_AUTO_REDIRECT_AT_KEY = 'oidc_auto_redirect_at';

/** How long after an auto-redirect launch the auth page suppresses another one. */
export const OIDC_AUTO_REDIRECT_COOLDOWN_MS = 10_000;

function newLoginNonce(): string {
	const bytes = new Uint8Array(16);
	crypto.getRandomValues(bytes);
	return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Launch the OIDC round trip: store this tab's login markers and navigate the
 * whole tab to the backend's login endpoint, which forwards to the provider.
 *
 * Shared by the manual SSO button and the auth page's signed-out
 * auto-redirect, so both paths set the same markers the callback page checks
 * and the same bounce-guard stamp.
 */
export function startOidcLogin(): void {
	const nonce = newLoginNonce();
	sessionStorage.setItem(OIDC_PENDING_KEY, 'true');
	sessionStorage.setItem(OIDC_STATE_KEY, nonce);
	sessionStorage.setItem(OIDC_AUTO_REDIRECT_AT_KEY, String(Date.now()));

	const base = config.auth.oidcLoginUrl.replace(/\/$/, '');
	window.location.href = `${base}?state=${encodeURIComponent(nonce)}`;
}

/**
 * Entry point for OIDC single sign-on (e.g. Casdoor behind the OpenMeter
 * backend), shown when VITE_OIDC_LOGIN_URL is configured.
 *
 * A full page navigation, not a fetch: the browser must follow the redirect
 * to the identity provider and carry its session cookies there, and it is the
 * browser the backend redirects back with the token. An XHR would break both
 * halves of that.
 *
 * The tenant an OIDC login lands in is decided by the provider (the user's
 * organization), so unlike the per-tenant SAML button there is no tenant to
 * name up front; the nonce alone ties the callback token to this tab.
 */
const OidcSignin = () => {
	const { t } = useTranslation('auth');

	const handleOidcLogin = () => {
		startOidcLogin();
	};

	return (
		<div>
			<Button onClick={handleOidcLogin} variant='outline' className='w-full mb-6 flex items-center justify-center gap-2 h-11'>
				{t('buttons.continueWithSso')}
			</Button>
		</div>
	);
};

export default OidcSignin;
