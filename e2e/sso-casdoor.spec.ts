import { expect, test } from '@playwright/test';

// End-to-end: opening the front-end while the backend enforces Casdoor
// authentication must auto-redirect the browser to Casdoor, and a successful
// Casdoor login must land the user on the dashboard with a real session
// (every API call authenticated, no manual SSO-button click).

test.use({ storageState: { cookies: [], origins: [] } });

test('opening the app redirects to Casdoor and the login lands on an authenticated dashboard', async ({ page }) => {
	const backendCalls: Array<{ path: string; status: number }> = [];

	page.on('response', (resp) => {
		if (resp.url().includes('/openmeter/api/')) {
			backendCalls.push({ path: new URL(resp.url()).pathname, status: resp.status() });
		}
	});

	// when the app is opened signed-out
	await page.goto('/');

	// then the browser is handed to the Casdoor login page through the
	// backend's OIDC login endpoint (auto-redirect, no button click)
	await page.waitForURL(/127\.0\.0\.1:8001\/login\/oauth\/authorize/, { timeout: 30_000 });

	// and signing in on Casdoor (org default user)
	await page.locator('#username').waitFor({ state: 'visible', timeout: 30_000 });
	await page.locator('#username').fill('e2e');
	await page.locator('#password').fill('e2e-password');
	await page.getByRole('button', { name: /sign\s?in/i }).click();

	// then the round trip lands back in the app, signed in
	await page.waitForURL(
		(url) => {
			const s = url.toString();
			return s.startsWith('http://localhost:3005') && !s.includes('/auth') && !s.includes('/login');
		},
		{ timeout: 45_000 },
	);

	// and the stored session is a real backend session for the Casdoor org
	const stored = await page.evaluate(() => localStorage.getItem('token'));
	expect(stored).not.toBeNull();
	const session = JSON.parse(stored!) as { token: string; tenant_id: string };
	expect(session.token).not.toBe('local-openmeter-session');
	expect(session.tenant_id).toBe('default');

	// and the dashboard fetches data with the session token — no 401s
	await expect.poll(() => backendCalls.filter((c) => c.status === 200).length, { timeout: 30_000 }).toBeGreaterThan(0);
	expect(backendCalls.filter((c) => c.status === 401)).toEqual([]);

	console.log('authenticated backend calls:', JSON.stringify(backendCalls, null, 2));

	await page.screenshot({ path: '/tmp/casdoor-dashboard.png', fullPage: false });
});

test('opening the app again reuses the stored session without a new Casdoor round trip', async ({ browser }) => {
	// given a context that already completed the SSO login once
	const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
	const page = await context.newPage();

	await page.goto('/');
	await page.waitForURL(/127\.0\.0\.1:8001/, { timeout: 30_000 });
	await page.locator('#username').fill('e2e');
	await page.locator('#password').fill('e2e-password');
	await page.getByRole('button', { name: /sign\s?in/i }).click();
	await page.waitForURL((url) => url.toString().startsWith('http://localhost:3005') && !url.pathname.startsWith('/auth'), {
		timeout: 45_000,
	});

	// when the app is opened again in the same tab storage
	await page.goto('/');

	// then no Casdoor round trip happens: the app goes straight to the dashboard
	await page.waitForURL((url) => url.toString().startsWith('http://localhost:3005'), { timeout: 20_000 });
	expect(page.url()).not.toContain('127.0.0.1:8001');
	const stored = await page.evaluate(() => localStorage.getItem('token'));
	expect(stored).not.toBeNull();

	await context.close();
});
