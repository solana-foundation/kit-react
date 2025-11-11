import {
	type AccountCacheEntry,
	type ClientActions,
	type ClientHelpers,
	type ClientState,
	type ClientStore,
	type ClientWatchers,
	createClientStore,
	createInitialClientState,
	type SolanaClient,
	type SolanaClientConfig,
	type SolTransferHelper,
	type SplTokenHelper,
	type SplTokenHelperConfig,
	type TransactionHelper,
	type WalletConnector,
	type WalletRegistry,
} from '@solana/client';
import type { Address, ClusterUrl, Lamports, Signature, TransactionSigner } from '@solana/kit';
import { type MockedFunction, vi } from 'vitest';

type MockedActions = {
	[K in keyof ClientActions]: MockedFunction<ClientActions[K]>;
};

type MockedWatchers = {
	[K in keyof ClientWatchers]: MockedFunction<ClientWatchers[K]>;
};

type MockedSolTransferHelper = {
	[K in keyof SolTransferHelper]: MockedFunction<SolTransferHelper[K]>;
};

type MockedSplTokenHelper = {
	[K in keyof SplTokenHelper]: MockedFunction<SplTokenHelper[K]>;
};

type MockedTransactionHelper = {
	[K in keyof TransactionHelper]: MockedFunction<TransactionHelper[K]>;
};

type CreateMockSplTokenHelper = (config: SplTokenHelperConfig) => MockedSplTokenHelper;

export type MockSolanaClient = SolanaClient & {
	actions: MockedActions;
	helpers: ClientHelpers & {
		solTransfer: MockedSolTransferHelper;
		splToken: MockedFunction<ClientHelpers['splToken']>;
		transaction: MockedTransactionHelper;
	};
	solTransfer: MockedSolTransferHelper;
	SolTransfer: MockedSolTransferHelper;
	splToken: MockedFunction<SolanaClient['splToken']>;
	SplToken: MockedFunction<SolanaClient['SplToken']>;
	SplHelper: MockedFunction<SolanaClient['SplHelper']>;
	transaction: MockedTransactionHelper;
	watchers: MockedWatchers;
};

export type MockSolanaClientOptions = Readonly<{
	actions?: Partial<MockedActions>;
	config?: Partial<SolanaClientConfig>;
	connectors?: readonly WalletConnector[];
	createSplTokenHelper?: CreateMockSplTokenHelper;
	runtime?: Partial<SolanaClient['runtime']>;
	solTransfer?: Partial<MockedSolTransferHelper>;
	state?: Partial<ClientState>;
	store?: ClientStore;
	transaction?: Partial<MockedTransactionHelper>;
	watchers?: Partial<MockedWatchers>;
}>;

type MockWatchSubscription = ReturnType<ClientWatchers['watchAccount']>;

const DEFAULT_ENDPOINT: ClusterUrl = 'http://localhost:8899' as ClusterUrl;
type RpcPlan<T> = {
	send: MockedFunction<() => Promise<T>>;
};

function createRpcPlan<T>(value: T): RpcPlan<T> {
	return {
		send: vi.fn(async () => value),
	};
}

function createDefaultRpc(): SolanaClient['runtime']['rpc'] {
	return {
		getLatestBlockhash: vi.fn(() =>
			createRpcPlan({
				context: { slot: 0n },
				value: { blockhash: 'mock-blockhash', lastValidBlockHeight: 0n },
			}),
		),
		getProgramAccounts: vi.fn(() => createRpcPlan([])),
		simulateTransaction: vi.fn(() => createRpcPlan({ value: { logs: [] } })),
		getSignatureStatuses: vi.fn(() =>
			createRpcPlan({
				context: { slot: 0n },
				value: [
					{
						confirmationStatus: 'processed',
						confirmations: 0,
						err: null,
						slot: 0n,
					},
				],
			}),
		),
	} as unknown as SolanaClient['runtime']['rpc'];
}

function createMockWatchSubscription(): MockWatchSubscription {
	return {
		abort: vi.fn(),
	};
}

