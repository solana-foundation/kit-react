import type { Commitment } from '@solana/kit';
import { createStore } from 'zustand/vanilla';

import type { ClientState, ClientStore, ClusterState, ClusterStatus } from '../types';
import { deepFreeze } from '../utils';

export type ClientStoreConfig = Readonly<{
	commitment: Commitment;
	endpoint: ClusterState['endpoint'];
	websocketEndpoint?: ClusterState['websocketEndpoint'];
}>;

/**
 * Creates the initial cluster status snapshot used by the client.
 *
 * @returns Cluster status in the idle state.
 */
function createClusterStatus(): ClusterStatus {
	return { status: 'idle' };
}

/**
 * Creates the initial {@link ClientState} using the supplied cluster configuration.
 *
 * @param config - Initial cluster configuration including endpoints and commitment.
 * @returns Deep-frozen client state snapshot.
 */
export function createInitialClientState(config: ClientStoreConfig): ClientState {
	const { commitment, endpoint, websocketEndpoint } = config;
	const timestamp = Date.now();
	return deepFreeze({
		accounts: {},
		cluster: {
			commitment,
			endpoint,
			status: createClusterStatus(),
			websocketEndpoint,
		} satisfies ClusterState,
		lastUpdatedAt: timestamp,
		subscriptions: {
			account: {},
			signature: {},
		},
		transactions: {},
		wallet: { status: 'disconnected' },
	});
}

/**
 * Creates a Zustand store using the supplied initial state snapshot.
 *
 * @param initialState - State snapshot produced by {@link createInitialClientState}.
 * @returns Zustand store instance containing the provided state.
 */
export function createClientStore(initialState: ClientState): ClientStore {
	return createStore<ClientState>(() => initialState);
}

/**
 * Convenience helper that creates both the initial state and the store in one step.
 *
 * @param config - Initial cluster configuration including endpoints and commitment.
 * @returns Zustand store instance preloaded with the initial state.
 */
export function createDefaultClientStore(config: ClientStoreConfig): ClientStore {
	return createClientStore(createInitialClientState(config));
}
