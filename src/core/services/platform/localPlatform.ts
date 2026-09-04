// src/core/services/platform/localPlatform.ts
// 本地平台垫片：OpenMeter OSS 后端没有 Flexprice 的用户/租户/环境/RBAC 体系，
// 这里以确定性本地数据满足前端启动链（login → /users/me → /environments → /rbac/roles → onboarding）。
// 状态仅两处可变：租户元数据（onboarding 进度）与登录邮箱，持久化在 localStorage，
// 登出（AuthService.logout 会 localStorage.clear()）后自然复位。
import { User, ENTITY_STATUS } from '@/models';
import type { TenantAddress, TenantBillingDetails } from '@/models/Tenant';
import type { RbacRole } from '@/api/RbacApi';
import type { Environment } from '@/models';
import { ENVIRONMENT_TYPE } from '@/models/Environment';

export const LOCAL_USER_ID = 'local-openmeter-admin';
export const LOCAL_TENANT_ID = 'openmeter-local';
export const LOCAL_ENVIRONMENT_ID = 'openmeter';
export const LOCAL_SESSION_TOKEN = 'local-openmeter-session';

const TENANT_STORAGE_KEY = 'openmeter_local_tenant';
const EMAIL_STORAGE_KEY = 'openmeter_local_email';

const EMPTY_ADDRESS: TenantAddress = {
	address_line1: '',
	address_line2: '',
	address_city: '',
	address_state: '',
	address_postal_code: '',
	address_country: '',
};

const DEFAULT_BILLING_DETAILS: TenantBillingDetails = {
	address: EMPTY_ADDRESS,
	email: 'admin@openmeter.local',
	help_email: '',
	phone: '',
};

interface LocalTenantState {
	name: string;
	billing_details: TenantBillingDetails;
	metadata: Record<string, string>;
}

function defaultTenantState(): LocalTenantState {
	return {
		name: 'OpenMeter',
		billing_details: DEFAULT_BILLING_DETAILS,
		// onboarding_completed 预置 'true'：本地单管理员模式没有团队 onboarding 流程，
		// DefaultRoute 据此直接放行进入 dashboard；/onboarding 页面的提交仍可改写该值。
		metadata: { onboarding_completed: 'true' },
	};
}

function readTenantState(): LocalTenantState {
	try {
		const raw = localStorage.getItem(TENANT_STORAGE_KEY);
		if (raw) {
			const parsed = JSON.parse(raw) as Partial<LocalTenantState>;
			return { ...defaultTenantState(), ...parsed, metadata: { ...parsed.metadata } };
		}
	} catch {
		// corrupted payload — fall through to defaults
	}
	return defaultTenantState();
}

function writeTenantState(state: LocalTenantState): void {
	localStorage.setItem(TENANT_STORAGE_KEY, JSON.stringify(state));
}

/** 登录成功后记住邮箱（/users/me 与成员列表的唯一来源）。 */
export function rememberLoginEmail(email: string): void {
	if (email) localStorage.setItem(EMAIL_STORAGE_KEY, email);
}

export function getLoginEmail(): string {
	return localStorage.getItem(EMAIL_STORAGE_KEY) ?? 'admin@openmeter.local';
}

/** 本地租户视图（Tenant 模型无 id 字段，按模型形状返回）。 */
export function getLocalTenant() {
	const state = readTenantState();
	return {
		name: state.name,
		billing_details: state.billing_details,
		status: ENTITY_STATUS.PUBLISHED,
		metadata: state.metadata,
	};
}

/** 浅合并更新本地租户（name / billing_details / metadata），返回更新后的租户。入参字段全部可选可空（Flexprice UpdateTenantPayload 的宽松形状）。 */
export function updateLocalTenant(patch: {
	name?: string;
	billing_details?: { address?: Partial<TenantAddress>; email?: string; help_email?: string; phone?: string };
	metadata?: Record<string, string>;
}) {
	const state = readTenantState();
	const next: LocalTenantState = {
		name: patch.name ?? state.name,
		billing_details: patch.billing_details
			? {
					...state.billing_details,
					...patch.billing_details,
					address: { ...state.billing_details.address, ...patch.billing_details.address },
				}
			: state.billing_details,
		metadata: { ...state.metadata, ...patch.metadata },
	};
	writeTenantState(next);
	return getLocalTenant();
}

/** /users/me：单管理员账户，tenant.metadata.onboarding_completed 驱动 DefaultRoute 分流。 */
export function getLocalUser(): User {
	const state = readTenantState();
	return {
		id: LOCAL_USER_ID,
		tenant: {
			id: LOCAL_TENANT_ID,
			name: state.name,
			billing_details: state.billing_details,
			status: 'published',
			created_at: '2026-09-04T00:00:00Z',
			updated_at: '2026-09-04T00:00:00Z',
			metadata: state.metadata,
		},
		email: getLoginEmail(),
		name: 'OpenMeter Admin',
		type: 'user',
		roles: ['super_admin'],
		metadata: {},
	};
}

/** 唯一环境：OpenMeter 单命名空间即单环境。 */
export function getLocalEnvironments(): Environment[] {
	return [
		{
			id: LOCAL_ENVIRONMENT_ID,
			name: 'OpenMeter',
			type: ENVIRONMENT_TYPE.PRODUCTION,
			created_at: '2026-09-04T00:00:00Z',
			updated_at: '2026-09-04T00:00:00Z',
		},
	];
}

/** super_admin 通配角色：RouteGuard 全放行。 */
export function getLocalRoles(): RbacRole[] {
	return [
		{
			id: 'super_admin',
			name: 'Super Admin',
			description: '本地 OpenMeter 管理员（全部权限）',
			permissions: { '*': ['*'] },
		},
	];
}

/** 明确报错：本地模式无成员/服务账户管理能力（OpenMeter OSS 无用户体系）。 */
export function unsupportedLocalOperation(operation: string): never {
	throw new Error(`OpenMeter 本地模式不支持「${operation}」：后端无对应的用户/租户管理能力`);
}
