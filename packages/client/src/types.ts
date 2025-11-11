import type {
	Address,
	ClusterUrl,
	Commitment,
	Lamports,
	SendableTransaction,
	Signature,
	Transaction,
	TransactionMessageWithBlockhashLifetime,
} from '@solana/kit';
import type { TransactionWithLastValidBlockHeight } from '@solana/transaction-confirmation';
import type { StoreApi } from 'zustand/vanilla';
import type { SolTransferHelper } from './features/sol';
import type { SplTokenHelper, SplTokenHelperConfig } from './features/spl';
import type { TransactionHelper } from './features/transactions';
import type { SolanaRpcClient } from './rpc/createSolanaRpcClient';
import type { PrepareTransactionMessage, PrepareTransactionOptions } from './transactions/prepareTransaction';

type SolanaRpcInstance = ReturnType<typeof import('@solana/kit')['createSolanaRpc']>;
type SolanaSubscriptionsInstance = ReturnType<typeof import('@solana/kit')['createSolanaRpcSubscriptions']>;

export type LogLevel = 'debug' | 'error' | 'info' | 'warn';

export type ClientLogger = (event: { data?: Record<string, unknown>; level: LogLevel; message: string }) => void;

export type WalletConnectorMetadata = Readonly<{
	canAutoConnect?: boolean;
	icon?: string;
	id: string;
	name: string;
}>;

export type WalletAccount = Readonly<{
	address: Address;
	label?: string;
	publicKey: Uint8Array;
}>;

export type WalletSession = Readonly<{
	account: WalletAccount;
	connector: WalletConnectorMetadata;
	disconnect(): Promise<void>;
	sendTransaction?(
		transaction: SendableTransaction & Transaction,
		config?: Readonly<{ commitment?: Commitment }>,
	): Promise<Signature>;
	signMessage?(message: Uint8Array): Promise<Uint8Array>;
	signTransaction?(transaction: SendableTransaction & Transaction): Promise<SendableTransaction & Transaction>;
}>;

export type WalletConnector = WalletConnectorMetadata & {
	connect(opts?: Readonly<{ autoConnect?: boolean }>): Promise<WalletSession>;
	disconnect(): Promise<void>;
	isSupported(): boolean;
};

type WalletStatusConnected = Readonly<{
	connectorId: string;
	session: WalletSession;
	status: 'connected';
}>;

type WalletStatusConnecting = Readonly<{
	connectorId: string;
	status: 'connecting';
}>;

type WalletStatusDisconnected = Readonly<{
	status: 'disconnected';
}>;

type WalletStatusError = Readonly<{
	connectorId?: string;
	error: unknown;
	status: 'error';
}>;

export type WalletStatus =
	| WalletStatusConnected
	| WalletStatusConnecting
	| WalletStatusDisconnected
	| WalletStatusError;

type ClusterStatusConnecting = Readonly<{ status: 'connecting' }>;

type ClusterStatusError = Readonly<{
	error: unknown;
	status: 'error';
}>;

type ClusterStatusIdle = Readonly<{ status: 'idle' }>;

type ClusterStatusReady = Readonly<{
	latencyMs?: number;
	status: 'ready';
}>;

export type ClusterStatus = ClusterStatusConnecting | ClusterStatusError | ClusterStatusIdle | ClusterStatusReady;

export type ClusterState = Readonly<{
	commitment: Commitment;
	endpoint: ClusterUrl;
	status: ClusterStatus;
	websocketEndpoint?: ClusterUrl;
}>;

export type AccountCacheEntry = Readonly<{
	address: Address;
	data?: unknown;
	error?: unknown;
	fetching: boolean;
	lamports: Lamports | null;
	lastFetchedAt?: number;
	slot: bigint | null;
}>;

export type AccountCache = Record<string, AccountCacheEntry>;

export type TransactionRecord = Readonly<{
	error?: unknown;
	lastUpdatedAt: number;
	signature?: Signature;
	status: 'confirmed' | 'failed' | 'idle' | 'sending' | 'waiting';
}>;

export type TransactionState = Record<string, TransactionRecord>;

type SubscriptionStatusActivating = Readonly<{ status: 'activating' }>;

type SubscriptionStatusActive = Readonly<{ status: 'active' }>;

type SubscriptionStatusError = Readonly<{ error: unknown; status: 'error' }>;

