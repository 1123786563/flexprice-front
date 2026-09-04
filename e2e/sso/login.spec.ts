import { expect, test } from '@playwright/test';

// The SSO profile has no shared storage state: every test walks the real flow.
test.use({ storageState: { cookies: [], origins: [] } });

test('SSO login lands on the dashboard with an authenticated API call', async ({ page }) => {
	await page.goto('/login');

	await page.getByRole('button', { name: /sso/i }).click();

	// Fake IdP auto-approves, so the browser chains:
	// authorize → backend callback → /auth/callback#fragment → home.
	await page.waitForURL((url) => !url.pathname.startsWith('/login') && !url.pathname.startsWith('/auth'), {
		timeout: 15_000,
	});

	// The callback page must scrub the fragment out of the URL.
	expect(page.url()).not.toContain('#token');

	// The stored session is the contract everything else reads.
	const stored = await page.evaluate(() => localStorage.getItem('token'));
	expect(stored).not.toBeNull();
	const parsed = JSON.parse(stored!) as { token: string; tenant_id: string };
	expect(parsed.token).not.toBe('local-openmeter-session'); // the shim token, not a real session
	expect(parsed.tenant_id).toBe('acme');

	// The dashboard actually gets data through the session token: wait for a
	// successful same-origin API response after login.
	const apiResponse = await page.waitForResponse(
		(resp) => resp.url().includes('/openmeter/') && resp.request().method() === 'GET' && resp.ok(),
		{ timeout: 15_000 },
	);
	expect(apiResponse.status()).toBe(200);
});

test('replaying the callback URL in a fresh tab is rejected', async ({ browser }) => {
	const context = await browser.newContext();
	const page = await context.newPage();

	// No sessionStorage in this tab: no pending marker, so the callback page
	// must refuse to adopt whatever the URL carries.
	await page.goto('/auth/callback#token=attacker-token&tenant_id=acme&state=forged');

	await page.waitForURL('**/auth/callback**');

	// page.goto resolving only proves the page loaded — the effect that rejects
	// the token runs after React mounts. Waiting for the rendered rejection
	// (sso.unsolicitedToken, en locale / fallback) pins that the refusal actually
	// happened before we inspect storage; otherwise a regression that ADOPTS the
	// token could still pass the null-localStorage assertion by racing it.
	await page.getByText('did not come from a sign-in you started').waitFor();

	const stored = await page.evaluate(() => localStorage.getItem('token'));
	expect(stored).toBeNull();

	await context.close();
});
