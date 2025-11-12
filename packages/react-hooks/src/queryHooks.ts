import { type AddressLike, type SolanaClient, stableStringify, toAddress, toAddressString } from '@solana/client';
import {
	type Base64EncodedWireTransaction,
	type Commitment,
	getBase64EncodedWireTransaction,
	type SendableTransaction,
	type Transaction,
} from '@solana/kit';
import { useCallback, useMemo } from 'react';

import type { SolanaQueryResult, UseSolanaRpcQueryOptions } from './query';
import { useSolanaRpcQuery } from './query';

type RpcInstance = SolanaClient['runtime']['rpc'];

type LatestBlockhashPlan = ReturnType<RpcInstance['getLatestBlockhash']>;
type LatestBlockhashResponse = Awaited<ReturnType<LatestBlockhashPlan['send']>>;

type ProgramAccountsPlan = ReturnType<RpcInstance['getProgramAccounts']>;
type ProgramAccountsConfig = Parameters<RpcInstance['getProgramAccounts']>[1];
type ProgramAccountsResponse = Awaited<ReturnType<ProgramAccountsPlan['send']>>;

type SimulateTransactionPlan = ReturnType<RpcInstance['simulateTransaction']>;
type SimulateTransactionConfig = Parameters<RpcInstance['simulateTransaction']>[1];
type SimulateTransactionResponse = Awaited<ReturnType<SimulateTransactionPlan['send']>>;

const DEFAULT_BLOCKHASH_REFRESH_INTERVAL = 30_000;

export type UseLatestBlockhashOptions = Omit<UseSolanaRpcQueryOptions<LatestBlockhashResponse>, 'refreshInterval'> &
	Readonly<{
		commitment?: Commitment;
		minContextSlot?: bigint | number;
		refreshInterval?: number;
	}>;

export type LatestBlockhashQueryResult = SolanaQueryResult<LatestBlockhashResponse> &
	Readonly<{
		blockhash: string | null;
		contextSlot: bigint | null | undefined;
		lastValidBlockHeight: bigint | null;
	}>;

export function useLatestBlockhash(options: UseLatestBlockhashOptions = {}): LatestBlockhashQueryResult {
	const { commitment, minContextSlot, refreshInterval = DEFAULT_BLOCKHASH_REFRESH_INTERVAL, ...rest } = options;
	const normalizedMinContextSlot = useMemo<bigint | undefined>(() => {
		if (minContextSlot === undefined) {
			return undefined;
		}
		return typeof minContextSlot === 'bigint' ? minContextSlot : BigInt(Math.floor(minContextSlot));
	}, [minContextSlot]);
	const keyArgs = useMemo(
		() => [commitment ?? null, normalizedMinContextSlot ?? null],
		[commitment, normalizedMinContextSlot],
	);
	const fetcher = useCallback(
		async (client: SolanaClient) => {
			const fallbackCommitment = commitment ?? client.store.getState().cluster.commitment;
			const plan = client.runtime.rpc.getLatestBlockhash({
				commitment: fallbackCommitment,
				minContextSlot: normalizedMinContextSlot,
			});
			return plan.send({ abortSignal: AbortSignal.timeout(15_000) });
		},
		[commitment, normalizedMinContextSlot],
	);
	const query = useSolanaRpcQuery<LatestBlockhashResponse>('latestBlockhash', keyArgs, fetcher, {
		refreshInterval,
		...rest,
	});
	return {
		...query,
		blockhash: query.data?.value.blockhash ?? null,
		contextSlot: query.data?.context.slot,
		lastValidBlockHeight: query.data?.value.lastValidBlockHeight ?? null,
	};
}

export type UseProgramAccountsOptions = UseSolanaRpcQueryOptions<ProgramAccountsResponse> &
	Readonly<{
		commitment?: Commitment;
		config?: ProgramAccountsConfig;
	}>;

export type ProgramAccountsQueryResult = SolanaQueryResult<ProgramAccountsResponse> &
	Readonly<{
		accounts: ProgramAccountsResponse;
	}>;

export function useProgramAccounts(
	programAddress?: AddressLike,
	options: UseProgramAccountsOptions = {},
): ProgramAccountsQueryResult {
	const { commitment, config, ...queryOptions } = options;
	const address = useMemo(() => (programAddress ? toAddress(programAddress) : undefined), [programAddress]);
	const addressKey = useMemo(() => (address ? toAddressString(address) : null), [address]);
	const configKey = useMemo(() => stableStringify(config ?? null), [config]);
	const fetcher = useCallback(
		async (client: SolanaClient) => {
			if (!address) {
				throw new Error('Provide a program address before querying program accounts.');
			}
			const fallbackCommitment = commitment ?? config?.commitment ?? client.store.getState().cluster.commitment;
			const mergedConfig = {
				...(config ?? {}),
				commitment: fallbackCommitment,
			} satisfies ProgramAccountsConfig;
			const plan = client.runtime.rpc.getProgramAccounts(address, mergedConfig);
			return plan.send({ abortSignal: AbortSignal.timeout(20_000) });
		},
		[address, commitment, config],
	);
	const query = useSolanaRpcQuery<ProgramAccountsResponse>('programAccounts', [addressKey, configKey], fetcher, {
		...queryOptions,
		disabled: queryOptions.disabled ?? !address,
	});
	return {
		...query,
		accounts: query.data ?? [],
	};
}

export type UseSimulateTransactionOptions = Omit<
	UseSolanaRpcQueryOptions<SimulateTransactionResponse>,
	'refreshInterval'
> &
	Readonly<{
		commitment?: Commitment;
		config?: SimulateTransactionConfig;
		refreshInterval?: number;
	}>;

export type SimulateTransactionQueryResult = SolanaQueryResult<SimulateTransactionResponse> &
	Readonly<{
		logs: readonly string[] | null | undefined;
	}>;

type SimulationInput = (SendableTransaction & Transaction) | Base64EncodedWireTransaction | string;

export function useSimulateTransaction(
	transaction?: SimulationInput | null,
	options: UseSimulateTransactionOptions = {},
): SimulateTransactionQueryResult {
	const { commitment, config, refreshInterval, ...rest } = options;
	const wire = useMemo<Base64EncodedWireTransaction | null>(() => {
		if (!transaction) {
			return null;
		}
		if (typeof transaction === 'string') {
			return transaction as Base64EncodedWireTransaction;
		}
		return getBase64EncodedWireTransaction(transaction);
	}, [transaction]);
	const configKey = useMemo(() => stableStringify(config ?? null), [config]);
	const fetcher = useCallback(
		async (client: SolanaClient) => {
			if (!wire) {
				throw new Error('Provide a transaction payload before simulating.');
			}
			const resolvedConfig = {
				...(config ?? {}),
				commitment: commitment ?? config?.commitment ?? client.store.getState().cluster.commitment,
			} as SimulateTransactionConfig;
			const plan = client.runtime.rpc.simulateTransaction(wire, resolvedConfig);
			return plan.send({ abortSignal: AbortSignal.timeout(20_000) });
		},
		[commitment, config, wire],
	);
	const query = useSolanaRpcQuery<SimulateTransactionResponse>('simulateTransaction', [wire, configKey], fetcher, {
		...rest,
		refreshInterval,
		disabled: rest.disabled ?? !wire,
		revalidateIfStale: rest.revalidateIfStale ?? false,
		revalidateOnFocus: rest.revalidateOnFocus ?? false,
	});
	return {
		...query,
		logs: query.data?.value.logs,
	};
}
