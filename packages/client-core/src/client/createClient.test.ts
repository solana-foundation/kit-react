import { afterEach, describe, expect, it, vi } from 'vitest';

import type { SolanaClientConfig } from '../types';
import { createClient } from './createClient';

type ActionSet = ReturnType<typeof createActionsMock>;

type Logger = ReturnType<ReturnType<typeof createLoggerMock>>;

type Helpers = ReturnType<typeof createClientHelpersMock>;

const createSolanaRpcMock = vi.hoisted(() => vi.fn(() => ({ rpc: true })));
const createSolanaRpcSubscriptionsMock = vi.hoisted(() => vi.fn(() => ({ sub: true })));
const createActionsMock = vi.hoisted(() =>
	vi.fn(() => ({
		setCluster: vi.fn().mockResolvedValue(undefined),
	})),
);
const createWatchersMock = vi.hoisted(() =>
	vi.fn(() => ({
		watchAccount: vi.fn(),
	})),
);
const createClientHelpersMock = vi.hoisted(() =>
	vi.fn(() => ({
		solTransfer: { tag: 'sol-helper' },
		splToken: vi.fn(),
		transaction: { tag: 'transaction-helper' },
	})),
);
const createWalletRegistryMock = vi.hoisted(() =>
	vi.fn(() => ({
		all: [{ id: 'wallet' }],
		get: vi.fn(),
	})),
);
const createLoggerMock = vi.hoisted(() => vi.fn(() => vi.fn()));
const formatErrorMock = vi.hoisted(() => vi.fn((error: unknown) => ({ formatted: error })));
const nowMock = vi.hoisted(() => vi.fn(() => 111));

vi.mock('@solana/kit', () => ({
	createSolanaRpc: createSolanaRpcMock,
	createSolanaRpcSubscriptions: createSolanaRpcSubscriptionsMock,
}));

vi.mock('../logging/logger', () => ({
	createLogger: createLoggerMock,
	formatError: formatErrorMock,
}));

vi.mock('./actions', () => ({
	createActions: createActionsMock,
}));

vi.mock('./watchers', () => ({
	createWatchers: createWatchersMock,
}));

vi.mock('./createClientHelpers', () => ({
	createClientHelpers: createClientHelpersMock,
}));

vi.mock('../wallet/registry', () => ({
	createWalletRegistry: createWalletRegistryMock,
}));

vi.mock('../utils', async (original) => {
	const actual = await original();
	return {
		...actual,
		now: nowMock,
	};
});

afterEach(() => {
	vi.clearAllMocks();
});

describe('createClient', () => {
	const config: SolanaClientConfig = {
		endpoint: 'https://rpc.example',
		commitment: 'finalized',
		walletConnectors: [
			{ id: 'wallet', name: 'Wallet', connect: vi.fn(), disconnect: vi.fn(), isSupported: () => true },
		],
	};

	it('instantiates the client with runtime wiring and helpers', async () => {
		const client = createClient(config);
		expect(createSolanaRpcMock).toHaveBeenCalledWith('https://rpc.example');
		expect(createSolanaRpcSubscriptionsMock).toHaveBeenCalledWith('https://rpc.example');
		expect(createWalletRegistryMock).toHaveBeenCalledWith(config.walletConnectors);
		expect(createActionsMock).toHaveBeenCalled();
		expect(createWatchersMock).toHaveBeenCalled();
		expect(createClientHelpersMock).toHaveBeenCalled();

		const actions = createActionsMock.mock.results[0].value as ActionSet;
		expect(actions.setCluster).toHaveBeenCalledWith('https://rpc.example', {
			commitment: 'finalized',
			websocketEndpoint: 'https://rpc.example',
		});

		const helpers = createClientHelpersMock.mock.results[0].value as Helpers;
		expect(client.helpers.transaction).toEqual({ tag: 'transaction-helper' });
		expect(client.solTransfer).toEqual({ tag: 'sol-helper' });
		expect(client.splToken).toBe(helpers.splToken);
		expect(client.SplToken).toBe(helpers.splToken);

		client.destroy();
		expect(client.store.getState().cluster.status).toEqual({ status: 'idle' });
	});

	it('logs errors when initial cluster setup fails', async () => {
		const logger = vi.fn();
		createLoggerMock.mockReturnValueOnce(logger as Logger);
		createActionsMock.mockReturnValueOnce({
			setCluster: vi.fn().mockRejectedValue(new Error('boom')),
		});

		createClient(config);
		await Promise.resolve();
		await Promise.resolve();

		expect(logger).toHaveBeenCalledWith(
			expect.objectContaining({
				level: 'error',
				message: 'initial cluster setup failed',
			}),
		);
		expect(formatErrorMock).toHaveBeenCalledWith(expect.any(Error));
	});
});
