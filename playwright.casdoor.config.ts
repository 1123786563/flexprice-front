import { defineConfig } from '@playwright/test';

// Standalone config for the Casdoor SSO end-to-end test: expects the full
// stack already running (backend :8888 with AUTH_OIDC_*, front :3005 with
// VITE_OIDC_LOGIN_URL, Casdoor :8001).
export default defineConfig({
	testDir: './e2e',
	testMatch: /sso-casdoor\.spec\.ts/,
	timeout: 90_000,
	retries: 0,
	reporter: [['list']],
	outputDir: '/tmp/pw-casdoor-results',
	use: {
		baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3005',
		trace: 'retain-on-failure',
		screenshot: 'only-on-failure',
	},
});
