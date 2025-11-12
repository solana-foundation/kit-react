import {
	type AccountCacheEntry,
	type ClientState,
	getWalletStandardConnectors,
	type SolTransferHelper,
	type SolTransferPrepareConfig,
	type SolTransferSendOptions,
	type SplTokenBalance,
	type SplTokenHelper,
	type SplTokenHelperConfig,
	type SplTransferPrepareConfig,
	type TransactionHelper,
	type TransactionInstructionInput,
	type TransactionPrepareAndSendRequest,
	type TransactionPrepared,
	type TransactionPrepareRequest,
	type TransactionSendOptions,
	type TransactionSignOptions,
	type WalletConnector,
	type WalletSession,
	type WalletStatus,
	watchWalletStandardConnectors,
} from '@solana/client-core';
import type { Commitment, Lamports, Signature } from '@solana/kit';
import { useCallback, useEffect, useMemo, useState } from 'react';
import useSWR from 'swr';

import { useSolanaClient } from './context';
import { type LatestBlockhashQueryResult, type UseLatestBlockhashOptions, useLatestBlockhash } from './queryHooks';
import { useClientStore } from './useClientStore';
import { type AddressLike, toAddress } from './utils/address';

type ClusterState = ClientState['cluster'];
type ClusterStatus = ClientState['cluster']['status'];
type WalletStandardDiscoveryOptions = Parameters<typeof watchWalletStandardConnectors>[1];

type UnwrapPromise<T> = T extends Promise<infer U> ? U : T;

type AsyncState<T> = Readonly<{
	data?: T;
	error?: unknown;
	status: 'error' | 'idle' | 'loading' | 'success';
}>;

function createInitialAsyncState<T>(): AsyncState<T> {
	return { status: 'idle' };
}

type UseAccountOptions = Readonly<{
	commitment?: Commitment;
	fetch?: boolean;
	skip?: boolean;
	watch?: boolean;
}>;

type UseBalanceOptions = Readonly<{
	watch?: boolean;
}> &
	UseAccountOptions;

function createClusterSelector(): (state: ClientState) => ClusterState {
	return (state) => state.cluster;
}

function createClusterStatusSelector(): (state: ClientState) => ClusterStatus {
	return (state) => state.cluster.status;
}

function createWalletSelector(): (state: ClientState) => WalletStatus {
	return (state) => state.wallet;
}

function createAccountSelector(key?: string) {
	return (state: ClientState): AccountCacheEntry | undefined => (key ? state.accounts[key] : undefined);
}

/**
 * Read the full cluster state managed by the client store.
 */
export function useClusterState(): ClusterState {
	const selector = useMemo(createClusterSelector, []);
	return useClientStore(selector);
}

/**
 * Read the current cluster connection status.
 */
export function useClusterStatus(): ClusterStatus {
	const selector = useMemo(createClusterStatusSelector, []);
	return useClientStore(selector);
}

/**
 * Access the wallet status tracked by the client store.
 */
export function useWallet(): WalletStatus {
	const selector = useMemo(createWalletSelector, []);
	return useClientStore(selector);
}

/**
 * Convenience helper that returns the active wallet session when connected.
 */
export function useWalletSession(): WalletSession | undefined {
	const wallet = useWallet();
	if (wallet.status === 'connected') {
		return wallet.session;
	}
	return undefined;
}

/**
 * Access the headless client actions.
 */
export function useWalletActions() {
	const client = useSolanaClient();
	return client.actions;
}

/**
 * Stable connect helper that resolves to {@link ClientActions.connectWallet}.
 */
export function useConnectWallet(): (
	connectorId: string,
	options?: Readonly<{ autoConnect?: boolean }>,
) => Promise<WalletSession> {
	const client = useSolanaClient();
	return useCallback(
		(connectorId: string, options?: Readonly<{ autoConnect?: boolean }>) =>
			client.actions.connectWallet(connectorId, options),
		[client],
	);
}

/**
 * Stable disconnect helper mapping to {@link ClientActions.disconnectWallet}.
 */
