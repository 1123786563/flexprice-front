// src/api/WalletApi.ts
// 空态垫片：预付钱包（余额/交易/充值）为 Flexprice 结算域，OpenMeter OSS 无对应。
import { Wallet, RealtimeWalletBalance } from '@/models';
import {
	CreateWalletPayload,
	TopupWalletPayload,
	TopupWalletResponse,
	DebitWalletPayload,
	WalletTransactionResponse,
	WalletTransactionPayload,
	UpdateWalletRequest,
	WalletResponse,
	GetCustomerWalletsPayload,
	GetWalletTransactionsByFilterPayload,
	ListWalletsPayload,
	ListWalletsByFilterPayload,
	ListWalletsResponse,
} from '@/types/dto';
import { unsupportedLocalOperation } from '@/core/services/platform/localPlatform';

class WalletApi {
	static async getCustomerWallets(_data: GetCustomerWalletsPayload): Promise<Wallet[]> {
		return [];
	}

	static async getWalletTransactions({ limit = 10, offset = 0 }: WalletTransactionPayload): Promise<WalletTransactionResponse> {
		return { items: [], pagination: { limit, offset, total: 0 } };
	}

	static async getWalletBalance(_walletId: string): Promise<RealtimeWalletBalance> {
		unsupportedLocalOperation('获取钱包实时余额');
	}

	static async getWalletBalanceV2(_walletId: string): Promise<RealtimeWalletBalance> {
		unsupportedLocalOperation('获取钱包实时余额（v2）');
	}

	static async createWallet(_data: CreateWalletPayload): Promise<Wallet> {
		unsupportedLocalOperation('创建钱包');
	}

	static async topupWallet(_data: TopupWalletPayload): Promise<TopupWalletResponse> {
		unsupportedLocalOperation('钱包充值');
	}

	static async debitWallet(_data: DebitWalletPayload): Promise<Wallet> {
		unsupportedLocalOperation('钱包扣减');
	}

	static async terminateWallet(_walletId: string): Promise<void> {
		unsupportedLocalOperation('终止钱包');
	}

	static async updateWallet(_walletId: string, _data: UpdateWalletRequest): Promise<WalletResponse> {
		unsupportedLocalOperation('更新钱包');
	}

	static async getAllWalletTransactionsByFilter(payload: GetWalletTransactionsByFilterPayload): Promise<WalletTransactionResponse> {
		return { items: [], pagination: { limit: payload.limit ?? 0, offset: payload.offset ?? 0, total: 0 } };
	}

	static async listWallets(payload: ListWalletsPayload = {}): Promise<ListWalletsResponse> {
		return { items: [], pagination: { limit: payload.limit ?? 0, offset: payload.offset ?? 0, total: 0 } };
	}

	static async listWalletsByFilter(payload: ListWalletsByFilterPayload): Promise<ListWalletsResponse> {
		return { items: [], pagination: { limit: payload.limit ?? 0, offset: payload.offset ?? 0, total: 0 } };
	}
}

export default WalletApi;
