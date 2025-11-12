import type { SolanaClient } from '@solana/client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import useSWR, { type BareFetcher, type SWRConfiguration, type SWRResponse } from 'swr';

import { useSolanaClient } from './context';
import { useClientStore } from './useClientStore';

const QUERY_NAMESPACE = '@solana/react-hooks';

export type QueryStatus = 'error' | 'idle' | 'loading' | 'success';

export type UseSolanaRpcQueryOptions<Data> = Omit<SWRConfiguration<Data, unknown, BareFetcher<Data>>, 'fallback'> &
	Readonly<{
		disabled?: boolean;
	}>;

export type SolanaQueryResult<Data> = Readonly<{
	data: Data | undefined;
	dataUpdatedAt?: number;
	error: unknown;
	isError: boolean;
	isLoading: boolean;
	isSuccess: boolean;
	isValidating: boolean;
	mutate: SWRResponse<Data>['mutate'];
	refresh(): Promise<Data | undefined>;
	status: QueryStatus;
}>;

export function useSolanaRpcQuery<Data>(
	scope: string,
	args: readonly unknown[],
	fetcher: (client: SolanaClient) => Promise<Data>,
	options: UseSolanaRpcQueryOptions<Data> = {},
): SolanaQueryResult<Data> {
	const client = useSolanaClient();
	const cluster = useClientStore((state) => state.cluster);
	const disabled = options.disabled ?? false;
	const swrOptions: SWRConfiguration<Data, unknown, BareFetcher<Data>> = { ...options };
	delete (swrOptions as { disabled?: boolean }).disabled;

	const key = useMemo(() => {
		if (disabled) {
			return null;
		}
		return [QUERY_NAMESPACE, scope, cluster.endpoint, cluster.commitment, ...args] as const;
	}, [cluster.commitment, cluster.endpoint, args, scope, disabled]);

	const swr = useSWR<Data>(key, () => fetcher(client), swrOptions);
	const [dataUpdatedAt, setDataUpdatedAt] = useState<number | undefined>(() =>
		swr.data !== undefined ? Date.now() : undefined,
	);

	useEffect(() => {
		if (swr.data !== undefined) {
			setDataUpdatedAt(Date.now());
		}
	}, [swr.data]);

	const status: QueryStatus = swr.error
		? 'error'
		: swr.isLoading
			? 'loading'
			: swr.data !== undefined
				? 'success'
				: 'idle';

	const refresh = useCallback(() => swr.mutate(undefined, { revalidate: true }), [swr.mutate]);

	return {
		data: swr.data,
		dataUpdatedAt,
		error: swr.error ?? null,
		isError: status === 'error',
		isLoading: swr.isLoading,
		isSuccess: status === 'success',
		isValidating: swr.isValidating,
		mutate: swr.mutate,
		refresh,
		status,
	};
}
