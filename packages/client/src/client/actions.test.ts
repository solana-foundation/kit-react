import type { Address, Lamports, SendableTransaction, Signature, Transaction } from '@solana/kit';
import type { TransactionWithLastValidBlockHeight } from '@solana/transaction-confirmation';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ClientActions, SolanaClientRuntime, WalletConnector, WalletRegistry } from '../types';
import { createActions } from './actions';
import { createDefaultClientStore } from './createClientStore';

const getBase64EncodedWireTransactionMock = vi.hoisted(() => vi.fn((tx: unknown) => `wire:${String(tx)}`));
const airdropFactoryMock = vi.hoisted(() => vi.fn());
const createBlockHeightExceedencePromiseFactoryMock = vi.hoisted(() => vi.fn());
const createRecentSignatureConfirmationPromiseFactoryMock = vi.hoisted(() => vi.fn());
const waitForRecentTransactionConfirmationMock = vi.hoisted(() => vi.fn());
const createLoggerMock = vi.hoisted(() => vi.fn(() => vi.fn()));
const formatErrorMock = vi.hoisted(() => vi.fn((error: unknown) => ({ formatted: error })));
const nowMock = vi.hoisted(() => {
	let current = 1000;
	return vi.fn(() => ++current);
});

const createSolanaRpcClientMock = vi.hoisted(() =>
	vi.fn(() => ({
		commitment: 'confirmed',
		endpoint: 'https://rpc.test',
		rpc: {} as SolanaClientRuntime['rpc'],
		rpcSubscriptions: {} as SolanaClientRuntime['rpcSubscriptions'],
		sendAndConfirmTransaction: vi.fn(),
		simulateTransaction: vi.fn(),
		websocketEndpoint: 'wss://rpc.test',
	})),
);

vi.mock('@solana/kit', () => ({
	getBase64EncodedWireTransaction: getBase64EncodedWireTransactionMock,
	airdropFactory: airdropFactoryMock,
}));

vi.mock('../rpc/createSolanaRpcClient', () => ({
	createSolanaRpcClient: createSolanaRpcClientMock,
}));

vi.mock('@solana/transaction-confirmation', () => ({
	createBlockHeightExceedencePromiseFactory: createBlockHeightExceedencePromiseFactoryMock,
	createRecentSignatureConfirmationPromiseFactory: createRecentSignatureConfirmationPromiseFactoryMock,
	waitForRecentTransactionConfirmation: waitForRecentTransactionConfirmationMock,
}));

vi.mock('../logging/logger', () => ({
	createLogger: createLoggerMock,
	formatError: formatErrorMock,
}));

vi.mock('../utils', async (original) => {
	const actual = await original();
	return {
		...actual,
		now: nowMock,
	};
});