export function useDisconnectWallet(): () => Promise<void> {
	const client = useSolanaClient();
	return useCallback(() => client.actions.disconnectWallet(), [client]);
}

type SolTransferSignature = UnwrapPromise<ReturnType<SolTransferHelper['sendTransfer']>>;
type SolTransferInput = Omit<SolTransferPrepareConfig, 'authority'> & {
	authority?: SolTransferPrepareConfig['authority'];
};

/**
 * Convenience wrapper around the SOL transfer helper that tracks status and signature.
 */
export function useSolTransfer(): Readonly<{
	error: unknown;
	helper: SolTransferHelper;
	isSending: boolean;
	reset(): void;
	send(config: SolTransferInput, options?: SolTransferSendOptions): Promise<SolTransferSignature>;
	signature: SolTransferSignature | null;
	status: AsyncState<SolTransferSignature>['status'];
}> {
	const client = useSolanaClient();
	const session = useWalletSession();
	const helper = client.solTransfer;
	const [state, setState] = useState<AsyncState<SolTransferSignature>>(() =>
		createInitialAsyncState<SolTransferSignature>(),
	);

	const send = useCallback(
		async (config: SolTransferInput, options?: SolTransferSendOptions) => {
			const { authority: authorityOverride, ...rest } = config;
			const authority = authorityOverride ?? session;
			if (!authority) {
				throw new Error('Connect a wallet or supply an `authority` before sending SOL transfers.');
			}
			setState({ status: 'loading' });
			try {
				const signature = await helper.sendTransfer({ ...rest, authority }, options);
				setState({ data: signature, status: 'success' });
				return signature;
			} catch (error) {
				setState({ error, status: 'error' });
				throw error;
			}
		},
		[helper, session],
	);

	const reset = useCallback(() => {
		setState(() => createInitialAsyncState<SolTransferSignature>());
	}, []);

	return {
		error: state.error ?? null,
		helper,
		isSending: state.status === 'loading',
		reset,
		send,
		signature: state.data ?? null,
		status: state.status,
	};
}

type SplTokenBalanceResult = SplTokenBalance;
type SplTransferSignature = UnwrapPromise<ReturnType<SplTokenHelper['sendTransfer']>>;
type SplTransferInput = Omit<SplTransferPrepareConfig, 'authority' | 'sourceOwner'> & {
	authority?: SplTransferPrepareConfig['authority'];
	sourceOwner?: SplTransferPrepareConfig['sourceOwner'];
};

type UseSplTokenOptions = Readonly<{
	commitment?: Commitment;
	config?: Omit<SplTokenHelperConfig, 'commitment' | 'mint'>;
	owner?: AddressLike;
	revalidateOnFocus?: boolean;
}>;

/**
 * Simplified SPL token hook that scopes helpers by mint and manages balance state.
 */
