import { describe, expect, it } from 'vitest';
import { createWalletRegistry } from './registry';
import type { WalletConnector } from './types';

describe('wallet registry', () => {
	const connector = (id: string): WalletConnector => ({
		id,
		name: `wallet-${id}`,
		connect: async () => {
			throw new Error('not implemented');
		},
		disconnect: async () => undefined,
		isSupported: () => true,
	});

	it('deduplicates connectors by id and exposes lookups', () => {
		const registry = createWalletRegistry([connector('a'), connector('b'), connector('a')]);
		expect(registry.all).toHaveLength(2);
		expect(registry.get('a')?.id).toBe('a');
		expect(registry.get('unknown')).toBeUndefined();
	});
});
