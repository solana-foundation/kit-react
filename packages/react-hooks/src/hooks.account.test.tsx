// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';

import { createAccountEntry, createAddress, createLamports } from '../test/fixtures';
import { act, renderHookWithClient, waitFor } from '../test/utils';

import { useAccount, useBalance } from './hooks';

describe('account hooks', () => {
	it('fetches and watches an account by default', async () => {
		const address = createAddress(1);
		const entry = createAccountEntry({ address, lamports: createLamports(100) });

		const { client, result, unmount } = renderHookWithClient(() =>
			useAccount(address, { commitment: 'processed', watch: true }),
		);

		act(() => {
			client.store.setState((state) => ({
				...state,
				accounts: {
					...state.accounts,
					[address.toString()]: entry,
				},
			}));
		});

		expect(result.current).toEqual(entry);

		await waitFor(() => {
			expect(client.actions.fetchAccount).toHaveBeenCalledWith(address, 'processed');
		});

		const watchCall = client.watchers.watchAccount.mock.calls[0];
		expect(watchCall).toEqual([{ address, commitment: 'processed' }, expect.any(Function)]);

		const subscription = client.watchers.watchAccount.mock.results[0]?.value;
		expect(subscription?.abort).toBeInstanceOf(Function);

		unmount();
		expect(subscription?.abort).toHaveBeenCalledTimes(1);
	});

	it('skips fetches when disabled and when no address is provided', async () => {
		const address = createAddress(2);
		const { client, result } = renderHookWithClient(() => useAccount(undefined, { commitment: 'confirmed' }));
		expect(result.current).toBeUndefined();
		expect(client.actions.fetchAccount).not.toHaveBeenCalled();
		expect(client.watchers.watchAccount).not.toHaveBeenCalled();

		const { client: clientWithSkip } = renderHookWithClient(() => useAccount(address, { fetch: false }));
		await waitFor(() => {
			expect(clientWithSkip.actions.fetchAccount).not.toHaveBeenCalled();
		});
		expect(clientWithSkip.watchers.watchAccount).not.toHaveBeenCalled();
	});

	it('tracks lamport balances and watcher state', async () => {
		const address = createAddress(3);
		const entry = createAccountEntry({
			address,
			fetching: true,
			lamports: createLamports(42),
			slot: BigInt(99),
		});

		const { client, result, unmount } = renderHookWithClient(() =>
			useBalance(address, { commitment: 'finalized' }),
		);

		act(() => {
			client.store.setState((state) => ({
				...state,
				accounts: {
					...state.accounts,
					[address.toString()]: entry,
				},
			}));
		});

		expect(result.current).toEqual({
			account: entry,
			error: entry.error,
			fetching: entry.fetching,
			lamports: entry.lamports,
			slot: entry.slot,
		});

		await waitFor(() => {
			expect(client.actions.fetchBalance).toHaveBeenCalledWith(address, 'finalized');
		});

		expect(client.watchers.watchBalance).toHaveBeenCalledWith(
			{ address, commitment: 'finalized' },
			expect.any(Function),
		);

		const balanceSubscription = client.watchers.watchBalance.mock.results[0]?.value;
		unmount();
		expect(balanceSubscription?.abort).toHaveBeenCalledTimes(1);
	});

	it('respects skip options when monitoring balances', async () => {
		const address = createAddress(4);
		const { client } = renderHookWithClient(() => useBalance(address, { fetch: false, watch: false }));

		await waitFor(() => {
			expect(client.actions.fetchBalance).not.toHaveBeenCalled();
		});
		expect(client.watchers.watchBalance).not.toHaveBeenCalled();
	});
});
