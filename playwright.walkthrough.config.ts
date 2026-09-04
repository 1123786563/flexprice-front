import { defineConfig } from '@playwright/test';

// Standalone config for the local walkthrough: does not use the repo's
// projects/auth.setup, expects the stack already running (backend :8888,
// front dev server on E2E_BASE_URL, default :3005).
export default defineConfig({
	testDir: './e2e',
	testMatch: /walkthrough\.spec\.ts/,
	timeout: 60_000,
	retries: 0,
	reporter: [['list']],
	outputDir: '/tmp/pw-walkthrough-results',
	use: {
		baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3005',
		trace: 'retain-on-failure',
		screenshot: 'only-on-failure',
	},
});
