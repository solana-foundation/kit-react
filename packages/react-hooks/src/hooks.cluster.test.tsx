// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';

import { createWalletSession } from '../test/fixtures';
import { act, renderHookWithClient } from '../test/utils';

import {
	useClusterState,
	useClusterStatus,
	useConnectWallet,
	useDisconnectWallet,
	useWallet,
	useWalletActions,
	useWalletSession,
} from './hooks';

describe('cluster and wallet hooks', () => {
	it('exposes the cluster state and reacts to updates', () => {
		const { client, result } = renderHookWithClient(() => useClusterState());
		expect(result.current).toEqual(client.store.getState().cluster);

		act(() => {
			client.store.setState((state) => ({
				...state,
				cluster: {
					...state.cluster,
					status: { latencyMs: 24, status: 'ready' },
				},
			}));
		});

		expect(result.current.status).toEqual({ latencyMs: 24, status: 'ready' });
	});

	it('returns the current cluster status slice only', () => {
		const { client, result } = renderHookWithClient(() => useClusterStatus());

		expect(result.current).toEqual({ status: 'idle' });

		act(() => {
			client.store.setState((state) => ({
				...state,
				cluster: {
					...state.cluster,
					status: { status: 'connecting' },
				},
			}));
		});

		expect(result.current).toEqual({ status: 'connecting' });
	});

	it('returns wallet state and derives the connected session', () => {
		const session = createWalletSession();
		const { client, result: walletResult } = renderHookWithClient(() => useWallet());

		expect(walletResult.current).toEqual({ status: 'disconnected' });

		const { result: sessionResult } = renderHookWithClient(() => useWalletSession(), { client });
		expect(sessionResult.current).toBeUndefined();

		act(() => {
			client.store.setState((state) => ({
				...state,
				wallet: {
					connectorId: session.connector.id,
					session,
					status: 'connected',
				},
			}));
		});

		expect(walletResult.current).toEqual({
			connectorId: session.connector.id,
			session,
			status: 'connected',
		});
		expect(sessionResult.current).toBe(session);
	});

	it('exposes the client actions directly', () => {
		const { client, result } = renderHookWithClient(() => useWalletActions());
		expect(result.current).toBe(client.actions);
	});

	it('wraps connectWallet with a stable callback', async () => {
		const { client, rerender, result } = renderHookWithClient(() => useConnectWallet());
		const first = result.current;
		await result.current('test-connector', { autoConnect: true });
		expect(client.actions.connectWallet).toHaveBeenCalledWith('test-connector', { autoConnect: true });
		rerender();
		expect(result.current).toBe(first);
	});

	it('wraps disconnectWallet with a stable callback', async () => {
		const { client, rerender, result } = renderHookWithClient(() => useDisconnectWallet());
		const first = result.current;
		client.actions.disconnectWallet.mockResolvedValueOnce(undefined);
		await result.current();
		expect(client.actions.disconnectWallet).toHaveBeenCalledTimes(1);
		rerender();
		expect(result.current).toBe(first);
	});
});
