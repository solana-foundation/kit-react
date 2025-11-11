import type { WalletConnector, WalletRegistry } from '../types';

/**
 * Creates an in-memory wallet registry from the provided connectors.
 *
 * @param connectors - Wallet connector implementations to register.
 * @returns A registry exposing iteration and lookup helpers.
 */
export function createWalletRegistry(connectors: readonly WalletConnector[]): WalletRegistry {
	const byId = new Map<string, WalletConnector>();
	for (const connector of connectors) {
		if (!byId.has(connector.id)) {
			byId.set(connector.id, connector);
		}
	}
	return {
		all: [...byId.values()],
		/**
		 * Looks up a connector by identifier.
		 *
		 * @param id - Unique connector identifier.
		 * @returns The registered connector, if present.
		 */
		get(id: string) {
			return byId.get(id);
		},
	};
}