function mergeClientState(current: ClientState, patch: Partial<ClientState>): ClientState {
	const next: ClientState = {
		...current,
		...patch,
		accounts: patch.accounts ?? current.accounts,
		cluster: patch.cluster ? { ...current.cluster, ...patch.cluster } : current.cluster,
		subscriptions: patch.subscriptions
			? {
					account: patch.subscriptions.account ?? current.subscriptions.account,
					signature: patch.subscriptions.signature ?? current.subscriptions.signature,
				}
			: current.subscriptions,
		transactions: patch.transactions ?? current.transactions,
		wallet: patch.wallet ?? current.wallet,
	};
	return next;
}

function createDefaultStore(): ClientStore {
	return createClientStore(
		createInitialClientState({
			commitment: 'confirmed',
			endpoint: DEFAULT_ENDPOINT,
		}),
	);
}

function createDefaultActions(): MockedActions {
	return {
		connectWallet: vi.fn<ClientActions['connectWallet']>(async () => undefined),
		disconnectWallet: vi.fn<ClientActions['disconnectWallet']>(async () => undefined),
		fetchAccount: vi.fn<ClientActions['fetchAccount']>(
			async (address: Address) =>
				({
					address,
					fetching: false,
					lamports: 0n as Lamports,
					slot: null,
				}) satisfies AccountCacheEntry,
		),
		fetchBalance: vi.fn<ClientActions['fetchBalance']>(async () => 0n as Lamports),
		requestAirdrop: vi.fn<ClientActions['requestAirdrop']>(async () => 'mock-signature' as Signature),
		sendTransaction: vi.fn<ClientActions['sendTransaction']>(
			async () => 'Tx1111111111111111111111111111111111111111111' as Signature,
		),
		setCluster: vi.fn<ClientActions['setCluster']>(async () => undefined),
	};
}

function createDefaultWatchers(): MockedWatchers {
	return {
		watchAccount: vi.fn<ClientWatchers['watchAccount']>(() => createMockWatchSubscription()),
		watchBalance: vi.fn<ClientWatchers['watchBalance']>(() => createMockWatchSubscription()),
		watchSignature: vi.fn<ClientWatchers['watchSignature']>(() => createMockWatchSubscription()),
	};
}

function createDefaultSolTransferHelper(): MockedSolTransferHelper {
	return {
		prepareTransfer: vi.fn<SolTransferHelper['prepareTransfer']>(async () => ({
			commitment: 'confirmed',
			lifetime: { blockhash: 'mock-blockhash', lastValidBlockHeight: 0n },
			message: {} as unknown,
			mode: 'send',
			signer: { address: 'mock' } as unknown as TransactionSigner,
		})),
		sendPreparedTransfer: vi.fn<SolTransferHelper['sendPreparedTransfer']>(
			async () => 'MockPreparedSignature1111111111111111111' as Signature,
		),
		sendTransfer: vi.fn<SolTransferHelper['sendTransfer']>(
			async () => 'MockTransferSignature111111111111111111111' as Signature,
		),
	};
}

function createDefaultSplTokenHelper(): MockedSplTokenHelper {
	return {
		deriveAssociatedTokenAddress: vi.fn<SplTokenHelper['deriveAssociatedTokenAddress']>(
			async (owner: Address | string) => owner as Address,
		),
		fetchBalance: vi.fn<SplTokenHelper['fetchBalance']>(async () => ({
			amount: 0n,
			ataAddress: 'MockAta1111111111111111111111111111111111' as Address,
			decimals: 9,
			exists: false,
			uiAmount: '0',
		})),
		prepareTransfer: vi.fn<SplTokenHelper['prepareTransfer']>(async () => ({
			amount: 0n,
			commitment: 'confirmed',
			decimals: 9,
			destinationAta: 'MockDestinationAta1111111111111111111111111' as Address,
			lifetime: { blockhash: 'mock-blockhash', lastValidBlockHeight: 0n },
			message: {} as unknown,
			mode: 'send',
			signer: { address: 'mock' } as unknown as TransactionSigner,
			sourceAta: 'MockSourceAta11111111111111111111111111' as Address,
		})),
		sendPreparedTransfer: vi.fn<SplTokenHelper['sendPreparedTransfer']>(
			async () => 'MockSplPreparedSignature111111111111111' as Signature,
		),
		sendTransfer: vi.fn<SplTokenHelper['sendTransfer']>(
			async () => 'MockSplSignature1111111111111111111111' as Signature,
		),
	};
}

