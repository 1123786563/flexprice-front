// src/api/CouponApi.ts
// 空态垫片：优惠券（折扣/关联）为 Flexprice 计费域，OpenMeter OSS 无对应。
import { Coupon, Pagination } from '@/models';
import { CreateCouponRequest, UpdateCouponRequest, ListCouponsResponse, CouponFilter } from '@/types/dto';
import { CouponAssociationFilter, ListCouponAssociationsResponse } from '@/types/dto/CouponAssociation';
import { unsupportedLocalOperation } from '@/core/services/platform/localPlatform';

class CouponApi {
	public static async createCoupon(_payload: CreateCouponRequest): Promise<Coupon> {
		unsupportedLocalOperation('创建优惠券');
	}

	public static async getCouponById(_id: string): Promise<Coupon> {
		unsupportedLocalOperation('获取优惠券详情');
	}

	public static async updateCoupon(_id: string, _payload: UpdateCouponRequest): Promise<Coupon> {
		unsupportedLocalOperation('更新优惠券');
	}

	public static async deleteCoupon(_id: string): Promise<void> {
		unsupportedLocalOperation('删除优惠券');
	}

	public static async getAllCoupons({ limit = 10, offset = 0 }: Pagination): Promise<ListCouponsResponse> {
		return { items: [], pagination: { limit, offset, total: 0 } };
	}

	public static async getCouponsByFilters(payload: CouponFilter): Promise<ListCouponsResponse> {
		return { items: [], pagination: { limit: payload.limit ?? 0, offset: payload.offset ?? 0, total: 0 } };
	}

	public static async listCouponAssociations(filter?: CouponAssociationFilter): Promise<ListCouponAssociationsResponse> {
		return { items: [], pagination: { limit: filter?.limit ?? 0, offset: filter?.offset ?? 0, total: 0 } };
	}
}

export default CouponApi;
