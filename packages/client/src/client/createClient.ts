import { createLogger, formatError } from '../logging/logger';
import { createSolanaRpcClient } from '../rpc/createSolanaRpcClient';
import type { ClientStore, SolanaClient, SolanaClientConfig, SolanaClientRuntime } from '../types';
import { now } from '../utils';
import { createWalletRegistry } from '../wallet/registry';
import { createActions } from './actions';
import { createClientHelpers } from './createClientHelpers';
import { createClientStore, createInitialClientState } from './createClientStore';
import { createWatchers } from './watchers';

/**
 * Creates a Solana client instance using the provided configuration.
 *
 * @param config - High-level configuration supplied by integrators.
 * @returns Fully initialized {@link SolanaClient} instance.
 */
export function createClient(config: SolanaClientConfig): SolanaClient {
	const commitment = config.commitment ?? 'confirmed';
	const websocketEndpoint = config.websocketEndpoint ?? config.endpoint;
	const initialState = createInitialClientState({
		commitment,
		endpoint: config.endpoint,
		websocketEndpoint,
	});
	const store: ClientStore = config.createStore ? config.createStore(initialState) : createClientStore(initialState);
	const rpcClient =
		config.rpcClient ??
		createSolanaRpcClient({
			commitment,
			endpoint: config.endpoint,
			websocketEndpoint,
		});
	const runtime: SolanaClientRuntime = {
		rpc: rpcClient.rpc,
		rpcSubscriptions: rpcClient.rpcSubscriptions,
	};
	const connectors = createWalletRegistry(config.walletConnectors ?? []);
	const logger = createLogger(config.logger);
	const actions = createActions({ connectors, logger, runtime, store });
	const watchers = createWatchers({ logger, runtime, store });
	const helpers = createClientHelpers(runtime, store);
	store.setState((state) => ({
		...state,
		cluster: {
			...state.cluster,
			status: { status: 'connecting' },
		},
		lastUpdatedAt: now(),
	}));
	actions.setCluster(config.endpoint, { commitment, websocketEndpoint }).catch((error) =>
		logger({
			data: formatError(error),
			level: 'error',
			message: 'initial cluster setup failed',
		}),
	);
	/**
	 * Resets the client's store back to its initial state.
	 *
	 * @returns Nothing; resets store contents.
	 */
	function destroy(): void {
		store.setState(() => initialState);
	}
	return {
		actions,
		config,
		connectors,
		destroy,
		get helpers() {
			return helpers;
		},
		runtime,
		store,
		get solTransfer() {
			return helpers.solTransfer;
		},
		get SolTransfer() {
			return helpers.solTransfer;
		},
		splToken: helpers.splToken,
		SplToken: helpers.splToken,
		SplHelper: helpers.splToken,
		get transaction() {
			return helpers.transaction;
		},
		prepareTransaction: helpers.prepareTransaction,
		watchers,
	};
}
