import { chromium } from '@playwright/test';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.setDefaultTimeout(30000);
try {
	await page.goto('http://localhost:3000/login', { waitUntil: 'domcontentloaded' });
	await page.getByLabel('Email', { exact: true }).waitFor();
	await page.getByLabel('Email', { exact: true }).fill('admin@openmeter.local');
	await page.getByLabel('Password', { exact: true }).fill('openmeter');
	await page.getByRole('button', { name: 'Login', exact: true }).click();
	await page.waitForURL(/\/home/, { timeout: 30000 });
	// Settings → Notifications tab
	await page.goto('http://localhost:3000/settings', { waitUntil: 'domcontentloaded' });
	await page.getByText('Notifications', { exact: false }).first().click();
	await page.waitForTimeout(2500);
	const body = await page.locator('body').innerText();
	const pass = /webhook/i.test(body) && /noop/i.test(body);
	console.log(pass ? 'PASS notifications tab renders (channels + oss notice)' : `FAIL body: ${body.slice(0, 300)}`);
	await page.screenshot({ path: '/tmp/om-e2e/opt-notifications.png' });
} catch (e) {
	console.log('FAIL', String(e).slice(0, 200));
} finally {
	await browser.close();
}