function createDefaultTransactionHelper(): MockedTransactionHelper {
	return {
		prepare: vi.fn<TransactionHelper['prepare']>(async (request) => ({
			commitment: request.commitment ?? 'confirmed',
			computeUnitLimit: request.computeUnitLimit ? BigInt(request.computeUnitLimit) : undefined,
			computeUnitPrice: request.computeUnitPrice ? BigInt(request.computeUnitPrice) : undefined,
			feePayer: 'mock-fee-payer' satisfies Address,
			instructions: request.instructions,
			lifetime: { blockhash: 'mock-blockhash', lastValidBlockHeight: 0n },
			message: {} as unknown,
			mode: 'send',
			version: 'legacy',
		})),
		sign: vi.fn<TransactionHelper['sign']>(async () => ({}) as unknown),
		toWire: vi.fn<TransactionHelper['toWire']>(async () => 'MockWireTransaction1111111111111111111111111'),
		send: vi.fn<TransactionHelper['send']>(async () => 'MockTxSignature1111111111111111111111111' as Signature),
		prepareAndSend: vi.fn<TransactionHelper['prepareAndSend']>(
			async () => 'MockTxSignature1111111111111111111111111' as Signature,
		),
	};
}

function createDefaultConnectors(connectors: readonly WalletConnector[] = []): WalletRegistry {
	return {
		all: connectors,
		get: (id: string) => connectors.find((connector) => connector.id === id),
	};
}

function normaliseConfig(config?: Partial<SolanaClientConfig>): SolanaClientConfig {
	return {
		endpoint: config?.endpoint ?? DEFAULT_ENDPOINT,
		commitment: config?.commitment,
		createStore: config?.createStore,
		logger: config?.logger,
		walletConnectors: config?.walletConnectors,
		websocketEndpoint: config?.websocketEndpoint,
	};
}

export function createMockSplTokenHelper(_config?: SplTokenHelperConfig): MockedSplTokenHelper {
	// Allow tests to customise behaviour per helper instance when needed.
	return createDefaultSplTokenHelper();
}

export function createMockSolanaClient(options: MockSolanaClientOptions = {}): MockSolanaClient {
	const store = options.store ?? createDefaultStore();

	if (options.state) {
		store.setState((current) => mergeClientState(current, options.state as Partial<ClientState>));
	}

	const actions: MockedActions = {
		...createDefaultActions(),
		...(options.actions ?? {}),
	};

	const watchers: MockedWatchers = {
		...createDefaultWatchers(),
		...(options.watchers ?? {}),
	};

	const solTransferHelper: MockedSolTransferHelper = {
		...createDefaultSolTransferHelper(),
		...(options.solTransfer ?? {}),
	};

	const createSplHelper: CreateMockSplTokenHelper = options.createSplTokenHelper ?? createMockSplTokenHelper;
	const splTokenFn: MockedFunction<SolanaClient['splToken']> = vi.fn((config: SplTokenHelperConfig) =>
		createSplHelper(config),
	);

	const transactionHelper: MockedTransactionHelper = {
		...createDefaultTransactionHelper(),
		...(options.transaction ?? {}),
	};

	const connectors = createDefaultConnectors(options.connectors);

	const config = normaliseConfig(options.config);

	const runtime = {
		rpc: options.runtime?.rpc ?? createDefaultRpc(),
		rpcSubscriptions: options.runtime?.rpcSubscriptions ?? ({} as SolanaClient['runtime']['rpcSubscriptions']),
	};

	const helpers = {
		solTransfer: solTransferHelper,
		splToken: splTokenFn,
		transaction: transactionHelper,
	} as MockSolanaClient['helpers'];

	const client: MockSolanaClient = {
		actions,
		config,
		connectors,
		destroy: vi.fn(),
		helpers,
		runtime: runtime as SolanaClient['runtime'],
		store,
		watchers,
		solTransfer: solTransferHelper,
		SolTransfer: solTransferHelper,
		splToken: splTokenFn,
		SplToken: splTokenFn,
		SplHelper: splTokenFn,
		transaction: transactionHelper,
	} as MockSolanaClient;

	return client;
}
