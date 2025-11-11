import type {
	Address,
	ClusterUrl,
	Commitment,
	Lamports,
	SendableTransaction,
	Signature,
	Transaction,
} from '@solana/kit';
import { airdropFactory, getBase64EncodedWireTransaction } from '@solana/kit';
import type { TransactionWithLastValidBlockHeight } from '@solana/transaction-confirmation';
import {
	createBlockHeightExceedencePromiseFactory,
	createRecentSignatureConfirmationPromiseFactory,
	waitForRecentTransactionConfirmation,
} from '@solana/transaction-confirmation';

import { createLogger, formatError } from '../logging/logger';
import { createSolanaRpcClient } from '../rpc/createSolanaRpcClient';
import type { ClientActions, ClientState, ClientStore, SolanaClientRuntime, WalletRegistry } from '../types';
import { now } from '../utils';

type MutableRuntime = SolanaClientRuntime;

type ActionDeps = Readonly<{
	connectors: WalletRegistry;
	logger?: ReturnType<typeof createLogger>;
	runtime: MutableRuntime;
	store: ClientStore;
}>;

/**
 * Updates the client store while also refreshing the `lastUpdatedAt` timestamp.
 *
 * @param store - Zustand store instance that holds {@link ClientState}.
 * @param update - Partial set of fields that should be merged into the state.
 * @returns Nothing; mutates the provided store.
 */
function updateState(store: ClientStore, update: Partial<ClientState>): void {
	store.setState((state) => ({
		...state,
		...update,
		lastUpdatedAt: now(),
	}));
}

/**
 * Creates the action set used by the Solana client POC.
 *
 * @param deps - Dependencies required to build the action set.
 * @returns An immutable collection implementing {@link ClientActions}.
 */
