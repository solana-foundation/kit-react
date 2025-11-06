// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';

import { act, renderHookWithClient } from '../test/utils';

import { useClientStore } from './useClientStore';

describe('useClientStore', () => {
	it('returns the full client state when no selector is provided', () => {
		const { client, result } = renderHookWithClient(() => useClientStore());
		expect(result.current).toEqual(client.store.getState());

		act(() => {
			client.store.setState((state) => ({
				...state,
				lastUpdatedAt: state.lastUpdatedAt + 1,
			}));
		});

		expect(result.current.lastUpdatedAt).toBe(client.store.getState().lastUpdatedAt);
	});

	it('applies the selector and updates when the selected slice changes', () => {
		const { client, result } = renderHookWithClient(() => useClientStore((state) => state.cluster.status));

		expect(result.current).toEqual({ status: 'idle' });

		act(() => {
			client.store.setState((state) => ({
				...state,
				cluster: {
					...state.cluster,
					status: { latencyMs: 12, status: 'ready' },
				},
			}));
		});

		expect(result.current).toEqual({ latencyMs: 12, status: 'ready' });

		const previous = result.current;

		act(() => {
			client.store.setState((state) => ({
				...state,
				transactions: state.transactions,
			}));
		});

		expect(result.current).toBe(previous);
	});
});
