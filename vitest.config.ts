import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
	test: {
		globals: true,
		environment: 'jsdom',
		environmentOptions: {
			jsdom: {
				// Without an explicit URL jsdom uses an opaque origin, where localStorage is
				// unavailable ("localStorage is not available for opaque origins").
				url: 'http://localhost:3000',
			},
		},
		env: {
			// Reset white-label overrides so brand config tests assert against Flexprice defaults.
			// Individual tests use vi.stubEnv() to set specific values.
			VITE_BRAND_CONFIG: '{}',
			VITE_AUTH_CONFIG: '{}',
			VITE_DEFAULT_LOCALE: 'en',
		},
		include: ['src/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
		setupFiles: ['./src/tests/setup.ts'],
		coverage: {
			provider: 'v8',
			reporter: ['text', 'json', 'html'],
			exclude: ['node_modules/', 'src/tests/setup.ts'],
		},
	},
	plugins: [react()],
	resolve: {
		alias: {
			'@': path.resolve(__dirname, './src'),
		},
	},
});