type SubscriptionStatusInactive = Readonly<{ status: 'inactive' }>;

export type SubscriptionStatus =
	| SubscriptionStatusActivating
	| SubscriptionStatusActive
	| SubscriptionStatusError
	| SubscriptionStatusInactive;

export type SubscriptionState = Readonly<{
	account: Record<string, SubscriptionStatus>;
	signature: Record<string, SubscriptionStatus>;
}>;

export type ClientState = Readonly<{
	accounts: AccountCache;
	cluster: ClusterState;
	lastUpdatedAt: number;
	subscriptions: SubscriptionState;
	transactions: TransactionState;
	wallet: WalletStatus;
}>;

export type ClientStore = StoreApi<ClientState>;

export type CreateStoreFn = (state: ClientState) => ClientStore;

export type SolanaClientConfig = Readonly<{
	commitment?: Commitment;
	createStore?: CreateStoreFn;
	endpoint: ClusterUrl;
	logger?: ClientLogger;
	rpcClient?: SolanaRpcClient;
	walletConnectors?: readonly WalletConnector[];
	websocketEndpoint?: ClusterUrl;
}>;

export type SolanaClientRuntime = {
	rpc: SolanaRpcInstance;
	rpcSubscriptions: SolanaSubscriptionsInstance;
};

export type BalanceWatcherConfig = Readonly<{
	address: Address;
	commitment?: Commitment;
}>;

export type AccountWatcherConfig = Readonly<{
	address: Address;
	commitment?: Commitment;
}>;

export type SignatureWatcherConfig = Readonly<{
	commitment?: Commitment;
	enableReceivedNotification?: boolean;
	signature: Signature;
}>;

export type WatchSubscription = Readonly<{
	abort(): void;
}>;

export type ClientActions = Readonly<{
	connectWallet(connectorId: string, options?: Readonly<{ autoConnect?: boolean }>): Promise<void>;
	disconnectWallet(): Promise<void>;
	fetchAccount(address: Address, commitment?: Commitment): Promise<AccountCacheEntry>;
	fetchBalance(address: Address, commitment?: Commitment): Promise<Lamports>;
	requestAirdrop(address: Address, lamports: Lamports): Promise<Signature>;
	sendTransaction(
		transaction: SendableTransaction & Transaction & TransactionWithLastValidBlockHeight,
		commitment?: Commitment,
	): Promise<Signature>;
	setCluster(
		endpoint: ClusterUrl,
		config?: Readonly<{ commitment?: Commitment; websocketEndpoint?: ClusterUrl }>,
	): Promise<void>;
}>;

export type ClientWatchers = Readonly<{
	watchAccount(config: AccountWatcherConfig, listener: (account: AccountCacheEntry) => void): WatchSubscription;
	watchBalance(config: BalanceWatcherConfig, listener: (lamports: Lamports) => void): WatchSubscription;
	watchSignature(config: SignatureWatcherConfig, listener: (notification: unknown) => void): WatchSubscription;
}>;

export type ClientHelpers = Readonly<{
	solTransfer: SolTransferHelper;
	splToken(config: SplTokenHelperConfig): SplTokenHelper;
	transaction: TransactionHelper;
	prepareTransaction<TMessage extends PrepareTransactionMessage>(
		config: PrepareTransactionOptions<TMessage>,
	): Promise<TMessage & TransactionMessageWithBlockhashLifetime>;
}>;

export type WalletRegistry = Readonly<{
	all: readonly WalletConnector[];
	get(id: string): WalletConnector | undefined;
}>;

export type SolanaClient = Readonly<{
	actions: ClientActions;
	config: SolanaClientConfig;
	connectors: WalletRegistry;
	destroy(): void;
	runtime: Readonly<SolanaClientRuntime>;
	store: ClientStore;
	watchers: ClientWatchers;
	helpers: ClientHelpers;
	solTransfer: SolTransferHelper;
	SolTransfer: SolTransferHelper;
	splToken(config: SplTokenHelperConfig): SplTokenHelper;
	SplToken(config: SplTokenHelperConfig): SplTokenHelper;
	SplHelper(config: SplTokenHelperConfig): SplTokenHelper;
	transaction: TransactionHelper;
	prepareTransaction: ClientHelpers['prepareTransaction'];
}>;
