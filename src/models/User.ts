export interface User {
	id: string;
	tenant: {
		id: string;
		name: string;
		billing_details: {
			address: {
				address_line1: string;
				address_line2: string;
				address_city: string;
				address_state: string;
				address_postal_code: string;
				address_country: string;
			};
		};
		status: string;
		created_at: string;
		updated_at: string;
		/** 后端实际返回（DefaultRoute 读取 onboarding_completed）；类型早前缺失。 */
		metadata?: Record<string, string>;
	};
	email: string;
	name?: string;
	type?: 'user' | 'service_account';
	roles?: string[];
	metadata?: Record<string, string>;
}