export function useSplToken(
	mint: AddressLike,
	options: UseSplTokenOptions = {},
): Readonly<{
	balance: SplTokenBalanceResult | null;
	error: unknown;
	helper: SplTokenHelper;
	isFetching: boolean;
	isSending: boolean;
	owner: string | null;
	refresh(): Promise<SplTokenBalanceResult | undefined>;
	refreshing: boolean;
	resetSend(): void;
	send(config: SplTransferInput, options?: SolTransferSendOptions): Promise<SplTransferSignature>;
	sendError: unknown;
	sendSignature: SplTransferSignature | null;
	sendStatus: AsyncState<SplTransferSignature>['status'];
	status: 'disconnected' | 'error' | 'loading' | 'ready';
}> {
	const client = useSolanaClient();
	const session = useWalletSession();

	const normalizedMint = useMemo(() => String(mint), [mint]);

	const helperConfig = useMemo<SplTokenHelperConfig>(
		() => ({
			commitment: options.commitment,
			mint: normalizedMint,
			...(options.config ?? {}),
		}),
		[normalizedMint, options.commitment, options.config],
	);

	const helper = useMemo(() => client.splToken(helperConfig), [client, helperConfig]);

	const ownerRaw = options.owner ?? session?.account.address;
	const owner = useMemo(() => (ownerRaw ? String(ownerRaw) : null), [ownerRaw]);

	const balanceKey = owner ? ['spl-balance', normalizedMint, owner, options.commitment ?? null] : null;

	const fetchBalance = useCallback(() => {
		if (!owner) {
			throw new Error('Unable to fetch SPL balance without an owner.');
		}
		return helper.fetchBalance(owner, options.commitment);
	}, [helper, owner, options.commitment]);

	const { data, error, isLoading, isValidating, mutate } = useSWR<SplTokenBalanceResult>(balanceKey, fetchBalance, {
		revalidateOnFocus: options.revalidateOnFocus ?? false,
	});

	const [sendState, setSendState] = useState<AsyncState<SplTransferSignature>>(() =>
		createInitialAsyncState<SplTransferSignature>(),
	);

	const refresh = useCallback(() => {
		if (!owner) {
			return Promise.resolve(undefined);
		}
		return mutate(() => helper.fetchBalance(owner, options.commitment), { revalidate: false });
	}, [helper, mutate, owner, options.commitment]);

	const send = useCallback(
		async (config: SplTransferInput, sendOptions?: SolTransferSendOptions) => {
			const { authority: authorityOverride, sourceOwner: sourceOwnerOverride, ...rest } = config;
			const authority = authorityOverride ?? session;
			const sourceOwner = sourceOwnerOverride ?? owner;
			if (!authority) {
				throw new Error('Connect a wallet or supply an `authority` before sending SPL tokens.');
			}
			if (!sourceOwner) {
				throw new Error('Unable to resolve a source owner for the SPL token transfer.');
			}
			setSendState({ status: 'loading' });
			try {
				const signature = await helper.sendTransfer(
					{
						...rest,
						authority,
						sourceOwner,
					},
					sendOptions,
				);
				setSendState({ data: signature, status: 'success' });
				if (owner) {
					await mutate(() => helper.fetchBalance(owner, options.commitment), { revalidate: false });
				}
				return signature;
			} catch (sendError) {
				setSendState({ error: sendError, status: 'error' });
				throw sendError;
			}
		},
		[helper, mutate, options.commitment, owner, session],
	);

	const resetSend = useCallback(() => {
		setSendState(() => createInitialAsyncState<SplTransferSignature>());
	}, []);

	const status: 'disconnected' | 'error' | 'loading' | 'ready' =
		owner === null ? 'disconnected' : error ? 'error' : isLoading && !data ? 'loading' : 'ready';

	return {
		balance: data ?? null,
		error: error ?? null,
		helper,
		isFetching: Boolean(owner) && (isLoading || isValidating),
		isSending: sendState.status === 'loading',
		owner,
		refresh,
		refreshing: Boolean(owner) && isValidating,
		resetSend,
		send,
		sendError: sendState.error ?? null,
		sendSignature: sendState.data ?? null,
		sendStatus: sendState.status,
		status,
	};
}

/**
 * Subscribe to the account cache for a given address, optionally triggering fetch & watch helpers.
 */
export function useAccount(addressLike?: AddressLike, options: UseAccountOptions = {}): AccountCacheEntry | undefined {
	const client = useSolanaClient();
	const shouldSkip = options.skip ?? !addressLike;
	const address = useMemo(() => {
		if (shouldSkip || !addressLike) {
			return undefined;
		}
		return toAddress(addressLike);
	}, [addressLike, shouldSkip]);
	const accountKey = useMemo(() => address?.toString(), [address]);
	const selector = useMemo(() => createAccountSelector(accountKey), [accountKey]);
	const account = useClientStore(selector);

	useEffect(() => {
		if (!address) {
			return;
		}
		const commitment = options.commitment;
		if (options.fetch !== false) {
			void client.actions.fetchAccount(address, commitment).catch(() => undefined);
		}
		if (options.watch) {
			const subscription = client.watchers.watchAccount({ address, commitment }, () => undefined);
			return () => {
				subscription.abort();
			};
		}
		return undefined;
	}, [address, client, options.commitment, options.fetch, options.watch]);

	return account;
}

