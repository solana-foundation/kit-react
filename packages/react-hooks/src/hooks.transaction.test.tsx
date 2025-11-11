// @vitest-environment jsdom

import type { TransactionPrepareAndSendRequest } from '@solana/client';
import { describe, expect, it, vi } from 'vitest';

import { createAddress, createWalletSession } from '../test/fixtures';
import { act, renderHookWithClient } from '../test/utils';

import { useSendTransaction, useTransactionPool } from './hooks';

function createInstruction(seed: number) {
	return {
		accounts: [],
		data: new Uint8Array([seed]),
		programAddress: createAddress(seed),
	};
}

describe('useTransactionPool.prepareAndSend', () => {
	it('delegates to the helper with the pooled instructions and tracks status', async () => {
		const instructions = [createInstruction(1)];
		const { client, result } = renderHookWithClient(() => useTransactionPool({ instructions }));

		await act(async () => {
			await result.current.prepareAndSend();
		});

		expect(client.helpers.transaction.prepareAndSend).toHaveBeenCalledWith(
			expect.objectContaining({ instructions }),
			undefined,
		);
		expect(result.current.sendStatus).toBe('success');
		expect(result.current.sendSignature).toBe('MockTxSignature1111111111111111111111111');
	});

	it('supports overriding instructions, prepareTransaction options, and send options', async () => {
		const logRequest = vi.fn();
		const initialInstructions = [createInstruction(2)];
		const overrideInstructions = [createInstruction(3)];
		const { client, result } = renderHookWithClient(() =>
			useTransactionPool({ instructions: initialInstructions }),
		);

		await act(async () => {
			await result.current.prepareAndSend(
				{
					instructions: overrideInstructions,
					prepareTransaction: {
						computeUnitLimitMultiplier: 1.3,
						logRequest,
					},
				},
				{ commitment: 'processed' },
			);
		});

		expect(client.helpers.transaction.prepareAndSend).toHaveBeenLastCalledWith(
			expect.objectContaining({
				instructions: overrideInstructions,
				prepareTransaction: expect.objectContaining({
					computeUnitLimitMultiplier: 1.3,
					logRequest,
				}),
			}),
			{ commitment: 'processed' },
		);
	});
});

describe('useSendTransaction', () => {
	it('calls prepareAndSend and tracks status', async () => {
		const instructions = [createInstruction(4)];
		const request: TransactionPrepareAndSendRequest = { instructions };
		const { client, result } = renderHookWithClient(() => useSendTransaction());

		await act(async () => {
			await result.current.send(request as never);
		});

		expect(client.transaction.prepareAndSend).toHaveBeenCalledWith(request, undefined);
		expect(result.current.status).toBe('success');
		expect(result.current.signature).toBe('MockTxSignature1111111111111111111111111');
	});

	it('defaults to the connected wallet session when no authority is provided', async () => {
		const instructions = [createInstruction(5)];
		const request: TransactionPrepareAndSendRequest = { instructions };
		const session = createWalletSession();
		const { client, result } = renderHookWithClient(() => useSendTransaction(), {
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

		await act(async () => {
			await result.current.send(request);
		});

		expect(client.transaction.prepareAndSend).toHaveBeenCalledWith(
			expect.objectContaining({ instructions, authority: session }),
			undefined,
		);
	});

	it('throws when no authority is available', async () => {
		const instructions = [createInstruction(6)];
		const request: TransactionPrepareAndSendRequest = { instructions };
		const { result } = renderHookWithClient(() => useSendTransaction());

		await expect(
			act(async () => {
				await result.current.send(request);
			}),
		).rejects.toThrowError('Connect a wallet or supply an `authority` before sending transactions.');
	});

	it('supports sending prepared transactions and surfaces errors', async () => {
		const error = new Error('send-error');
		const { client, result } = renderHookWithClient(() => useSendTransaction());
		client.transaction.send.mockRejectedValueOnce(error);

		await expect(
			act(async () => {
				await result.current.sendPrepared({} as never);
			}),
		).rejects.toThrowError(error);

		expect(result.current.status).toBe('error');
		expect(result.current.error).toBe(error);
	});
});
