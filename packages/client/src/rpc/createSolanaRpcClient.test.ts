import type { SendableTransaction, Signature, Transaction } from '@solana/kit';
import type { TransactionWithLastValidBlockHeight } from '@solana/transaction-confirmation';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createSolanaRpcClient } from './createSolanaRpcClient';

type ConfirmableTransaction = SendableTransaction & Transaction & TransactionWithLastValidBlockHeight;

const sendTransactionSendMock = vi.hoisted(() => vi.fn<[], Promise<Signature>>());
const simulateTransactionSendMock = vi.hoisted(() => vi.fn());

const rpcMockFactory = vi.hoisted(() =>
	vi.fn(() => ({
		sendTransaction: vi.fn(() => ({ send: sendTransactionSendMock })),
		simulateTransaction: vi.fn(() => ({ send: simulateTransactionSendMock })),
	})),
);

const rpcSubscriptionsMockFactory = vi.hoisted(() => vi.fn(() => ({ tag: 'subscriptions' })));
const getBase64EncodedWireTransactionMock = vi.hoisted(() => vi.fn(() => 'base64-tx'));
const createBlockHeightExceedencePromiseFactoryMock = vi.hoisted(() => vi.fn(() => vi.fn()));
const createRecentSignatureConfirmationPromiseFactoryMock = vi.hoisted(() => vi.fn(() => vi.fn()));
const waitForRecentTransactionConfirmationMock = vi.hoisted(() => vi.fn(() => Promise.resolve()));

vi.mock('@solana/kit', () => ({
	createSolanaRpc: rpcMockFactory,
	createSolanaRpcSubscriptions: rpcSubscriptionsMockFactory,
	getBase64EncodedWireTransaction: getBase64EncodedWireTransactionMock,
}));

vi.mock('@solana/transaction-confirmation', () => ({
	createBlockHeightExceedencePromiseFactory: createBlockHeightExceedencePromiseFactoryMock,
	createRecentSignatureConfirmationPromiseFactory: createRecentSignatureConfirmationPromiseFactoryMock,
	waitForRecentTransactionConfirmation: waitForRecentTransactionConfirmationMock,
}));

describe('createSolanaRpcClient', () => {
	beforeEach(() => {
		sendTransactionSendMock.mockResolvedValue('sig' as Signature);
		simulateTransactionSendMock.mockResolvedValue({ value: { logs: [] } });
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	it('creates RPC wiring with sensible defaults', () => {
		const client = createSolanaRpcClient({ endpoint: 'https://rpc.test' });

		expect(rpcMockFactory).toHaveBeenCalledWith('https://rpc.test', undefined);
		expect(rpcSubscriptionsMockFactory).toHaveBeenCalledWith('https://rpc.test', undefined);
		expect(client.commitment).toBe('confirmed');
		expect(client.endpoint).toBe('https://rpc.test');
		expect(client.websocketEndpoint).toBe('https://rpc.test');
	});

	it('respects overrides when wiring transports', () => {
		createSolanaRpcClient({
			commitment: 'finalized',
			endpoint: 'https://rpc.mainnet',
			websocketEndpoint: 'wss://rpc-ws.mainnet',
		});

		expect(rpcMockFactory).toHaveBeenCalledWith('https://rpc.mainnet', undefined);
		expect(rpcSubscriptionsMockFactory).toHaveBeenCalledWith('wss://rpc-ws.mainnet', undefined);
	});

	it('sends and confirms transactions with the provided options', async () => {
		const client = createSolanaRpcClient({ commitment: 'confirmed', endpoint: 'https://rpc.devnet' });
		const blockHeightPromise = vi.fn(() => Promise.resolve());
		const signaturePromise = vi.fn(() => Promise.resolve());
		createBlockHeightExceedencePromiseFactoryMock.mockReturnValueOnce(blockHeightPromise);
		createRecentSignatureConfirmationPromiseFactoryMock.mockReturnValueOnce(signaturePromise);

		const transaction = { tag: 'tx' } as ConfirmableTransaction;
		const signature = await client.sendAndConfirmTransaction(transaction, {
			commitment: 'finalized',
			maxRetries: 3,
			minContextSlot: 123n,
			skipPreflight: true,
		});

		const rpcInstance = rpcMockFactory.mock.results[0].value;
		expect(getBase64EncodedWireTransactionMock).toHaveBeenCalledWith(transaction);
		expect(rpcInstance.sendTransaction).toHaveBeenCalledWith('base64-tx', {
			encoding: 'base64',
			maxRetries: 3n,
			minContextSlot: 123n,
			preflightCommitment: 'finalized',
			skipPreflight: true,
		});
		expect(waitForRecentTransactionConfirmationMock).toHaveBeenCalledWith(
			expect.objectContaining({
				commitment: 'finalized',
				transaction,
			}),
		);
		expect(signature).toBe('sig');
	});

	it('simulates transactions with merged configuration', async () => {
		const client = createSolanaRpcClient({ commitment: 'processed', endpoint: 'https://rpc.devnet' });
		const result = await client.simulateTransaction({ tag: 'tx' } as SendableTransaction & Transaction, {
			commitment: 'finalized',
			config: { sigVerify: true },
		});
		const rpcInstance = rpcMockFactory.mock.results[0].value;
		expect(rpcInstance.simulateTransaction).toHaveBeenCalledWith('base64-tx', {
			commitment: 'finalized',
			encoding: 'base64',
			replaceRecentBlockhash: false,
			sigVerify: true,
		});
		expect(result).toEqual({ value: { logs: [] } });
	});
});