/**
 * Tracks a lamport balance for the provided address. Fetches immediately and watches by default.
 */
export function useBalance(
	addressLike?: AddressLike,
	options: UseBalanceOptions = {},
): Readonly<{
	account?: AccountCacheEntry;
	error?: unknown;
	fetching: boolean;
	lamports: Lamports | null;
	slot: bigint | null | undefined;
}> {
	const mergedOptions = useMemo(
		() => ({
			commitment: options.commitment,
			fetch: options.fetch ?? true,
			skip: options.skip,
			watch: options.watch ?? true,
		}),
		[options.commitment, options.fetch, options.skip, options.watch],
	);
	const client = useSolanaClient();
	const shouldSkip = mergedOptions.skip ?? !addressLike;
	const address = useMemo(() => {
		if (shouldSkip || !addressLike) {
			return undefined;
		}
		return toAddress(addressLike);
	}, [addressLike, shouldSkip]);
	const accountKey = useMemo(() => address?.toString(), [address]);
	const selector = useMemo(() => createAccountSelector(accountKey), [accountKey]);
	const account = useClientStore(selector);

	useEffect(() => {
		if (!address) {
			return;
		}
		const commitment = mergedOptions.commitment;
		if (mergedOptions.fetch !== false) {
			void client.actions.fetchBalance(address, commitment).catch(() => undefined);
		}
		if (mergedOptions.watch) {
			const watcher = client.watchers.watchBalance({ address, commitment }, () => undefined);
			return () => {
				watcher.abort();
			};
		}
		return undefined;
	}, [address, client, mergedOptions.commitment, mergedOptions.fetch, mergedOptions.watch]);

	const lamports = account?.lamports ?? null;
	const fetching = account?.fetching ?? false;
	const slot = account?.slot;
	const error = account?.error;

	return useMemo(
		() => ({
			account,
			error,
			fetching,
			lamports,
			slot,
		}),
		[account, error, fetching, lamports, slot],
	);
}

/**
 * Collect Wallet Standard connectors and keep the list in sync with registration changes.
 */
export function useWalletStandardConnectors(options?: WalletStandardDiscoveryOptions): readonly WalletConnector[] {
	const overrides = options?.overrides;
	const memoisedOptions = useMemo(() => (overrides ? { overrides } : undefined), [overrides]);
	const [connectors, setConnectors] = useState<readonly WalletConnector[]>(() =>
		getWalletStandardConnectors(memoisedOptions ?? {}),
	);

	useEffect(() => {
		setConnectors(getWalletStandardConnectors(memoisedOptions ?? {}));
		const unwatch = watchWalletStandardConnectors(setConnectors, memoisedOptions ?? {});
		return () => {
			unwatch();
		};
	}, [memoisedOptions]);

	return connectors;
}

type TransactionInstructionList = readonly TransactionInstructionInput[];

type UseTransactionPoolConfig = Readonly<{
	instructions?: TransactionInstructionList;
	latestBlockhash?: UseLatestBlockhashOptions;
}>;

type UseTransactionPoolPrepareOptions = Readonly<
	Partial<Omit<TransactionPrepareRequest, 'instructions'>> & {
		instructions?: TransactionInstructionList;
	}
>;

type UseTransactionPoolSignOptions = Readonly<TransactionSignOptions & { prepared?: TransactionPrepared }>;

type UseTransactionPoolSendOptions = Readonly<TransactionSendOptions & { prepared?: TransactionPrepared }>;

type UseTransactionPoolPrepareAndSendOptions = Readonly<
	Omit<TransactionPrepareAndSendRequest, 'instructions'> & {
		instructions?: TransactionInstructionList;
	}
>;

type TransactionSignature = Signature;

/**
 * Manage a mutable set of instructions and use the transaction helper to prepare and send transactions.
 */
