import {
	type AccountCacheEntry,
	type AddressLike,
	type AsyncState,
	type ClientState,
	type ConfirmationCommitment,
	confirmationMeetsCommitment,
	createAsyncState,
	createInitialAsyncState,
	createSolTransferController,
	createTransactionPoolController,
	deriveConfirmationStatus,
	getWalletStandardConnectors,
	type LatestBlockhashCache,
	normalizeSignature,
	SIGNATURE_STATUS_TIMEOUT_MS,
	type SignatureLike,
	type SolanaClient,
	type SolTransferHelper,
	type SolTransferInput,
	type SolTransferSendOptions,
	type SplTokenBalance,
	type SplTokenHelper,
	type SplTokenHelperConfig,
	type SplTransferPrepareConfig,
	type TransactionHelper,
	type TransactionInstructionInput,
	type TransactionInstructionList,
	type TransactionPoolController,
	type TransactionPoolPrepareAndSendOptions,
	type TransactionPoolPrepareOptions,
	type TransactionPoolSendOptions,
	type TransactionPoolSignOptions,
	type TransactionPrepareAndSendRequest,
	type TransactionPrepared,
	type TransactionSendOptions,
	toAddress,
	type WalletConnector,
	type WalletSession,
	type WalletStatus,
	watchWalletStandardConnectors,
} from '@solana/client';
import type { Commitment, Lamports, Signature } from '@solana/kit';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import useSWR from 'swr';

import { useSolanaClient } from './context';
import { type SolanaQueryResult, type UseSolanaRpcQueryOptions, useSolanaRpcQuery } from './query';
import { type LatestBlockhashQueryResult, type UseLatestBlockhashOptions, useLatestBlockhash } from './queryHooks';
import { useClientStore } from './useClientStore';

type ClusterState = ClientState['cluster'];
type ClusterStatus = ClientState['cluster']['status'];
type WalletStandardDiscoveryOptions = Parameters<typeof watchWalletStandardConnectors>[1];

type UnwrapPromise<T> = T extends Promise<infer U> ? U : T;

type RpcInstance = SolanaClient['runtime']['rpc'];

type SignatureStatusesPlan = ReturnType<RpcInstance['getSignatureStatuses']>;

type SignatureStatusesResponse = Awaited<ReturnType<SignatureStatusesPlan['send']>>;

type SignatureStatusValue = SignatureStatusesResponse['value'][number];

