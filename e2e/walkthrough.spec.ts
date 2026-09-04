import { expect, test } from '@playwright/test';

// End-to-end walkthrough against the source-built stack:
// vite (front) --/openmeter proxy--> OpenMeter backend (Go, :8888).
// Self-hosted mode signs in with the local session shim; everything after
// login is real: the dashboard must fetch data from the actual backend.

test.use({ storageState: { cookies: [], origins: [] } });

test('login lands on the dashboard and loads real data from the OpenMeter backend', async ({ page }) => {
	const backendCalls: string[] = [];

	// given the signed-out browser opens the login page
	await page.goto('/login');
	await expect(page).toHaveURL(/\/login$/);
	await expect(page.locator('#email')).toBeVisible();

	// when signing in with the local (self-hosted) session
	await page.locator('#email').fill('admin@example.com');
	await page.locator('#password').fill('password');

	page.on('response', (resp) => {
		if (resp.url().includes('/openmeter/') && resp.ok()) {
			backendCalls.push(`${resp.request().method()} ${new URL(resp.url()).pathname} -> ${resp.status()}`);
		}
	});

	await page.locator('form button').last().click();

	// then the app leaves the login page and stores the session
	await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 30_000 });

	await expect.poll(() => page.evaluate(() => localStorage.getItem('token')), { timeout: 15_000 }).not.toBeNull();

	// and the dashboard fetches real data through the /openmeter proxy
	await expect.poll(() => backendCalls.length, { timeout: 30_000 }).toBeGreaterThan(0);

	// and the app renders a signed-in shell (sidebar nav present)
	await expect(page.locator('aside, nav').first()).toBeVisible();

	await page.screenshot({ path: '/tmp/walkthrough-dashboard.png', fullPage: false });

	// log the backend calls that proved the round-trip
	console.log('backend calls via proxy:', JSON.stringify(backendCalls, null, 2));
	expect(backendCalls.length).toBeGreaterThan(0);
});

test('backend is actually the source-built OpenMeter (meters API answers through the proxy)', async ({ request }) => {
	const resp = await request.get('/openmeter/api/v1/meters');
	expect(resp.status()).toBe(200);
	const body = (await resp.json()) as unknown;
	expect(Array.isArray(body)).toBe(true);
});
