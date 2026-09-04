import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const navigateMock = vi.fn();

vi.mock('react-router', () => ({ useNavigate: () => navigateMock }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

// PageLoader comes from the atoms barrel, which re-exports ErrorBoundary →
// @/core/routes/Routes — a module that builds the whole app router (and drags
// in posthog-js) at import time. Stub both so the test loads only the pages
// under test. RouteNames values mirror the real constants in Routes.tsx.
vi.mock('@/components/atoms', () => ({ PageLoader: () => null }));
vi.mock('@/core/routes/Routes', () => ({ RouteNames: { home: '/', login: '/login' } }));

import SamlCallback from './SamlCallback';
import { OIDC_PENDING_KEY, OIDC_STATE_KEY } from './OidcSignin';

const armOidcLogin = (nonce: string) => {
	sessionStorage.setItem(OIDC_PENDING_KEY, 'true');
	sessionStorage.setItem(OIDC_STATE_KEY, nonce);
};

describe('SamlCallback OIDC branch', () => {
	beforeEach(() => {
		sessionStorage.clear();
		localStorage.clear();
		window.location.hash = '';
		navigateMock.mockClear();
	});

	afterEach(() => {
		window.location.hash = '';
	});

	it('stores the token and navigates home on a valid nonce', async () => {
		armOidcLogin('nonce-123');
		window.location.hash = '#token=jwt-value&tenant_id=acme&state=nonce-123';

		render(<SamlCallback />);

		await waitFor(() => {
			expect(localStorage.getItem('token')).toBe(JSON.stringify({ token: 'jwt-value', tenant_id: 'acme' }));
		});
		await waitFor(() => {
			expect(navigateMock).toHaveBeenCalledWith('/', { replace: true });
		});
		expect(window.location.hash).toBe('');
		// A successful login consumes both markers: the armed state must not
		// survive into the authenticated app.
		expect(sessionStorage.getItem(OIDC_PENDING_KEY)).toBeNull();
		expect(sessionStorage.getItem(OIDC_STATE_KEY)).toBeNull();
	});

	it('rejects a fragment whose nonce does not match', async () => {
		armOidcLogin('nonce-123');
		window.location.hash = '#token=jwt-value&tenant_id=acme&state=other-nonce';

		render(<SamlCallback />);

		await waitFor(() => {
			expect(screen.getByText('sso.unsolicitedToken')).toBeInTheDocument();
		});
		expect(localStorage.getItem('token')).toBeNull();
		expect(navigateMock).not.toHaveBeenCalled();
		// markers are consumed either way: no replay into this tab
		expect(sessionStorage.getItem(OIDC_PENDING_KEY)).toBeNull();
		expect(sessionStorage.getItem(OIDC_STATE_KEY)).toBeNull();
	});

	it('rejects a callback this tab never started', async () => {
		window.location.hash = '#token=jwt-value&tenant_id=acme&state=nonce-123';

		render(<SamlCallback />);

		await waitFor(() => {
			expect(screen.getByText('sso.unsolicitedToken')).toBeInTheDocument();
		});
		expect(localStorage.getItem('token')).toBeNull();
	});

	it('reports a fragment without a token', async () => {
		armOidcLogin('nonce-123');
		window.location.hash = '#tenant_id=acme&state=nonce-123';

		render(<SamlCallback />);

		await waitFor(() => {
			expect(screen.getByText('sso.missingToken')).toBeInTheDocument();
		});
		expect(localStorage.getItem('token')).toBeNull();
		// The early return happens before the markers are touched, so the login
		// stays armed for a retry; pin that deliberately retained state.
		expect(sessionStorage.getItem(OIDC_PENDING_KEY)).toBe('true');
		expect(sessionStorage.getItem(OIDC_STATE_KEY)).toBe('nonce-123');
	});

	it('pins current behavior: empty tenant_id is stored as-is (risk R6 follow-up)', async () => {
		armOidcLogin('nonce-123');
		window.location.hash = '#token=jwt-value&state=nonce-123';

		render(<SamlCallback />);

		await waitFor(() => {
			expect(localStorage.getItem('token')).toBe(JSON.stringify({ token: 'jwt-value', tenant_id: '' }));
		});
	});
});
