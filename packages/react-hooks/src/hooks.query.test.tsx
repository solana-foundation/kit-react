// @vitest-environment jsdom

import type { SolanaClient } from '@solana/client';
import { describe, expect, it, vi } from 'vitest';

import { createAddress } from '../test/fixtures';
import { renderHookWithClient, waitFor } from '../test/utils';

import { useLatestBlockhash, useProgramAccounts, useSimulateTransaction } from './queryHooks';

function createMockRpc(overrides: Partial<SolanaClient['runtime']['rpc']> = {}) {
	return {
		getLatestBlockhash: vi.fn(() => ({
			send: vi.fn().mockResolvedValue({
				context: { slot: 1n },
				value: { blockhash: 'MockBlockhash11111111111111111111111111', lastValidBlockHeight: 10n },
			}),
		})),
		getProgramAccounts: vi.fn(() => ({ send: vi.fn().mockResolvedValue([]) })),
		simulateTransaction: vi.fn(() => ({ send: vi.fn().mockResolvedValue({ value: { logs: [] } }) })),
		...overrides,
	} as unknown as SolanaClient['runtime']['rpc'];
}

describe('useLatestBlockhash', () => {
	it('fetches blockhash data and exposes derived fields', async () => {
		const mockResponse = {
			context: { slot: 99n },
			value: { blockhash: 'TestHash111111111111111111111111111111', lastValidBlockHeight: 123n },
		};
		const send = vi.fn().mockResolvedValue(mockResponse);
		const getLatestBlockhash = vi.fn(() => ({ send }));
		const rpc = createMockRpc({ getLatestBlockhash } as Partial<SolanaClient['runtime']['rpc']>);

		const { result } = renderHookWithClient(() => useLatestBlockhash(), {
			clientOptions: { runtime: { rpc } },
		});

		await waitFor(() => {
			expect(result.current.blockhash).toBe(mockResponse.value.blockhash);
		});
		expect(result.current.lastValidBlockHeight).toBe(mockResponse.value.lastValidBlockHeight);
		expect(getLatestBlockhash).toHaveBeenCalledWith({ commitment: 'confirmed', minContextSlot: undefined });
	});
});

describe('useProgramAccounts', () => {
	it('queries program accounts with merged config', async () => {
		const programAddress = createAddress(5);
		const accounts = [
			{
				pubkey: createAddress(6),
				account: {
					data: ['base64', 'base64'],
					executable: false,
					lamports: 0n,
					owner: programAddress,
				},
			},
		];
		const send = vi.fn().mockResolvedValue(accounts);
		const getProgramAccounts = vi.fn(() => ({ send }));
		const rpc = createMockRpc({ getProgramAccounts } as Partial<SolanaClient['runtime']['rpc']>);

		const { result } = renderHookWithClient(
			() =>
				useProgramAccounts(programAddress, {
					config: { filters: [{ dataSize: 0 }], encoding: 'base64' },
					commitment: 'processed',
				}),
			{ clientOptions: { runtime: { rpc } } },
		);

		await waitFor(() => {
			expect(result.current.accounts).toHaveLength(accounts.length);
		});
		expect(getProgramAccounts).toHaveBeenCalledWith(expect.anything(), {
			commitment: 'processed',
			encoding: 'base64',
			filters: [{ dataSize: 0 }],
		});
	});
});

describe('useSimulateTransaction', () => {
	it('simulates a transaction payload when provided', async () => {
		const wireTransaction = 'Base64Transaction1111111111111111111111111111';
		const send = vi.fn().mockResolvedValue({ value: { logs: ['log-entry'] } });
		const simulateTransaction = vi.fn(() => ({ send }));
		const rpc = createMockRpc({ simulateTransaction } as Partial<SolanaClient['runtime']['rpc']>);

		const { result } = renderHookWithClient(
			() => useSimulateTransaction(wireTransaction, { commitment: 'processed' }),
			{ clientOptions: { runtime: { rpc } } },
		);

		await waitFor(() => {
			expect(result.current.logs).toEqual(['log-entry']);
		});
		expect(simulateTransaction).toHaveBeenCalledWith(wireTransaction, {
			commitment: 'processed',
		});
	});
});
