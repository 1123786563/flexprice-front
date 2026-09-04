// src/api/EnvironmentApi.ts
// 本地环境垫片：OpenMeter 单命名空间即单环境，读返回固定环境；
// waitForActiveEnvironment 机制保持不变（axios 环境头门禁在业务模块全量脱离 axios 后已无调用方，
// 但保留以免隐性依赖）。环境的增/改/克隆在本地模式明确报错。
import { ACTIVE_ENVIRONMENT_ID_KEY } from '@/hooks/useEnvironment';
import { Environment } from '@/models';
import {
	CloneEnvironmentPayload,
	CloneEnvironmentResponse,
	CreateEnvironmentPayload,
	ListEnvironmentResponse,
	UpdateEnvironmentPayload,
} from '@/types/dto';
import { getLocalEnvironments, unsupportedLocalOperation } from '@/core/services/platform/localPlatform';

// Resolved the first time an active environment ID is known — either because it was already
// in localStorage (e.g. on a refresh, from a prior session) or because useEnvironment() just
// picked a default after its own /environments fetch resolved.
//
// Built lazily (not at module load) so importing this module never itself touches
// localStorage or the ACTIVE_ENVIRONMENT_ID_KEY export up front — tests that mock
// useEnvironment without re-exporting that constant would otherwise crash on import.
let resolveEnvReady: (() => void) | null = null;
let envReadyPromise: Promise<void> | null = null;
function getEnvReadyPromise(): Promise<void> {
	if (!envReadyPromise) {
		envReadyPromise = localStorage.getItem(ACTIVE_ENVIRONMENT_ID_KEY)
			? Promise.resolve()
			: new Promise((resolve) => {
					resolveEnvReady = resolve;
				});
	}
	return envReadyPromise;
}

class EnvironmentApi {
	public static async getAllEnvironments(): Promise<ListEnvironmentResponse> {
		const environments = getLocalEnvironments();
		return await Promise.resolve<ListEnvironmentResponse>({
			environments,
			limit: environments.length,
			offset: 0,
			total: environments.length,
		});
	}

	public static async getEnvironmentById(id: string): Promise<Environment | null> {
		return await Promise.resolve(getLocalEnvironments().find((env) => env.id === id) ?? null);
	}

	public static async createEnvironment(_payload: CreateEnvironmentPayload): Promise<Environment | null> {
		unsupportedLocalOperation('创建环境');
	}

	public static async cloneEnvironment(_sourceEnvironmentId: string, _payload: CloneEnvironmentPayload): Promise<CloneEnvironmentResponse> {
		unsupportedLocalOperation('克隆环境');
	}

	public static async updateEnvironment(_id: string, _payload: UpdateEnvironmentPayload): Promise<Environment | null> {
		unsupportedLocalOperation('编辑环境');
	}

	public static getActiveEnvironmentId(): string | null {
		return localStorage.getItem(ACTIVE_ENVIRONMENT_ID_KEY);
	}

	public static setActiveEnvironmentId(environmentId: string): void {
		localStorage.setItem(ACTIVE_ENVIRONMENT_ID_KEY, environmentId);
		resolveEnvReady?.();
		resolveEnvReady = null;
	}

	/** Resolves once an active environment ID is known, or after `timeoutMs` — whichever
	 *  comes first, so a tenant with zero environments (or a slow/failed fetch) doesn't
	 *  block every request indefinitely. */
	public static waitForActiveEnvironment(timeoutMs = 5000): Promise<void> {
		return Promise.race([getEnvReadyPromise(), new Promise<void>((resolve) => setTimeout(resolve, timeoutMs))]);
	}
}

export default EnvironmentApi;
