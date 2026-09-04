import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ComponentPropsWithoutRef } from 'react';

const navigateMock = vi.fn();

vi.mock('react-router', () => ({ useNavigate: () => navigateMock }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

// The atoms barrel re-exports ErrorBoundary, which imports @/core/routes/Routes
// — a module that builds the whole app router at import time and drags in
// posthog-js, whose top-level code reads window.location. Stub the Button so
// the module graph under test stays on config (the only thing this test's
// vi.resetModules/vi.stubEnv re-evaluation needs to reach).
vi.mock('@/components/atoms', () => ({
	Button: ({ variant, ...props }: ComponentPropsWithoutRef<'button'> & { variant?: string }) => <button type='button' {...props} />,
}));

// jsdom cannot navigate; replace location with a writable stub to capture the
// full-page redirect the component performs.
const originalLocation = window.location;

describe('OidcSignin', () => {
	beforeEach(() => {
		vi.resetModules();
		vi.stubEnv('VITE_OIDC_LOGIN_URL', 'http://backend.test/auth/oidc/login');
		sessionStorage.clear();

		// @ts-expect-error -- jsdom navigation is not implemented
		delete window.location;
		window.location = { href: '' } as unknown as Location;
	});

	afterEach(() => {
		window.location = originalLocation;
		vi.unstubAllEnvs();
	});

	it('stores a fresh nonce and redirects to the backend login', async () => {
		const { default: OidcSignin } = await import('./OidcSignin');

		render(<OidcSignin />);
		await userEvent.click(screen.getByRole('button'));

		const nonce = sessionStorage.getItem('oidc_login_state');
		expect(sessionStorage.getItem('oidc_login_pending')).toBe('true');
		expect(nonce).toMatch(/^[0-9a-f]{32}$/);
		expect(window.location.href).toBe('http://backend.test/auth/oidc/login?state=' + nonce);
	});

	it('generates a different nonce per click', async () => {
		const { default: OidcSignin } = await import('./OidcSignin');

		render(<OidcSignin />);
		await userEvent.click(screen.getByRole('button'));
		const first = sessionStorage.getItem('oidc_login_state');
		await userEvent.click(screen.getByRole('button'));
		const second = sessionStorage.getItem('oidc_login_state');

		expect(first).not.toEqual(second);
	});
});