export function useTransactionPool(config: UseTransactionPoolConfig = {}): Readonly<{
	addInstruction(instruction: TransactionInstructionInput): void;
	addInstructions(instructionSet: TransactionInstructionList): void;
	clearInstructions(): void;
	instructions: TransactionInstructionList;
	isPreparing: boolean;
	isSending: boolean;
	prepared: TransactionPrepared | null;
	prepare(options?: UseTransactionPoolPrepareOptions): Promise<TransactionPrepared>;
	prepareError: unknown;
	prepareStatus: AsyncState<TransactionPrepared>['status'];
	removeInstruction(index: number): void;
	replaceInstructions(instructionSet: TransactionInstructionList): void;
	reset(): void;
	send(options?: UseTransactionPoolSendOptions): Promise<TransactionSignature>;
	sendError: unknown;
	sendSignature: TransactionSignature | null;
	sendStatus: AsyncState<TransactionSignature>['status'];
	prepareAndSend(
		request?: UseTransactionPoolPrepareAndSendOptions,
		sendOptions?: TransactionSendOptions,
	): Promise<TransactionSignature>;
	sign(options?: UseTransactionPoolSignOptions): ReturnType<TransactionHelper['sign']>;
	toWire(options?: UseTransactionPoolSignOptions): ReturnType<TransactionHelper['toWire']>;
	latestBlockhash: LatestBlockhashQueryResult;
}> {
	const initialInstructions = useMemo<TransactionInstructionList>(
		() => config.instructions ?? [],
		[config.instructions],
	);
	const client = useSolanaClient();
	const helper = client.helpers.transaction;
	const latestBlockhash = useLatestBlockhash(config.latestBlockhash);
	const blockhashMaxAgeMs = config.latestBlockhash?.refreshInterval ?? 30_000;
	const [instructions, setInstructions] = useState<TransactionInstructionInput[]>(() => [...initialInstructions]);
	const [prepared, setPrepared] = useState<TransactionPrepared | null>(null);
	const [prepareState, setPrepareState] = useState<AsyncState<TransactionPrepared>>(() =>
		createInitialAsyncState<TransactionPrepared>(),
	);
	const [sendState, setSendState] = useState<AsyncState<TransactionSignature>>(() =>
		createInitialAsyncState<TransactionSignature>(),
	);
	const latestBlockhashData = latestBlockhash.data;
	const latestBlockhashUpdatedAt = latestBlockhash.dataUpdatedAt;

	const resolveCachedLifetime = useCallback(() => {
		if (!latestBlockhashData?.value || !latestBlockhashUpdatedAt) {
			return undefined;
		}
		if (Date.now() - latestBlockhashUpdatedAt > blockhashMaxAgeMs) {
			return undefined;
		}
		return latestBlockhashData.value;
	}, [blockhashMaxAgeMs, latestBlockhashData, latestBlockhashUpdatedAt]);

	useEffect(() => {
		setInstructions([...initialInstructions]);
	}, [initialInstructions]);

	useEffect(() => {
		// Reset derived state whenever the instruction list changes.
		void instructions.length;
		setPrepared(null);
		setPrepareState(createInitialAsyncState<TransactionPrepared>());
		setSendState(createInitialAsyncState<TransactionSignature>());
	}, [instructions]);

	const addInstruction = useCallback((instruction: TransactionInstructionInput) => {
		setInstructions((current) => [...current, instruction]);
	}, []);

	const addInstructions = useCallback((instructionSet: TransactionInstructionList) => {
		setInstructions((current) => [...current, ...instructionSet]);
	}, []);

	const replaceInstructions = useCallback((instructionSet: TransactionInstructionList) => {
		setInstructions([...instructionSet]);
	}, []);

	const clearInstructions = useCallback(() => {
		setInstructions([]);
	}, []);

	const removeInstruction = useCallback((index: number) => {
		setInstructions((current) => current.filter((_, idx) => idx !== index));
	}, []);

	const reset = useCallback(() => {
		setInstructions([...initialInstructions]);
		setPrepared(null);
		setPrepareState(createInitialAsyncState<TransactionPrepared>());
		setSendState(createInitialAsyncState<TransactionSignature>());
	}, [initialInstructions]);

	const prepare = useCallback(
		async (options: UseTransactionPoolPrepareOptions = {}): Promise<TransactionPrepared> => {
			const { instructions: overrideInstructions, ...rest } = options;
			const nextInstructions = overrideInstructions ?? instructions;
			if (!nextInstructions.length) {
				throw new Error('Add at least one instruction before preparing a transaction.');
			}
			setPrepareState({ status: 'loading' });
			try {
				const request: TransactionPrepareRequest = {
					...(rest as Omit<TransactionPrepareRequest, 'instructions'>),
					instructions: nextInstructions,
				};
				const cachedLifetime = request.lifetime ?? resolveCachedLifetime();
				const requestWithLifetime =
					cachedLifetime && !request.lifetime ? { ...request, lifetime: cachedLifetime } : request;
				const nextPrepared = await helper.prepare(requestWithLifetime);
				setPrepared(nextPrepared);
				setPrepareState({ data: nextPrepared, status: 'success' });
				return nextPrepared;
			} catch (error) {
				setPrepareState({ error, status: 'error' });
				throw error;
			}
		},
		[helper, instructions, resolveCachedLifetime],
	);

	const sign = useCallback(
		async (options: UseTransactionPoolSignOptions = {}) => {
			const { prepared: overridePrepared, ...rest } = options;
			const target = overridePrepared ?? prepared;
			if (!target) {
				throw new Error('Prepare a transaction before signing.');
			}
			return helper.sign(target, rest);
		},
		[helper, prepared],
	);

	const toWire = useCallback(
		async (options: UseTransactionPoolSignOptions = {}) => {
			const { prepared: overridePrepared, ...rest } = options;
			const target = overridePrepared ?? prepared;
			if (!target) {
				throw new Error('Prepare a transaction before serializing.');
			}
			return helper.toWire(target, rest);
		},
		[helper, prepared],
	);

	const send = useCallback(
		async (options: UseTransactionPoolSendOptions = {}): Promise<TransactionSignature> => {
			const { prepared: overridePrepared, ...rest } = options;
			const target = overridePrepared ?? prepared;
			if (!target) {
				throw new Error('Prepare a transaction before sending.');
			}
			setSendState({ status: 'loading' });
			try {
				const signature = await helper.send(target, rest);
				setSendState({ data: signature, status: 'success' });
				return signature;
			} catch (error) {
				setSendState({ error, status: 'error' });
				throw error;
			}
		},
		[helper, prepared],
	);

	const prepareAndSend = useCallback(
		async (
			request: UseTransactionPoolPrepareAndSendOptions = {},
			sendOptions?: TransactionSendOptions,
		): Promise<TransactionSignature> => {
			const { instructions: overrideInstructions, ...rest } = request;
			const nextInstructions = overrideInstructions ?? instructions;
			if (!nextInstructions.length) {
				throw new Error('Add at least one instruction before preparing a transaction.');
			}
			setSendState({ status: 'loading' });
			try {
				const cachedLifetime = rest.lifetime ?? resolveCachedLifetime();
				const restWithLifetime =
					cachedLifetime && !rest.lifetime ? { ...rest, lifetime: cachedLifetime } : rest;
				const signature = await helper.prepareAndSend(
					{
						...(restWithLifetime as Omit<TransactionPrepareAndSendRequest, 'instructions'>),
						instructions: nextInstructions,
					},
					sendOptions,
				);
				setSendState({ data: signature, status: 'success' });
				return signature;
			} catch (error) {
				setSendState({ error, status: 'error' });
				throw error;
			}
		},
		[helper, instructions, resolveCachedLifetime],
	);

	const isPreparing = prepareState.status === 'loading';
	const isSending = sendState.status === 'loading';

	return {
		addInstruction,
		addInstructions,
		clearInstructions,
		instructions,
		isPreparing,
		isSending,
		prepared,
		prepare,
		prepareError: prepareState.error ?? null,
		prepareStatus: prepareState.status,
		removeInstruction,
		replaceInstructions,
		reset,
		send,
		sendError: sendState.error ?? null,
		sendSignature: sendState.data ?? null,
		sendStatus: sendState.status,
		prepareAndSend,
		sign,
		toWire,
		latestBlockhash,
	};
}
