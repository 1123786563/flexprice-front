import { describe, it, expect, beforeEach } from 'vitest';
import AuthApi from '@/api/AuthApi';
import UserApi from '@/api/UserApi';
import EnvironmentApi from '@/api/EnvironmentApi';
import RbacApi, { SUPER_ADMIN_ROLE_ID } from '@/api/RbacApi';
import TenantApi from '@/api/TenantApi';
import { LOCAL_TENANT_ID, LOCAL_USER_ID, LOCAL_ENVIRONMENT_ID } from '@/core/services/platform/localPlatform';

describe('本地平台垫片（启动硬门禁链）', () => {
	beforeEach(() => {
		localStorage.clear();
	});

	it('AuthApi.Login 任意账密返回合成 token（LoginForm 据此写 localStorage 并跳转）', async () => {
		const session = await AuthApi.Login('admin@openmeter.local', 'whatever');
		expect(session).toEqual({
			token: 'local-openmeter-session',
			user_id: LOCAL_USER_ID,
			tenant_id: LOCAL_TENANT_ID,
		});
	});

	it('UserApi.me 返回 super_admin 且 tenant.metadata.onboarding_completed=true（直接进 dashboard）', async () => {
		await AuthApi.Login('admin@openmeter.local', 'x');
		const me = await UserApi.me();
		expect(me.id).toBe(LOCAL_USER_ID);
		expect(me.roles).toEqual(['super_admin']);
		expect(me.tenant.id).toBe(LOCAL_TENANT_ID);
		expect(me.tenant.metadata?.onboarding_completed).toBe('true');
		expect(me.email).toBe('admin@openmeter.local');
	});

	it('EnvironmentApi.getAllEnvironments 返回唯一 OpenMeter 环境', async () => {
		const res = await EnvironmentApi.getAllEnvironments();
		expect(res.environments).toHaveLength(1);
		expect(res.environments[0].id).toBe(LOCAL_ENVIRONMENT_ID);
	});

	it('RbacApi.getAllRoles 返回 super_admin 通配角色（RouteGuard 全放行）', async () => {
		const roles = await RbacApi.getAllRoles('user');
		const superAdmin = roles.find((r) => r.id === SUPER_ADMIN_ROLE_ID);
		expect(superAdmin?.permissions).toEqual({ '*': ['*'] });
	});

	it('TenantApi 读/写本地租户，metadata 浅合并（onboarding 提交通路）', async () => {
		const before = await TenantApi.getTenantById(LOCAL_TENANT_ID);
		expect(before.metadata.onboarding_completed).toBe('true');

		await TenantApi.updateTenant({ metadata: { onboarding_completed: 'true', company: 'Acme' } });
		const after = await TenantApi.getTenantById(LOCAL_TENANT_ID);
		expect(after.metadata.company).toBe('Acme');
		expect(after.metadata.onboarding_completed).toBe('true');
	});

	it('成员管理写操作明确报错而非假数据', async () => {
		await expect(UserApi.createUser({ email: 'a@b.c' } as never)).rejects.toThrow(/不支持/);
		await expect(UserApi.removeUserFromTenant('x')).rejects.toThrow(/不支持/);
	});

	it('getTenantMembers 只有本地管理员一个账户', async () => {
		const members = await UserApi.getTenantMembers({ limit: 10, offset: 0 });
		expect(members.items).toHaveLength(1);
		expect(members.pagination?.total).toBe(1);
	});
});
