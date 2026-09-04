import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { config } from '@/config/config';

const mocks = vi.hoisted(() => ({
	list: vi.fn(),
	get: vi.fn(),
	create: vi.fn(),
	update: vi.fn(),
	delete: vi.fn(),
	publish: vi.fn(),
	archive: vi.fn(),
}));

vi.mock('@openmeter/sdk', () => ({
	OpenMeter: class {
		addons = { list: mocks.list, get: mocks.get, create: mocks.create, update: mocks.update, delete: mocks.delete, publish: mocks.publish, archive: mocks.archive };
		constructor(public clientConfig: unknown) {}
	},
}));

import {
	useArchiveOpenMeterAddon,
	useCreateOpenMeterAddon,
	useDeleteOpenMeterAddon,
	useOpenMeterAddon,
	useOpenMeterAddons,
	usePublishOpenMeterAddon,
	useUpdateOpenMeterAddon,
} from './useOpenMeterAddons';

const addon = { id: 'add-1', key: 'extra_sessions', name: 'Extra Sessions', createdAt: new Date(), updatedAt: new Date() };
const createInput = { key: 'extra_sessions', name: 'Extra Sessions' } as unknown as Parameters<typeof mocks.create>[0];

function setup() {
	const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
	const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
	const wrapper = function Wrapper({ children }: { children: ReactNode }) {
		return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
	};
	return { invalidateSpy, wrapper };
}

beforeEach(() => {
	Object.values(mocks).forEach((m) => m.mockReset());
});

describe('useOpenMeterAddons 读取', () => {
	it('返回 addons 分页数据', async () => {
		mocks.list.mockResolvedValueOnce({ items: [addon], totalCount: 1 });
		const { result } = renderHook(() => useOpenMeterAddons(), { wrapper: setup().wrapper });
		await waitFor(() => expect(result.current.isSuccess).toBe(true));
		expect(result.current.data).toEqual({ items: [addon], totalCount: 1 });
	});

	it('OpenMeter 禁用时不发请求', () => {
		const original = config.openmeter.enabled;
		config.openmeter.enabled = false;
		try {
			const { result } = renderHook(() => useOpenMeterAddons(), { wrapper: setup().wrapper });
			expect(result.current.data).toBeUndefined();
			expect(mocks.list).not.toHaveBeenCalled();
		} finally {
			config.openmeter.enabled = original;
		}
	});

	it('缺失的 addon 映射为 null', async () => {
		mocks.get.mockResolvedValueOnce(undefined);
		const { result } = renderHook(() => useOpenMeterAddon('ghost'), { wrapper: setup().wrapper });
		await waitFor(() => expect(result.current.isSuccess).toBe(true));
		expect(result.current.data).toBeNull();
	});
});

describe('useOpenMeterAddons 变更', () => {
	it('创建 addon 并失效列表', async () => {
		mocks.create.mockResolvedValueOnce(addon);
		const { invalidateSpy, wrapper } = setup();
		const { result } = renderHook(() => useCreateOpenMeterAddon(), { wrapper });
		result.current.mutate(createInput);
		await waitFor(() => expect(result.current.isSuccess).toBe(true));
		expect(mocks.create).toHaveBeenCalledWith(createInput);
		expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['openmeter', 'addons'] });
	});

	it('更新 addon 后失效列表 + 详情', async () => {
		mocks.update.mockResolvedValueOnce(addon);
		const { invalidateSpy, wrapper } = setup();
		const { result } = renderHook(() => useUpdateOpenMeterAddon(), { wrapper });
		result.current.mutate({ id: 'add-1', addon: { name: 'Renamed' } as never });
		await waitFor(() => expect(result.current.isSuccess).toBe(true));
		expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['openmeter', 'addon', 'add-1'] });
	});

	it('删除 addon 后失效列表 + 详情', async () => {
		mocks.delete.mockResolvedValueOnce(undefined);
		const { invalidateSpy, wrapper } = setup();
		const { result } = renderHook(() => useDeleteOpenMeterAddon(), { wrapper });
		result.current.mutate('add-1');
		await waitFor(() => expect(result.current.isSuccess).toBe(true));
		expect(mocks.delete).toHaveBeenCalledWith('add-1');
		expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['openmeter', 'addon', 'add-1'] });
	});

	it('publish/archive 生命周期变更调用对应端点', async () => {
		mocks.publish.mockResolvedValueOnce(addon);
		mocks.archive.mockResolvedValueOnce(addon);
		const { wrapper } = setup();
		const { result: publish } = renderHook(() => usePublishOpenMeterAddon(), { wrapper });
		publish.current.mutate('add-1');
		await waitFor(() => expect(publish.current.isSuccess).toBe(true));
		const { result: archive } = renderHook(() => useArchiveOpenMeterAddon(), { wrapper });
		archive.current.mutate('add-1');
		await waitFor(() => expect(archive.current.isSuccess).toBe(true));
		expect(mocks.publish).toHaveBeenCalledWith('add-1');
		expect(mocks.archive).toHaveBeenCalledWith('add-1');
	});
});
