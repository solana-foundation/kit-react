import type { Commitment, TransactionSigner } from '@solana/kit';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

type MutableMessage = {
	instructions: unknown[];
	feePayer?: unknown;
	lifetimeConstraint?: unknown;
};

const appendTransactionMessageInstructionsMock = vi.hoisted(() =>
	vi.fn((instructions: readonly unknown[], message: MutableMessage) => ({
		...message,
		instructions: [...message.instructions, ...instructions],
	})),
);
const createTransactionMessageMock = vi.hoisted(() => vi.fn(() => ({ instructions: [] as unknown[] })));
const setTransactionMessageFeePayerMock = vi.hoisted(() =>
	vi.fn((payer: unknown, message: MutableMessage) => ({
		...message,
		feePayer: payer,
	})),
);
const setTransactionMessageFeePayerSignerMock = vi.hoisted(() => setTransactionMessageFeePayerMock);
const setTransactionMessageLifetimeUsingBlockhashMock = vi.hoisted(() =>
	vi.fn((lifetime: unknown, message: MutableMessage) => ({
		...message,
		lifetimeConstraint: lifetime,
	})),
);
const signTransactionMessageWithSignersMock = vi.hoisted(() => vi.fn(async (message: unknown) => ({ message })));
const signAndSendTransactionMessageWithSignersMock = vi.hoisted(() => vi.fn(async () => new Uint8Array([1, 2, 3])));
const getBase64EncodedWireTransactionMock = vi.hoisted(() => vi.fn(() => 'wire-data'));
const signatureMock = vi.hoisted(() => vi.fn((value: unknown) => `signature:${String(value)}`));
const pipeMock = vi.hoisted(() =>
	vi.fn((initial: unknown, ...fns: Array<(value: unknown) => unknown>) => fns.reduce((acc, fn) => fn(acc), initial)),
);
const addressMock = vi.hoisted(() => vi.fn((value: string) => `address:${value}`));
const isTransactionSendingSignerMock = vi.hoisted(() => vi.fn(() => false));
const isInstructionForProgramMock = vi.hoisted(() => vi.fn(() => false));
const isInstructionWithDataMock = vi.hoisted(() => vi.fn(() => false));
const createWalletTransactionSignerMock = vi.hoisted(() => vi.fn());
const isWalletSessionMock = vi.hoisted(() => vi.fn(() => false));
const resolveSignerModeMock = vi.hoisted(() => vi.fn(() => 'partial'));
const getBase58DecoderMock = vi.hoisted(() => vi.fn(() => ({ decode: () => 'decoded' })));
const prepareTransactionMock = vi.hoisted(() =>
	vi.fn(async ({ transaction }: { transaction: MutableMessage }) => ({
		...transaction,
		instructions: [...transaction.instructions, { programAddress: 'compute' }],
	})),
);

vi.mock('@solana/kit', () => ({
	address: addressMock,
	appendTransactionMessageInstructions: appendTransactionMessageInstructionsMock,
	createTransactionMessage: createTransactionMessageMock,
	getBase64EncodedWireTransaction: getBase64EncodedWireTransactionMock,
	isInstructionForProgram: isInstructionForProgramMock,
	isInstructionWithData: isInstructionWithDataMock,
	isTransactionSendingSigner: isTransactionSendingSignerMock,
	pipe: pipeMock,
	setTransactionMessageFeePayer: setTransactionMessageFeePayerMock,
	setTransactionMessageFeePayerSigner: setTransactionMessageFeePayerSignerMock,
	setTransactionMessageLifetimeUsingBlockhash: setTransactionMessageLifetimeUsingBlockhashMock,
	signAndSendTransactionMessageWithSigners: signAndSendTransactionMessageWithSignersMock,
	signTransactionMessageWithSigners: signTransactionMessageWithSignersMock,
	signature: signatureMock,
}));

vi.mock('@solana/codecs-strings', () => ({
	getBase58Decoder: getBase58DecoderMock,
}));

vi.mock('@solana-program/compute-budget', () => ({
	COMPUTE_BUDGET_PROGRAM_ADDRESS: 'ComputeBudget111111111111111111111111111111' as const,
	ComputeBudgetInstruction: {
		SetComputeUnitLimit: 2,
		SetComputeUnitPrice: 3,
	},
	getSetComputeUnitLimitInstruction: vi.fn((config: unknown) => ({ type: 'limit', config })),
	getSetComputeUnitPriceInstruction: vi.fn((config: unknown) => ({ type: 'price', config })),
}));