type SignatureStatusConfig = Parameters<RpcInstance['getSignatureStatuses']>[1];

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
) => Promise<void> {
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
	const sessionRef = useRef(session);

	useEffect(() => {
		sessionRef.current = session;
	}, [session]);

	const controller = useMemo(
		() =>
			createSolTransferController({
				authorityProvider: () => sessionRef.current,
				helper,
			}),
		[helper],
	);

	const state = useSyncExternalStore<AsyncState<SolTransferSignature>>(
		controller.subscribe,
		controller.getState,
		controller.getState,
	);

	const send = useCallback(
		(config: SolTransferInput, options?: SolTransferSendOptions) => controller.send(config, options),
		[controller],
	);

	return {
		error: state.error ?? null,
		helper,
		isSending: state.status === 'loading',
		reset: controller.reset,
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

type UseTransactionPoolConfig = Readonly<{
	instructions?: TransactionInstructionList;
	latestBlockhash?: UseLatestBlockhashOptions;
}>;

type UseTransactionPoolPrepareOptions = TransactionPoolPrepareOptions;

type UseTransactionPoolSignOptions = TransactionPoolSignOptions;

type UseTransactionPoolSendOptions = TransactionPoolSendOptions;

type UseTransactionPoolPrepareAndSendOptions = TransactionPoolPrepareAndSendOptions;

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
	const blockhashMaxAgeMs = config.latestBlockhash?.refreshInterval ?? 30_000;
	const controller = useMemo<TransactionPoolController>(
		() =>
			createTransactionPoolController({
				blockhashMaxAgeMs,
				helper,
				initialInstructions,
			}),
		[blockhashMaxAgeMs, helper, initialInstructions],
	);
	const latestBlockhash = useLatestBlockhash(config.latestBlockhash);

	useEffect(() => {
		const value = latestBlockhash.data?.value;
		if (!value) {
			controller.setLatestBlockhashCache(undefined);
			return;
		}
		const cache: LatestBlockhashCache = {
			updatedAt: latestBlockhash.dataUpdatedAt ?? Date.now(),
			value,
		};
		controller.setLatestBlockhashCache(cache);
	}, [controller, latestBlockhash.data, latestBlockhash.dataUpdatedAt]);

	const instructions = useSyncExternalStore<TransactionInstructionList>(
		controller.subscribeInstructions,
		controller.getInstructions,
		controller.getInstructions,
	);
	const prepared = useSyncExternalStore<TransactionPrepared | null>(
		controller.subscribePrepared,
		controller.getPrepared,
		controller.getPrepared,
	);
	const prepareState = useSyncExternalStore<AsyncState<TransactionPrepared>>(
		controller.subscribePrepareState,
		controller.getPrepareState,
		controller.getPrepareState,
	);
	const sendState = useSyncExternalStore<AsyncState<TransactionSignature>>(
		controller.subscribeSendState,
		controller.getSendState,
		controller.getSendState,
	);

	return {
		addInstruction: controller.addInstruction,
		addInstructions: controller.addInstructions,
		clearInstructions: controller.clearInstructions,
		instructions,
		isPreparing: prepareState.status === 'loading',
		isSending: sendState.status === 'loading',
		prepared,
		prepare: controller.prepare,
		prepareError: prepareState.error ?? null,
		prepareStatus: prepareState.status,
		removeInstruction: controller.removeInstruction,
		replaceInstructions: controller.replaceInstructions,
		reset: controller.reset,
		send: controller.send,
		sendError: sendState.error ?? null,
		sendSignature: sendState.data ?? null,
		sendStatus: sendState.status,
		prepareAndSend: controller.prepareAndSend,
		sign: controller.sign,
		toWire: controller.toWire,
		latestBlockhash,
	};
}

type SendTransactionSignature = Signature;

type UseSendTransactionResult = Readonly<{
	error: unknown;
	isSending: boolean;
	reset(): void;
	send(
		request: TransactionPrepareAndSendRequest,
		options?: TransactionSendOptions,
	): Promise<SendTransactionSignature>;
	sendPrepared(prepared: TransactionPrepared, options?: TransactionSendOptions): Promise<SendTransactionSignature>;
	signature: SendTransactionSignature | null;
	status: AsyncState<SendTransactionSignature>['status'];
}>;

/**
 * General-purpose helper that prepares and sends arbitrary transactions through {@link TransactionHelper}.
 */
export function useSendTransaction(): UseSendTransactionResult {
	const client = useSolanaClient();
	const helper = client.transaction;
	const session = useWalletSession();
	const [state, setState] = useState<AsyncState<SendTransactionSignature>>(() =>
		createInitialAsyncState<SendTransactionSignature>(),
	);

	const execute = useCallback(
		async (operation: () => Promise<SendTransactionSignature>): Promise<SendTransactionSignature> => {
			setState(createAsyncState<SendTransactionSignature>('loading'));
			try {
				const signature = await operation();
				setState(createAsyncState<SendTransactionSignature>('success', { data: signature }));
				return signature;
			} catch (error) {
				setState(createAsyncState<SendTransactionSignature>('error', { error }));
				throw error;
			}
		},
		[],
	);

	const ensureAuthority = useCallback(
		(request: TransactionPrepareAndSendRequest): TransactionPrepareAndSendRequest => {
			if (request.authority) {
				return request;
			}
			if (!session) {
				throw new Error('Connect a wallet or supply an `authority` before sending transactions.');
			}
			return { ...request, authority: session };
		},
		[session],
	);

	const send = useCallback(
		async (request: TransactionPrepareAndSendRequest, options?: TransactionSendOptions) => {
			const normalizedRequest = ensureAuthority(request);
			return execute(() => helper.prepareAndSend(normalizedRequest, options));
		},
		[ensureAuthority, execute, helper],
	);

	const sendPrepared = useCallback(
		async (prepared: TransactionPrepared, options?: TransactionSendOptions) =>
			execute(() => helper.send(prepared, options)),
		[execute, helper],
	);

	const reset = useCallback(() => {
		setState(createInitialAsyncState<SendTransactionSignature>());
	}, []);

	return {
		error: state.error ?? null,
		isSending: state.status === 'loading',
		reset,
		send,
		sendPrepared,
		signature: state.data ?? null,
		status: state.status,
	};
}

export type UseSignatureStatusOptions = UseSolanaRpcQueryOptions<SignatureStatusValue | null> &
	Readonly<{
		config?: SignatureStatusConfig;
	}>;

export type SignatureStatusResult = SolanaQueryResult<SignatureStatusValue | null> &
	Readonly<{
		confirmationStatus: ConfirmationCommitment | null;
		signatureStatus: SignatureStatusValue | null;
	}>;

/**
 * Fetch the RPC status for a transaction signature.
 */
export function useSignatureStatus(
	signatureInput?: SignatureLike,
	options: UseSignatureStatusOptions = {},
): SignatureStatusResult {
	const { config, ...queryOptions } = options;
	const signature = useMemo(() => normalizeSignature(signatureInput), [signatureInput]);
	const signatureKey = signature?.toString() ?? null;
	const configKey = useMemo(() => JSON.stringify(config ?? null), [config]);
	const fetcher = useCallback(
		async (client: SolanaClient) => {
			if (!signatureKey) {
				throw new Error('Provide a signature before querying its status.');
			}
			if (!signature) {
				throw new Error('Provide a signature before querying its status.');
			}
			const plan = client.runtime.rpc.getSignatureStatuses([signature], config);
			const response = await plan.send({ abortSignal: AbortSignal.timeout(SIGNATURE_STATUS_TIMEOUT_MS) });
			return response.value[0] ?? null;
		},
		[config, signature, signatureKey],
	);
	const disabled = queryOptions.disabled ?? !signatureKey;
	const query = useSolanaRpcQuery<SignatureStatusValue | null>(
		'signatureStatus',
		[signatureKey, configKey],
		fetcher,
		{
			...queryOptions,
			disabled,
		},
	);
	const confirmationStatus = deriveConfirmationStatus(query.data ?? null);
	return {
		...query,
		confirmationStatus,
		signatureStatus: query.data ?? null,
	};
}

export type SignatureWaitStatus = 'error' | 'idle' | 'success' | 'waiting';

export type UseWaitForSignatureOptions = Omit<UseSignatureStatusOptions, 'disabled'> &
	Readonly<{
		commitment?: ConfirmationCommitment;
		disabled?: boolean;
		subscribe?: boolean;
		watchCommitment?: ConfirmationCommitment;
	}>;

export type WaitForSignatureResult = SignatureStatusResult &
	Readonly<{
		isError: boolean;
		isSuccess: boolean;
		isWaiting: boolean;
		waitError: unknown;
		waitStatus: SignatureWaitStatus;
	}>;

/**
 * Polls signature status data until the desired commitment (or subscription notification) is reached.
 */
export function useWaitForSignature(
	signatureInput?: SignatureLike,
	options: UseWaitForSignatureOptions = {},
): WaitForSignatureResult {
	const {
		commitment = 'confirmed',
		disabled: disabledOption,
		subscribe = true,
		watchCommitment,
		...signatureStatusOptions
	} = options;
	const { refreshInterval, ...restStatusOptions } = signatureStatusOptions;
	const subscribeCommitment = watchCommitment ?? commitment;
	const client = useSolanaClient();
	const normalizedSignature = useMemo(() => normalizeSignature(signatureInput), [signatureInput]);
	const disabled = disabledOption ?? !normalizedSignature;
	const statusQuery = useSignatureStatus(signatureInput, {
		...restStatusOptions,
		refreshInterval: refreshInterval ?? 2_000,
		disabled,
	});
	const [subscriptionSettled, setSubscriptionSettled] = useState(false);

	useEffect(() => {
		if (normalizedSignature === undefined) {
			setSubscriptionSettled(false);
			return;
		}
		setSubscriptionSettled(false);
	}, [normalizedSignature]);

	useEffect(() => {
		if (!normalizedSignature || disabled || !subscribe) {
			return;
		}
		const subscription = client.watchers.watchSignature(
			{
				commitment: subscribeCommitment,
				enableReceivedNotification: true,
				signature: normalizedSignature,
			},
			() => {
				setSubscriptionSettled(true);
			},
		);
		return () => {
			subscription.abort();
		};
	}, [client, disabled, normalizedSignature, subscribe, subscribeCommitment]);

	const hasSignature = Boolean(normalizedSignature) && !disabled;
	const signatureError = statusQuery.signatureStatus?.err ?? null;
	const waitError = statusQuery.error ?? signatureError ?? null;
	const meetsCommitment = confirmationMeetsCommitment(statusQuery.confirmationStatus, commitment);
	const settled = subscriptionSettled || meetsCommitment;

	let waitStatus: SignatureWaitStatus = 'idle';
	if (!hasSignature) {
		waitStatus = 'idle';
	} else if (waitError) {
		waitStatus = 'error';
	} else if (settled) {
		waitStatus = 'success';
	} else {
		waitStatus = 'waiting';
	}

	return {
		...statusQuery,
		isError: waitStatus === 'error',
		isSuccess: waitStatus === 'success',
		isWaiting: waitStatus === 'waiting',
		waitError,
		waitStatus,
	};
}
