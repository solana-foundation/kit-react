import type { TransactionSigner } from '@solana/kit';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { SolTransferPrepareConfig } from '../features/sol';
import type { SplTokenHelperConfig } from '../features/spl';
import type { PrepareTransactionMessage } from '../transactions/prepareTransaction';
import { createClientHelpers } from './createClientHelpers';
import { createDefaultClientStore } from './createClientStore';

const createSolTransferHelperMock = vi.hoisted(() =>
	vi.fn(() => ({
		prepareTransfer: vi.fn(async (config) => config),
		sendPreparedTransfer: vi.fn(async () => 'sig'),
		sendTransfer: vi.fn(async (config) => config),
	})),
);

const createSplTokenHelperMock = vi.hoisted(() =>
	vi.fn((_runtime, _config) => ({
		deriveAssociatedTokenAddress: vi.fn(async () => 'ata'),
		fetchBalance: vi.fn(async (_owner: unknown, _commitment?: unknown) => ({ balance: 1 })),
		prepareTransfer: vi.fn(async (config) => config),
		sendPreparedTransfer: vi.fn(async () => 'sig'),
		sendTransfer: vi.fn(async (config) => config),
	})),
);

const createTransactionHelperMock = vi.hoisted(() =>
	vi.fn((_runtime, _getFallback) => ({
		prepare: vi.fn(),
		send: vi.fn(),
		sign: vi.fn(),
		toWire: vi.fn(),
	})),
);

const prepareTransactionMock = vi.hoisted(() => vi.fn());

vi.mock('../features/sol', () => ({
	createSolTransferHelper: createSolTransferHelperMock,
}));

vi.mock('../features/spl', () => ({
	createSplTokenHelper: createSplTokenHelperMock,
}));

vi.mock('../features/transactions', () => ({
	createTransactionHelper: createTransactionHelperMock,
}));

vi.mock('../transactions/prepareTransaction', () => ({
	prepareTransaction: prepareTransactionMock,
}));

describe('client helpers', () => {
	const runtime = {
		rpc: {} as unknown,
		rpcSubscriptions: {} as unknown,
	};

	const config = {
		commitment: 'confirmed' as const,
		endpoint: 'https://example.rpc',
		websocketEndpoint: 'wss://example.rpc',
	};

	beforeEach(() => {
		createSolTransferHelperMock.mockClear();
		createSplTokenHelperMock.mockClear();
		createTransactionHelperMock.mockClear();
		prepareTransactionMock.mockClear();
	});

	it('lazily creates sol transfer helper and injects default commitment', async () => {
		const store = createDefaultClientStore(config);
		const helpers = createClientHelpers(runtime as never, store);

		const helper = helpers.solTransfer;
		expect(helpers.solTransfer).toBe(helper);
		expect(createSolTransferHelperMock.mock.calls).toHaveLength(1);

		const prepareInput = {
			amount: 1n,
			authority: { address: 'from' } as unknown as TransactionSigner,
			destination: 'dest',
		} as SolTransferPrepareConfig;
		await helper.prepareTransfer(prepareInput);
		const underlying = createSolTransferHelperMock.mock.results[0].value;
		expect(underlying.prepareTransfer).toHaveBeenCalledWith(expect.objectContaining({ commitment: 'confirmed' }));
	});

	it('caches transaction helper and forwards fallback commitment getter', () => {
		const store = createDefaultClientStore(config);
		const helpers = createClientHelpers(runtime as never, store);
		expect(helpers.transaction).toBe(helpers.transaction);
		expect(createTransactionHelperMock.mock.calls).toHaveLength(1);
		expect(createTransactionHelperMock.mock.calls[0][0]).toBe(runtime);
		expect(typeof createTransactionHelperMock.mock.calls[0][1]).toBe('function');
	});

	it('caches spl helpers per config and injects commitment', async () => {
		const store = createDefaultClientStore(config);
		const helpers = createClientHelpers(runtime as never, store);

		const splConfig: SplTokenHelperConfig = { mint: 'mint' };
		const splA = helpers.splToken({ ...splConfig });
		const splB = helpers.splToken({ ...splConfig });
		expect(splA).toBe(splB);
		expect(createSplTokenHelperMock.mock.calls).toHaveLength(1);

		await splA.fetchBalance('owner');
		const underlying = createSplTokenHelperMock.mock.results[0].value;
		expect(underlying.fetchBalance).toHaveBeenCalledWith('owner', 'confirmed');

		const splDifferentConfig: SplTokenHelperConfig = { mint: 'mint', commitment: 'finalized' };
		const splDifferent = helpers.splToken({ ...splDifferentConfig });
		expect(splDifferent).not.toBe(splA);
	});

	it('prepares transactions using the runtime RPC', async () => {
		const store = createDefaultClientStore(config);
		const rpc = { tag: 'rpc' };
		const helpers = createClientHelpers({ ...runtime, rpc } as never, store);
		const transaction = { tag: 'message' } as unknown as PrepareTransactionMessage;
		await helpers.prepareTransaction({ transaction });
		expect(prepareTransactionMock).toHaveBeenCalledWith({ transaction, rpc });
	});
});