vi.mock('../signers/walletTransactionSigner', () => ({
	createWalletTransactionSigner: createWalletTransactionSignerMock,
	isWalletSession: isWalletSessionMock,
	resolveSignerMode: resolveSignerModeMock,
}));

vi.mock('../transactions/prepareTransaction', () => ({
	prepareTransaction: prepareTransactionMock,
}));

let createTransactionHelper: typeof import('./transactions')['createTransactionHelper'];

beforeAll(async () => {
	({ createTransactionHelper } = await import('./transactions'));
});

describe('createTransactionHelper.prepareAndSend', () => {
	const runtime = {
		rpc: {
			getLatestBlockhash: vi.fn(() => ({
				send: vi.fn().mockResolvedValue({ value: { blockhash: 'abc', lastValidBlockHeight: 123n } }),
			})),
			sendTransaction: vi.fn(() => ({
				send: vi.fn().mockResolvedValue('wire-signature'),
			})),
		},
		rpcSubscriptions: {} as never,
	};
	const getFallbackCommitment = () => 'confirmed' as Commitment;
	const baseInstruction = { programAddress: 'Demo1111111111111111111111111111111111', data: new Uint8Array([1]) };
	const authority: TransactionSigner = { address: 'payer' } as TransactionSigner;

	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('runs prepareTransaction by default before sending', async () => {
		const helper = createTransactionHelper(runtime as never, getFallbackCommitment);
		const signature = await helper.prepareAndSend({
			authority,
			instructions: [baseInstruction],
		});
		expect(prepareTransactionMock).toHaveBeenCalledTimes(1);
		expect(prepareTransactionMock).toHaveBeenCalledWith(
			expect.objectContaining({
				blockhashReset: false,
				rpc: runtime.rpc,
				transaction: expect.objectContaining({ instructions: expect.any(Array) }),
			}),
		);
		expect(runtime.rpc.sendTransaction).toHaveBeenCalled();
		expect(signature).toBe('signature:wire-signature');
	});

	it('can skip prepareTransaction when disabled', async () => {
		const helper = createTransactionHelper(runtime as never, getFallbackCommitment);
		await helper.prepareAndSend({
			authority,
			instructions: [baseInstruction],
			prepareTransaction: false,
		});
		expect(prepareTransactionMock).not.toHaveBeenCalled();
	});

	it('passes through compute unit overrides and logging hooks', async () => {
		const helper = createTransactionHelper(runtime as never, getFallbackCommitment);
		const logRequest = vi.fn();
		await helper.prepareAndSend({
			authority,
			instructions: [baseInstruction],
			prepareTransaction: {
				blockhashReset: true,
				computeUnitLimitMultiplier: 1.5,
				logRequest,
			},
		});
		expect(prepareTransactionMock).toHaveBeenCalledWith(
			expect.objectContaining({
				blockhashReset: true,
				computeUnitLimitMultiplier: 1.5,
				logRequest,
			}),
		);
	});
});

describe('createTransactionHelper.prepare', () => {
	const runtime = {
		rpc: {
			getLatestBlockhash: vi.fn(() => ({
				send: vi.fn().mockResolvedValue({ value: { blockhash: 'abc', lastValidBlockHeight: 123n } }),
			})),
			sendTransaction: vi.fn(),
		},
		rpcSubscriptions: {} as never,
	};
	const getFallbackCommitment = () => 'confirmed' as Commitment;
	const authority: TransactionSigner = { address: 'payer' } as TransactionSigner;

	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('defaults to legacy when instructions do not reference address tables', async () => {
		const helper = createTransactionHelper(runtime as never, getFallbackCommitment);
		await helper.prepare({
			authority,
			instructions: [{ programAddress: 'Demo1111111111111111111111111111111111', data: new Uint8Array([1]) }],
		});
		expect(createTransactionMessageMock).toHaveBeenCalledWith({ version: 'legacy' });
	});

	it('selects version 0 automatically when instructions reference address tables', async () => {
		const helper = createTransactionHelper(runtime as never, getFallbackCommitment);
		await helper.prepare({
			authority,
			instructions: [
				{
					programAddress: 'Demo1111111111111111111111111111111111',
					data: new Uint8Array([1]),
					addressTableLookups: [{}],
				},
			],
		});
		expect(createTransactionMessageMock).toHaveBeenCalledWith({ version: 0 });
	});
});
