// src/core/services/openmeter/omFetch.ts
// Thin typed fetch for management APIs the npm SDK (@openmeter/sdk beta.232) does
// not cover yet: tax codes, customer credits, charges, LLM cost, custom currencies,
// feature unit-cost updates, notification rule test, portal tokens, subscription
// restore. Mirrors the SDK's wire conventions — same baseUrl (vite /openmeter
// proxy), Bearer session token, JSON bodies — so requests behave identically to
// SDK calls and reuse the same auth and proxy paths.
import { config } from '@/config/config';
import AuthService from '@/core/auth/AuthService';

/** Error carrying the HTTP status and the server-provided detail, for toast surfaces. */
export class OmHttpError extends Error {
	public readonly status: number;

	constructor(status: number, message: string) {
		super(message);
		this.status = status;
	}
}

function resolveToken(): string | null {
	return AuthService.peekStoredToken() ?? (config.openmeter.apiKey || null);
}

export interface OmRequestInit {
	method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
	/** JSON-serializable request body; sent as application/json. */
	body?: unknown;
	query?: Record<string, string | number | boolean | undefined>;
}

async function omFetch<T>(path: string, init: OmRequestInit): Promise<T> {
	const token = resolveToken();
	const url = new URL(`${config.openmeter.baseUrl}${path}`, window.location.origin);
	if (init.query) {
		for (const [key, value] of Object.entries(init.query)) {
			if (value !== undefined) url.searchParams.set(key, String(value));
		}
	}

	const response = await fetch(url.toString(), {
		method: init.method ?? 'GET',
		headers: {
			...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
			...(token ? { Authorization: `Bearer ${token}` } : {}),
		},
		body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
	});

	if (!response.ok) {
		let detail = `${response.status} ${response.statusText}`;
		try {
			const payload = (await response.json()) as { detail?: string; message?: string; title?: string };
			detail = payload.detail ?? payload.message ?? payload.title ?? detail;
		} catch {
			// non-JSON error body — keep the status-text fallback
		}
		throw new OmHttpError(response.status, detail);
	}
	if (response.status === 204) return undefined as T;
	return (await response.json()) as T;
}

/** v3 management API (`/api/v3/openmeter/...`) — the TypeSpec surface. */
export function omV3<T>(path: string, init: OmRequestInit = {}): Promise<T> {
	return omFetch<T>(`/api/v3/openmeter${path}`, init);
}

/** Legacy v1 API (`/api/v1/...`) — still the only surface for some domains. */
export function omV1<T>(path: string, init: OmRequestInit = {}): Promise<T> {
	return omFetch<T>(`/api/v1${path}`, init);
}
