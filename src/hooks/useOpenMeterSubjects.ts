// src/hooks/useOpenMeterSubjects.ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { config } from '@/config/config';
import { getOpenMeterClient, OpenMeterClient, requireOpenMeterClient } from '@/core/services/openmeter';
import useUser from './useUser';

export type OpenMeterSubject = NonNullable<Awaited<ReturnType<OpenMeterClient['subjects']['list']>>>[number];
export type SubjectUpsertInput = NonNullable<Parameters<OpenMeterClient['subjects']['upsert']>[0]>;

export const openMeterSubjectsKeys = {
	all: ['openmeter', 'subjects'] as const,
	detail: (idOrKey: string) => ['openmeter', 'subject', idOrKey] as const,
};

/** 列出 OpenMeter 中已注册的全部 subject。禁用时为空数组。 */
export function useOpenMeterSubjects() {
	return useQuery<OpenMeterSubject[]>({
		queryKey: openMeterSubjectsKeys.all,
		queryFn: async () => {
			const client = getOpenMeterClient();
			if (!client) return [];
			return (await client.subjects.list()) ?? [];
		},
		enabled: config.openmeter.enabled,
	});
}

/** 按 ID 或 key 取单个 subject；不存在（后端 404 → undefined）映射为 null 而非错误态。 */
export function useOpenMeterSubject(idOrKey: string) {
	return useQuery<OpenMeterSubject | null>({
		queryKey: openMeterSubjectsKeys.detail(idOrKey),
		queryFn: async () => {
			const client = getOpenMeterClient();
			if (!client) return null;
			return (await client.subjects.get(idOrKey)) ?? null;
		},
		enabled: config.openmeter.enabled && Boolean(idOrKey),
	});
}

/** 批量/单个 upsert：key 不存在则创建，存在则更新（后端要求 POST 数组，SDK 已处理单对象）。 */
export function useUpsertOpenMeterSubjects() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: async (subjects: SubjectUpsertInput) => (await requireOpenMeterClient().subjects.upsert(subjects)) ?? [],
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: openMeterSubjectsKeys.all });
		},
	});
}

export function useDeleteOpenMeterSubject() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: async (idOrKey: string) => {
			await requireOpenMeterClient().subjects.delete(idOrKey);
			return idOrKey;
		},
		onSuccess: (_data, idOrKey) => {
			void queryClient.invalidateQueries({ queryKey: openMeterSubjectsKeys.all });
			void queryClient.invalidateQueries({ queryKey: openMeterSubjectsKeys.detail(idOrKey) });
		},
	});
}

/**
 * 把当前登录的 Flexprice 用户注册为 OpenMeter subject（幂等 upsert），让计量表能按用户切片。
 * 未登录或 OpenMeter 禁用时无操作；失败只告警，不打断界面。
 */
export function useRegisterUsageSubject() {
	const { user } = useUser();
	const { mutate: upsertSubjects } = useUpsertOpenMeterSubjects();
	const subjectKey = user?.id;
	const displayName = user?.name || user?.email;

	useEffect(() => {
		if (!config.openmeter.enabled || !subjectKey) return;
		upsertSubjects(
			{ key: subjectKey, displayName },
			{ onError: (err) => console.warn('[openmeter] failed to register usage subject:', err) },
		);
	}, [subjectKey, displayName, upsertSubjects]);
}
