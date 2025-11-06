// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';

import { createAddress, createLamports, createSignature, createWalletSession } from '../test/fixtures';
import { createMockSplTokenHelper } from '../test/mocks';
import { act, renderHookWithClient, waitFor } from '../test/utils';

import { useSolTransfer, useSplToken } from './hooks';

describe('transfer hooks', () => {
	it('delegates SOL transfers to the helper and tracks status', async () => {
		const session = createWalletSession();
		const destination = createAddress(20);
		const { client, result } = renderHookWithClient(() => useSolTransfer(), {
			clientOptions: {
				state: {
					wallet: {
						connectorId: session.connector.id,
						session,
						status: 'connected',
					},
				},
			},
		});

		expect(result.current.helper).toBe(client.solTransfer);
		expect(result.current.status).toBe('idle');
		expect(result.current.signature).toBeNull();

		await act(async () => {
			const signature = await result.current.send({ amount: 1n, destination });
			expect(signature).toBeDefined();
		});

		expect(client.solTransfer.sendTransfer).toHaveBeenCalledWith(
			{ amount: 1n, authority: session, destination },
			undefined,
		);
		expect(result.current.status).toBe('success');
		expect(result.current.signature).not.toBeNull();
		expect(result.current.isSending).toBe(false);

		act(() => {
			result.current.reset();
		});

		expect(result.current.signature).toBeNull();
		expect(result.current.status).toBe('idle');
	});

	it('throws when attempting to send without an authority', async () => {
		const { result } = renderHookWithClient(() => useSolTransfer());
		await expect(
			act(async () => {
				await result.current.send({ amount: 1n, destination: createAddress(30) });
			}),
		).rejects.toThrowError('Connect a wallet or supply an `authority` before sending SOL transfers.');
	});

	it('surfaces helper errors and preserves them until reset', async () => {
		const session = createWalletSession();
		const failure = new Error('sol transfer failed');
		const { client, result } = renderHookWithClient(() => useSolTransfer(), {
			clientOptions: {
				state: {
					wallet: {
						connectorId: session.connector.id,
						session,
						status: 'connected',
					},
				},
			},
		});

		client.solTransfer.sendTransfer.mockRejectedValueOnce(failure);

		await act(async () => {
			await expect(result.current.send({ amount: 2n, destination: createAddress(31) })).rejects.toThrowError(
				failure,
			);
		});

		await waitFor(() => {
			expect(result.current.status).toBe('error');
		});
		expect(result.current.error).toBe(failure);

		act(() => {
			result.current.reset();
		});

		expect(result.current.status).toBe('idle');
		expect(result.current.error).toBeNull();
	});

	it('manages SPL token helpers, balances, and transfer state', async () => {
		const session = createWalletSession();
		const mint = createAddress(40);
		const helper = createMockSplTokenHelper();
		const balance = {
			amount: createLamports(500),
			ataAddress: createAddress(41),
			decimals: 9,
			exists: true,
			uiAmount: '5.00',
		};
		helper.fetchBalance.mockResolvedValue(balance);

		const { result } = renderHookWithClient(() => useSplToken(mint, { commitment: 'processed' }), {
			clientOptions: {
				createSplTokenHelper: () => helper,
				state: {
					wallet: {
						connectorId: session.connector.id,
						session,
						status: 'connected',
					},
				},
			},
		});

		expect(result.current.helper).toBe(helper);
		expect(result.current.owner).toBe(String(session.account.address));

		await waitFor(() => {
			expect(helper.fetchBalance).toHaveBeenCalledTimes(1);
		});

		await waitFor(() => {
			expect(result.current.balance).toEqual(balance);
			expect(result.current.status).toBe('ready');
		});

		helper.sendTransfer.mockResolvedValueOnce(createSignature(101));

		await act(async () => {
			await result.current.send({
				amount: 10n,
				destinationOwner: createAddress(43),
			});
		});

		expect(helper.sendTransfer).toHaveBeenCalled();
		expect(result.current.sendStatus).toBe('success');
		expect(result.current.sendSignature).not.toBeNull();

		// The hook revalidates the balance after a successful transfer.
		await waitFor(() => {
			expect(helper.fetchBalance).toHaveBeenCalledTimes(2);
		});

		act(() => {
			result.current.resetSend();
		});

		expect(result.current.sendStatus).toBe('idle');
		expect(result.current.sendSignature).toBeNull();
		expect(result.current.sendError).toBeNull();
	});

	it('exposes a refresh helper that re-fetches balances without watchers', async () => {
		const session = createWalletSession();
		const mint = createAddress(50);
		const helper = createMockSplTokenHelper();
		helper.fetchBalance.mockResolvedValue({
			amount: createLamports(0),
			ataAddress: createAddress(51),
			decimals: 9,
			exists: false,
			uiAmount: '0',
		});

		const { result } = renderHookWithClient(() => useSplToken(mint, { watch: false }), {
			clientOptions: {
				createSplTokenHelper: () => helper,
				state: {
					wallet: {
						connectorId: session.connector.id,
						session,
						status: 'connected',
					},
				},
			},
		});

		await waitFor(() => {
			expect(helper.fetchBalance).toHaveBeenCalledTimes(1);
		});

		await act(async () => {
			await result.current.refresh();
		});

		expect(helper.fetchBalance).toHaveBeenCalledTimes(2);
	});
});
