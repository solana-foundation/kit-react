import { afterEach, describe, expect, it, vi } from 'vitest';

import { createClientStore, createDefaultClientStore, createInitialClientState } from './createClientStore';

const baseConfig = {
	commitment: 'confirmed' as const,
	endpoint: 'https://example.rpc',
	websocketEndpoint: 'wss://example.rpc',
};

afterEach(() => {
	vi.useRealTimers();
});

describe('client store creation', () => {
	it('creates a frozen initial state with defaults', () => {
		vi.useFakeTimers().setSystemTime(new Date('2024-02-01T00:00:00.000Z'));
		const state = createInitialClientState(baseConfig);
		expect(state.cluster).toEqual({
			commitment: 'confirmed',
			endpoint: 'https://example.rpc',
			status: { status: 'idle' },
			websocketEndpoint: 'wss://example.rpc',
		});
		expect(state.wallet).toEqual({ status: 'disconnected' });
		expect(state.lastUpdatedAt).toBe(Date.now());
		expect(Object.isFrozen(state)).toBe(true);
		expect(Object.isFrozen(state.accounts)).toBe(true);
		expect(Object.isFrozen(state.subscriptions.account)).toBe(true);
	});

	it('creates a store seeded with the frozen state', () => {
		const initial = createInitialClientState(baseConfig);
		const store = createClientStore(initial);
		expect(store.getState()).toBe(initial);
	});

	it('builds default store and exposes state', () => {
		const store = createDefaultClientStore(baseConfig);
		expect(store.getState().cluster.endpoint).toBe('https://example.rpc');
	});
});