describe('client actions', () => {
	let runtime: SolanaClientRuntime;
	let actions: ClientActions;
	let registry: WalletRegistry;
	let walletConnector: WalletConnector;
	let store = createDefaultClientStore({
		commitment: 'confirmed',
		endpoint: 'https://rpc.test',
		websocketEndpoint: 'wss://rpc.test',
	});
	const ACCOUNT_ADDRESS = 'addr' as Address;
	const SIGNATURE: Signature = 'signature-123' as Signature;
	const AIRDROP_SIGNATURE: Signature = 'airdrop-signature' as Signature;
	const LAMPORT_AMOUNT: Lamports = 500n as Lamports;

	beforeEach(() => {
		vi.clearAllMocks();
		store = createDefaultClientStore({
			commitment: 'confirmed',
			endpoint: 'https://rpc.test',
			websocketEndpoint: 'wss://rpc.test',
		});

		const rpc: Record<string, vi.Mock> = {
			getLatestBlockhash: vi.fn(() => ({
				send: vi.fn().mockResolvedValue({ value: { blockhash: 'abc', lastValidBlockHeight: 1n } }),
			})),
			requestAirdrop: vi.fn(),
			getBalance: vi.fn(() => ({
				send: vi.fn().mockResolvedValue({ value: 123n, context: { slot: 1n } }),
			})),
			getAccountInfo: vi.fn(() => ({
				send: vi.fn().mockResolvedValue({
					value: { lamports: 55n, data: { parsed: true } },
					context: { slot: 2n },
				}),
			})),
			sendTransaction: vi.fn(() => ({
				send: vi.fn().mockResolvedValue(SIGNATURE),
			})),
		};
		const rpcSubscriptions = {
			accountNotifications: vi.fn(),
			signatureNotifications: vi.fn(),
		} as unknown as SolanaClientRuntime['rpcSubscriptions'];

		runtime = {
			rpc: rpc as unknown as SolanaClientRuntime['rpc'],
			rpcSubscriptions,
		};

		createSolanaRpcClientMock.mockImplementation(({ commitment, endpoint, websocketEndpoint }) => ({
			commitment: commitment ?? 'confirmed',
			endpoint,
			rpc: { endpoint } as SolanaClientRuntime['rpc'],
			rpcSubscriptions: { endpoint: websocketEndpoint ?? endpoint } as SolanaClientRuntime['rpcSubscriptions'],
			sendAndConfirmTransaction: vi.fn(),
			simulateTransaction: vi.fn(),
			websocketEndpoint: websocketEndpoint ?? endpoint,
		}));

		walletConnector = {
			id: 'wallet-1',
			name: 'Wallet 1',
			connect: vi.fn(async () => ({
				account: {
					address: ACCOUNT_ADDRESS,
					publicKey: new Uint8Array(32),
				},
				connector: { id: 'wallet-1', name: 'Wallet 1' },
				disconnect: vi.fn(async () => undefined),
				signTransaction: vi.fn(),
			})),
			disconnect: vi.fn(async () => undefined),
			isSupported: () => true,
		};

		registry = {
			all: [walletConnector],
			get: (id: string) => (id === walletConnector.id ? walletConnector : undefined),
		};

		actions = createActions({ connectors: registry, logger: createLoggerMock(), runtime, store });

		createBlockHeightExceedencePromiseFactoryMock.mockReturnValue(() => Promise.resolve());
		createRecentSignatureConfirmationPromiseFactoryMock.mockReturnValue(() => Promise.resolve());
		waitForRecentTransactionConfirmationMock.mockResolvedValue(undefined);
		airdropFactoryMock.mockReturnValue(async () => AIRDROP_SIGNATURE);
	});

	it('sets the cluster and updates latency metadata', async () => {
		await actions.setCluster('https://new.rpc', { websocketEndpoint: 'wss://new', commitment: 'processed' });
		const state = store.getState();
		expect(state.cluster.endpoint).toBe('https://new.rpc');
		expect(state.cluster.status).toMatchObject({ status: 'ready' });
		expect(createSolanaRpcClientMock).toHaveBeenCalledWith({
			commitment: 'processed',
			endpoint: 'https://new.rpc',
			websocketEndpoint: 'wss://new',
		});
	});

	it('connects and disconnects a wallet, handling errors', async () => {
		await actions.connectWallet('wallet-1');
		let state = store.getState();
		expect(state.wallet.status).toBe('connected');
		await actions.disconnectWallet();
		state = store.getState();
		expect(state.wallet.status).toBe('disconnected');

		await expect(actions.connectWallet('missing')).rejects.toThrow(/No wallet connector/);

		const unsupportedConnector = {
			...walletConnector,
			id: 'unsupported',
			isSupported: () => false,
		};
		registry = {
			all: [walletConnector, unsupportedConnector],
			get: (id) => {
				if (id === unsupportedConnector.id) return unsupportedConnector as WalletConnector;
				if (id === walletConnector.id) return walletConnector;
				return undefined;
			},
		};
		actions = createActions({ connectors: registry, logger: createLoggerMock(), runtime, store });
		await expect(actions.connectWallet('unsupported')).rejects.toThrow(/not supported/);
	});

	it('fetches balances and accounts, capturing failures', async () => {
		await actions.fetchBalance(ACCOUNT_ADDRESS);
		let cached = store.getState().accounts.addr;
		expect(cached.lamports).toBe(123n);

		await actions.fetchAccount(ACCOUNT_ADDRESS);
		cached = store.getState().accounts.addr;
		expect(cached.data).toMatchObject({ lamports: 55n });

		const failingRpc = {
			getBalance: vi.fn(() => ({ send: vi.fn().mockRejectedValue(new Error('fail')) })),
		} as unknown as SolanaClientRuntime['rpc'];
		runtime.rpc = failingRpc;
		await expect(actions.fetchBalance(ACCOUNT_ADDRESS)).rejects.toThrow('fail');
	});

	it('sends a transaction and tracks confirmation status', async () => {
		const transaction = {
			lastValidBlockHeight: 1n,
		} as unknown as SendableTransaction & Transaction & TransactionWithLastValidBlockHeight;
		const result = await actions.sendTransaction(transaction, 'processed');
		expect(result).toBe(SIGNATURE);
		expect(waitForRecentTransactionConfirmationMock).toHaveBeenCalled();
		const record = store.getState().transactions[SIGNATURE.toString()];
		expect(record.status).toBe('confirmed');

		waitForRecentTransactionConfirmationMock.mockRejectedValueOnce(new Error('confirmation failed'));
		await expect(actions.sendTransaction(transaction, 'processed')).rejects.toThrow('confirmation failed');
		const errored = store.getState().transactions[SIGNATURE.toString()];
		expect(errored.status).toBe('failed');
	});

	it('requests an airdrop through the runtime factory', async () => {
		const signature = await actions.requestAirdrop(ACCOUNT_ADDRESS, LAMPORT_AMOUNT);
		expect(signature).toBe(AIRDROP_SIGNATURE);
		expect(airdropFactoryMock).toHaveBeenCalled();
	});
});
