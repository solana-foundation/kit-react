import type { Address, Signature } from '@solana/kit';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ClientStore, SolanaClientRuntime } from '../types';
import { createDefaultClientStore } from './createClientStore';
import { createWatchers } from './watchers';

const createLoggerMock = vi.hoisted(() => vi.fn(() => vi.fn()));
const formatErrorMock = vi.hoisted(() => vi.fn((error: unknown) => ({ formatted: error })));

vi.mock('../logging/logger', () => ({
	createLogger: createLoggerMock,
	formatError: formatErrorMock,
}));

describe('client watchers', () => {
	let store: ClientStore;
	let runtime: SolanaClientRuntime;
	const accountNotifications = vi.fn();
	const signatureNotifications = vi.fn();

	const flushAsync = () => new Promise((resolve) => setTimeout(resolve, 0));

	beforeEach(() => {
		store = createDefaultClientStore({
			commitment: 'confirmed',
			endpoint: 'https://rpc',
			websocketEndpoint: 'wss://rpc',
		});
		vi.clearAllMocks();
		runtime = {
			rpc: {} as never,
			rpcSubscriptions: {
				accountNotifications,
				signatureNotifications,
			} as unknown as SolanaClientRuntime['rpcSubscriptions'],
		};
	});

	it('watches accounts and updates store entries', async () => {
		const address = { toString: () => 'addr' } as unknown as Address;
		const notifications = [
			{ value: { lamports: 5n, data: { foo: 'bar' } }, context: { slot: 1n } },
			{ value: { lamports: 10n, data: { foo: 'baz' } }, context: { slot: 2n } },
		];
		accountNotifications.mockReturnValue({
			subscribe: vi.fn(async ({ abortSignal }: { abortSignal: AbortSignal }) => {
				async function* iterator() {
					for (const item of notifications) {
						if (abortSignal.aborted) {
							return;
						}
						yield item;
					}
				}
				return iterator();
			}),
		});

		const listener = vi.fn();
		const watchers = createWatchers({ runtime, store, logger: createLoggerMock() });
		const subscription = watchers.watchAccount({ address }, listener);
		await flushAsync();
		subscription.abort();

		expect(listener).toHaveBeenCalledTimes(2);
		const cached = store.getState().accounts.addr;
		expect(cached.lamports).toBe(10n);
		expect(store.getState().subscriptions.account.addr).toMatchObject({ status: 'inactive' });
	});

	it('watches balances and forwards lamport updates', async () => {
		const address = { toString: () => 'balanceAddr' } as unknown as Address;
		accountNotifications.mockReturnValue({
			subscribe: vi.fn(async () => {
				async function* iterator() {
					yield { value: { lamports: 99n }, context: { slot: 3n } };
				}
				return iterator();
			}),
		});
		const listener = vi.fn();
		const watchers = createWatchers({ runtime, store, logger: createLoggerMock() });
		watchers.watchBalance({ address }, listener);
		await flushAsync();
		expect(listener).toHaveBeenCalledWith(99n);
	});

	it('watches signatures and marks transactions waiting', async () => {
		const signature = { toString: () => 'sig123' } as unknown as Signature;
		signatureNotifications.mockReturnValue({
			subscribe: vi.fn(async () => {
				async function* iterator() {
					yield { context: { slot: 10n } };
				}
				return iterator();
			}),
		});
		const watchers = createWatchers({ runtime, store, logger: createLoggerMock() });
		const listener = vi.fn();
		watchers.watchSignature({ signature }, listener);
		await flushAsync();
		const record = store.getState().transactions.sig123;
		expect(record).toBeDefined();
		expect(record?.status).toBe('waiting');
	});

	it('logs subscription errors when not aborted', async () => {
		const address = { toString: () => 'addr' } as unknown as Address;
		const logger = vi.fn();
		accountNotifications.mockReturnValue({
			subscribe: vi.fn(async () => {
				throw new Error('subscribe failed');
			}),
		});
		const watchers = createWatchers({ runtime, store, logger });
		watchers.watchAccount({ address }, () => undefined);
		await flushAsync();
		expect(logger).toHaveBeenCalledWith(
			expect.objectContaining({
				level: 'error',
				message: 'account subscription failed',
			}),
		);
	});
});
