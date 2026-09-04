// src/api/AuthApi.ts
// 本地登录垫片：OpenMeter OSS 无用户体系，self-hosted 登录表单任意邮箱+密码即可进入，
// 返回合成 token 供 LoginForm 写入 localStorage（后续 /users/me 同样走本地垫片）。
import { LoginData, LocalUser, SignupData } from '@/types/dto';
import { LOCAL_SESSION_TOKEN, LOCAL_TENANT_ID, LOCAL_USER_ID, rememberLoginEmail } from '@/core/services/platform/localPlatform';

class AuthApi {
	public static async Login(email: string, _password: string) {
		rememberLoginEmail(email);
		return await Promise.resolve<LocalUser>({
			token: LOCAL_SESSION_TOKEN,
			user_id: LOCAL_USER_ID,
			tenant_id: LOCAL_TENANT_ID,
		});
	}

	public static async Signup(data: SignupData) {
		rememberLoginEmail(data.email);
		return await Promise.resolve<LocalUser>({
			token: LOCAL_SESSION_TOKEN,
			user_id: LOCAL_USER_ID,
			tenant_id: LOCAL_TENANT_ID,
		});
	}

	public static async Logout() {
		return await Promise.resolve();
	}

	public static async VerifyEmail(_token: string) {
		return await Promise.resolve();
	}

	public static async ResetPassword(_token: string, _newPassword: string) {
		return await Promise.resolve();
	}

	public static async ResendVerificationEmail(_email: string) {
		return await Promise.resolve();
	}
}

export default AuthApi;
export type { LoginData };