export function createActions({ connectors, logger: inputLogger, runtime, store }: ActionDeps): ClientActions {
	const logger = inputLogger ?? createLogger();

	/**
	 * Returns the commitment to use for a request, falling back to the store default.
	 *
	 * @param commitment - Explicit commitment override.
	 * @returns The resolved commitment value.
	 */
	function getCommitment(commitment?: Commitment): Commitment {
		return commitment ?? store.getState().cluster.commitment;
	}

	/**
	 * Performs a warm-up RPC call so the client can measure cluster latency.
	 *
	 * @param endpoint - RPC HTTP endpoint.
	 * @param commitment - Commitment that should be used for the test call.
	 * @returns Milliseconds spent waiting for the cluster or `undefined` on failure.
	 */
	async function warmupCluster(endpoint: ClusterUrl, commitment: Commitment): Promise<number | undefined> {
		try {
			const start = now();
			await runtime.rpc.getLatestBlockhash({ commitment }).send({ abortSignal: AbortSignal.timeout(10_000) });
			return now() - start;
		} catch (error) {
			logger({
				data: { endpoint, ...formatError(error) },
				level: 'warn',
				message: 'cluster warmup failed',
			});
			return undefined;
		}
	}

	/**
	 * Reconfigures the client to target the specified cluster.
	 *
	 * @param endpoint - Base RPC endpoint URL.
	 * @param config - Optional commitment and websocket overrides.
	 * @returns Promise that resolves once the cluster has been reconfigured.
	 */
	async function setCluster(
		endpoint: ClusterUrl,
		config?: Readonly<{ commitment?: Commitment; websocketEndpoint?: ClusterUrl }>,
	): Promise<void> {
		const nextCommitment = config?.commitment ?? store.getState().cluster.commitment;
		const websocketEndpoint = config?.websocketEndpoint ?? endpoint;
		store.setState((state) => ({
			...state,
			cluster: {
				commitment: nextCommitment,
				endpoint,
				status: { status: 'connecting' },
				websocketEndpoint,
			},
			lastUpdatedAt: now(),
		}));
		try {
			const newRpcClient = createSolanaRpcClient({
				commitment: nextCommitment,
				endpoint,
				websocketEndpoint,
			});
			runtime.rpc = newRpcClient.rpc;
			runtime.rpcSubscriptions = newRpcClient.rpcSubscriptions;
			const latencyMs = await warmupCluster(endpoint, nextCommitment);
			store.setState((state) => ({
				...state,
				cluster: {
					commitment: nextCommitment,
					endpoint,
					status: { latencyMs, status: 'ready' },
					websocketEndpoint,
				},
				lastUpdatedAt: now(),
			}));
			logger({
				data: { endpoint, latencyMs, websocketEndpoint },
				level: 'info',
				message: 'cluster ready',
			});
		} catch (error) {
			store.setState((state) => ({
				...state,
				cluster: {
					commitment: nextCommitment,
					endpoint,
					status: { error, status: 'error' },
					websocketEndpoint,
				},
				lastUpdatedAt: now(),
			}));
			logger({
				data: { endpoint, ...formatError(error) },
				level: 'error',
				message: 'cluster setup failed',
			});
			throw error;
		}
	}

	/**
	 * Initiates a wallet connection using a registered connector.
	 *
	 * @param connectorId - Identifier for the desired wallet connector.
	 * @returns Promise that resolves once the connection attempt has completed.
	 */
	async function connectWallet(
		connectorId: string,
		options: Readonly<{ autoConnect?: boolean }> = {},
	): Promise<void> {
		const connector = connectors.get(connectorId);
		if (!connector) {
			throw new Error(`No wallet connector registered for id "${connectorId}".`);
		}
		if (!connector.isSupported()) {
			throw new Error(`Wallet connector "${connectorId}" is not supported in this environment.`);
		}
		store.setState((state) => ({
			...state,
			lastUpdatedAt: now(),
			wallet: { connectorId, status: 'connecting' },
		}));
		try {
			const session = await connector.connect(options);
			store.setState((state) => ({
				...state,
				lastUpdatedAt: now(),
				wallet: { connectorId, session, status: 'connected' },
			}));
			logger({
				data: { address: session.account.address.toString(), connectorId },
				level: 'info',
				message: 'wallet connected',
			});
		} catch (error) {
			store.setState((state) => ({
				...state,
				lastUpdatedAt: now(),
				wallet: { connectorId, error, status: 'error' },
			}));
			logger({
				data: { connectorId, ...formatError(error) },
				level: 'error',
				message: 'wallet connection failed',
			});
			throw error;
		}
	}

	/**
	 * Disconnects the currently active wallet session if one exists.
	 *
	 * @returns Promise that resolves once the wallet has been disconnected.
	 */
	async function disconnectWallet(): Promise<void> {
		const wallet = store.getState().wallet;
		if (wallet.status === 'disconnected') {
			return;
		}
		try {
			if (wallet.status === 'connected') {
				await wallet.session.disconnect();
				const connector = connectors.get(wallet.connectorId);
				if (connector) {
					await connector.disconnect();
				}
			} else if (wallet.status === 'connecting') {
				const connector = connectors.get(wallet.connectorId);
				if (connector) {
					await connector.disconnect();
				}
			}
		} finally {
			updateState(store, { wallet: { status: 'disconnected' } });
		}
	}

	/**
	 * Fetches the current lamport balance for an address and updates the cache.
	 *
	 * @param address - Target account address.
	 * @param commitment - Optional commitment override for the RPC call.
	 * @returns Promise resolving with the lamport balance retrieved from the cluster.
	 */
	async function fetchBalance(address: Address, commitment?: Commitment): Promise<Lamports> {
		const key = address.toString();
		store.setState((state) => ({
			...state,
			accounts: {
				...state.accounts,
				[key]: {
					address,
					data: state.accounts[key]?.data,
					error: undefined,
					fetching: true,
					lamports: state.accounts[key]?.lamports ?? null,
					lastFetchedAt: now(),
					slot: state.accounts[key]?.slot ?? null,
				},
			},
			lastUpdatedAt: now(),
		}));
		try {
			const response = await runtime.rpc
				.getBalance(address, { commitment: getCommitment(commitment) })
				.send({ abortSignal: AbortSignal.timeout(10_000) });
			const lamports = response.value;
			store.setState((state) => ({
				...state,
				accounts: {
					...state.accounts,
					[key]: {
						address,
						data: state.accounts[key]?.data,
						error: undefined,
						fetching: false,
						lamports,
						lastFetchedAt: now(),
						slot: response.context.slot,
					},
				},
				lastUpdatedAt: now(),
			}));
			return lamports;
		} catch (error) {
			store.setState((state) => ({
				...state,
				accounts: {
					...state.accounts,
					[key]: {
						address,
						data: state.accounts[key]?.data,
						error,
						fetching: false,
						lamports: state.accounts[key]?.lamports ?? null,
						lastFetchedAt: now(),
						slot: state.accounts[key]?.slot ?? null,
					},
				},
				lastUpdatedAt: now(),
			}));
			logger({
				data: { address: key, ...formatError(error) },
				level: 'error',
				message: 'balance fetch failed',
			});
			throw error;
		}
	}

	/**
	 * Fetches full account data and writes the result to the cache.
	 *
	 * @param address - Target account address.
	 * @param commitment - Optional commitment override for the RPC call.
	 * @returns Promise resolving with the cached account entry after the fetch completes.
	 */
	async function fetchAccount(address: Address, commitment?: Commitment) {
		const key = address.toString();
		store.setState((state) => ({
			...state,
			accounts: {
				...state.accounts,
				[key]: {
					address,
					data: state.accounts[key]?.data,
					error: undefined,
					fetching: true,
					lamports: state.accounts[key]?.lamports ?? null,
					lastFetchedAt: now(),
					slot: state.accounts[key]?.slot ?? null,
				},
			},
			lastUpdatedAt: now(),
		}));
		try {
			const response = await runtime.rpc
				.getAccountInfo(address, { commitment: getCommitment(commitment), encoding: 'base64' })
				.send({ abortSignal: AbortSignal.timeout(10_000) });
			const value = response.value;
			const lamports = value?.lamports ?? null;
			store.setState((state) => ({
				...state,
				accounts: {
					...state.accounts,
					[key]: {
						address,
						data: value,
						error: undefined,
						fetching: false,
						lamports,
						lastFetchedAt: now(),
						slot: response.context.slot,
					},
				},
				lastUpdatedAt: now(),
			}));
			return store.getState().accounts[key];
		} catch (error) {
			store.setState((state) => ({
				...state,
				accounts: {
					...state.accounts,
					[key]: {
						address,
						data: state.accounts[key]?.data,
						error,
						fetching: false,
						lamports: state.accounts[key]?.lamports ?? null,
						lastFetchedAt: now(),
						slot: state.accounts[key]?.slot ?? null,
					},
				},
				lastUpdatedAt: now(),
			}));
			logger({
				data: { address: key, ...formatError(error) },
				level: 'error',
				message: 'account fetch failed',
			});
			throw error;
		}
	}

	/**
	 * Sends a transaction and waits for confirmation using the runtime helpers.
	 *
	 * @param transaction - Transaction to submit.
	 * @param commitment - Optional commitment override for confirmation.
	 * @returns Promise resolving with the signature for the submitted transaction.
	 */
	async function sendTransaction(
		transaction: SendableTransaction & Transaction & TransactionWithLastValidBlockHeight,
		commitment?: Commitment,
	): Promise<Signature> {
		const targetCommitment = getCommitment(commitment);
		const abortController = new AbortController();
		const signature = await runtime.rpc
			.sendTransaction(getBase64EncodedWireTransaction(transaction), {
				encoding: 'base64',
				preflightCommitment: targetCommitment,
			})
			.send({ abortSignal: abortController.signal });
		const key = signature.toString();
		store.setState((state) => ({
			...state,
			lastUpdatedAt: now(),
			transactions: {
				...state.transactions,
				[key]: {
					lastUpdatedAt: now(),
					signature,
					status: 'sending',
				},
			},
		}));
		const getBlockHeightExceedencePromise = createBlockHeightExceedencePromiseFactory({
			rpc: runtime.rpc,
			rpcSubscriptions: runtime.rpcSubscriptions,
		} as Parameters<typeof createBlockHeightExceedencePromiseFactory>[0]);
		const getRecentSignatureConfirmationPromise = createRecentSignatureConfirmationPromiseFactory({
			rpc: runtime.rpc,
			rpcSubscriptions: runtime.rpcSubscriptions,
		} as Parameters<typeof createRecentSignatureConfirmationPromiseFactory>[0]);
		try {
			await waitForRecentTransactionConfirmation({
				abortSignal: abortController.signal,
				commitment: targetCommitment,
				getBlockHeightExceedencePromise,
				getRecentSignatureConfirmationPromise,
				transaction,
			});
			store.setState((state) => ({
				...state,
				lastUpdatedAt: now(),
				transactions: {
					...state.transactions,
					[key]: {
						lastUpdatedAt: now(),
						signature,
						status: 'confirmed',
					},
				},
			}));
			return signature;
		} catch (error) {
			store.setState((state) => ({
				...state,
				lastUpdatedAt: now(),
				transactions: {
					...state.transactions,
					[key]: {
						error,
						lastUpdatedAt: now(),
						signature,
						status: 'failed',
					},
				},
			}));
			logger({
				data: { signature: key, ...formatError(error) },
				level: 'error',
				message: 'transaction failed to confirm',
			});
			throw error;
		}
	}

	/**
	 * Requests an airdrop on supported clusters.
	 *
	 * @param address - Address to receive the airdrop.
	 * @param lamports - Amount of lamports requested.
	 * @returns Promise resolving with the signature for the airdrop transaction.
	 */
	async function requestAirdrop(address: Address, lamports: Lamports) {
		if (!('requestAirdrop' in runtime.rpc)) {
			throw new Error('The current RPC endpoint does not support airdrops.');
		}
		const factory = airdropFactory({
			rpc: runtime.rpc,
			rpcSubscriptions: runtime.rpcSubscriptions,
		} as Parameters<typeof airdropFactory>[0]);
		const signature = await factory({
			commitment: getCommitment('confirmed'),
			lamports,
			recipientAddress: address,
		});
		logger({
			data: { address: address.toString(), lamports: lamports.toString(), signature },
			level: 'info',
			message: 'airdrop requested',
		});
		return signature;
	}

	return {
		connectWallet,
		disconnectWallet,
		fetchAccount,
		fetchBalance,
		requestAirdrop,
		sendTransaction,
		setCluster,
	};
}
