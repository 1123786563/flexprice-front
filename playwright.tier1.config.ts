import { defineConfig } from '@playwright/test';

// Tier-1 对接验收专用配置：复用 casdoor 登录流程（backend :8888 + Casdoor :8001 + front :3005）。
export default defineConfig({
	testDir: './e2e',
	testMatch: /tier1-integrations\.spec\.ts/,
	timeout: 600_000,
	retries: 0,
	// 本地后端（go+air + 本地 Kafka/ClickHouse）吞吐有限：串行跑避免互相拖慢
	workers: 1,
	reporter: [['list']],
	outputDir: '/tmp/pw-tier1-results',
	use: {
		baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3005',
		trace: 'retain-on-failure',
		screenshot: 'only-on-failure',
	},
});
