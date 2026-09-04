import { beforeEach, describe, expect, it, vi } from 'vitest';
import { config } from '@/config/config';
import { ingestUsageEvents, requireOpenMeterClient, resolveUsageSubject, UsageEventInput } from './index';

const mocks = vi.hoisted(() => ({
	ingest: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@openmeter/sdk', () => ({
	OpenMeter: class {
		events = { ingest: mocks.ingest };
		constructor(public clientConfig: unknown) {}
	},
}));

const fakeClient = { events: { ingest: mocks.ingest } } as never;

describe('resolveUsageSubject', () => {
	beforeEach(() => {
		localStorage.clear();
	});

	it('prefers the user id, then email, then tenant id', () => {
		localStorage.setItem('user', JSON.stringify({ id: 'u-1', email: 'a@b.c', tenant: { id: 't-1' } }));
		expect(resolveUsageSubject()).toBe('u-1');

		localStorage.setItem('user', JSON.stringify({ email: 'a@b.c', tenant: { id: 't-1' } }));
		expect(resolveUsageSubject()).toBe('a@b.c');

		localStorage.setItem('user', JSON.stringify({ tenant: { id: 't-1' } }));
		expect(resolveUsageSubject()).toBe('t-1');
	});

	it('falls back to anonymous when logged out or payload is corrupt', () => {
		expect(resolveUsageSubject()).toBe('anonymous');

		localStorage.setItem('user', 'not-json');
		expect(resolveUsageSubject()).toBe('anonymous');
	});
});

describe('ingestUsageEvents', () => {
	beforeEach(() => {
		mocks.ingest.mockClear();
		localStorage.clear();
	});

	it('maps inputs to CloudEvents 1.0 payloads and batches them into one ingest call', async () => {
		localStorage.setItem('user', JSON.stringify({ id: 'u-42' }));
		const inputs: UsageEventInput[] = [
			{ type: 'mcp_calls', data: { tool: 'get_flexprice_app_info' } },
			{ type: 'llm_input_tokens', value: 250, subject: 'customer-7' },
		];

		await ingestUsageEvents(inputs, fakeClient);

		expect(mocks.ingest).toHaveBeenCalledTimes(1);
		const events = mocks.ingest.mock.calls[0][0];
		expect(events).toHaveLength(2);

		const [first, second] = events;
		expect(first).toMatchObject({
			specversion: '1.0',
			type: 'mcp_calls',
			subject: 'u-42',
			source: 'http://localhost:3000',
			data: { value: 1, tool: 'get_flexprice_app_info' },
		});
		expect(typeof first.id).toBe('string');
		expect(first.id).toBeTruthy();
		expect(() => new Date(first.time).toISOString()).not.toThrow();

		expect(second).toMatchObject({
			type: 'llm_input_tokens',
			subject: 'customer-7',
			data: { value: 250 },
		});
	});

	it('does nothing when there are no inputs', async () => {
		await ingestUsageEvents([], fakeClient);
		expect(mocks.ingest).not.toHaveBeenCalled();
	});

	it('does nothing when OpenMeter is disabled', async () => {
		const original = config.openmeter.enabled;
		config.openmeter.enabled = false;
		try {
			await ingestUsageEvents([{ type: 'mcp_calls' }], fakeClient);
		} finally {
			config.openmeter.enabled = original;
		}
		expect(mocks.ingest).not.toHaveBeenCalled();
	});

	it('swallows ingest failures so telemetry never breaks the caller', async () => {
		mocks.ingest.mockRejectedValueOnce(new Error('backend down'));
		const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		try {
			await expect(ingestUsageEvents([{ type: 'mcp_calls' }], fakeClient)).resolves.toBeUndefined();
		} finally {
			consoleWarn.mockRestore();
		}
	});
});

describe('requireOpenMeterClient', () => {
	it('returns the shared client when enabled', () => {
		const client = requireOpenMeterClient();
		expect(client).toBeTruthy();
	});

	it('throws with the enabling env var name when disabled', () => {
		const original = config.openmeter.enabled;
		config.openmeter.enabled = false;
		try {
			expect(() => requireOpenMeterClient()).toThrowError(/VITE_OPENMETER_ENABLED/);
		} finally {
			config.openmeter.enabled = original;
		}
	});
});
