import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// Polyfill ResizeObserver for jsdom (used by Sheet and other components)
global.ResizeObserver = class ResizeObserver {
	observe() {}
	unobserve() {}
	disconnect() {}
};

// Node ≥22 ships an experimental `localStorage` global that stays undefined without
// --localstorage-file; it shadows jsdom's working storage inside vitest. Rebind an
// in-memory implementation when the global resolves to nothing.
if (typeof globalThis.localStorage === 'undefined') {
	let store: Record<string, string> = {};
	Object.defineProperty(globalThis, 'localStorage', {
		configurable: true,
		value: {
			getItem: (key: string) => (key in store ? store[key] : null),
			setItem: (key: string, value: string) => {
				store[key] = String(value);
			},
			removeItem: (key: string) => {
				delete store[key];
			},
			clear: () => {
				store = {};
			},
			key: (index: number) => Object.keys(store)[index] ?? null,
			get length() {
				return Object.keys(store).length;
			},
		},
	});
}

// Cleanup after each test
afterEach(() => {
	cleanup();
});
