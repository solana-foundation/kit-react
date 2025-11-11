import type { ClientState } from '@solana/client';
import { useStore } from 'zustand';

import { useSolanaClient } from './context';

type Selector<T> = (state: ClientState) => T;
const identitySelector = (state: ClientState): ClientState => state;

export function useClientStore(): ClientState;
export function useClientStore<T>(selector: Selector<T>): T;
/**
 * Subscribe to the underlying Zustand store exposed by {@link SolanaClient}.
 *
 * @param selector - Derives the slice of state to observe. Defaults to the entire state.
 * @returns Selected state slice that triggers re-render when it changes.
 */
export function useClientStore<T>(selector?: Selector<T>): ClientState | T {
	const client = useSolanaClient();
	const appliedSelector = selector ?? (identitySelector as Selector<T>);
	const slice = useStore(client.store, appliedSelector);
	return selector ? slice : (slice as unknown as ClientState);
}
