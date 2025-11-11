import type { TransactionSigner } from '@solana/kit';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WalletSession } from '../types';

type MutableMessage = {
	instructions: unknown[];
	feePayer?: unknown;
	lifetime?: unknown;
};

const addressMock = vi.hoisted(() => vi.fn((value: string) => `addr:${value}`));
const appendTransactionMessageInstructionMock = vi.hoisted(() =>
	vi.fn((instruction: unknown, message: MutableMessage) => {
		message.instructions.push(instruction);
		return message;
	}),
);
const createTransactionMessageMock = vi.hoisted(() =>
	vi.fn(() => ({ instructions: [] as unknown[], steps: [] as unknown[] })),
);
const setTransactionMessageFeePayerMock = vi.hoisted(() =>
	vi.fn((payer: unknown, message: MutableMessage) => {
		message.feePayer = payer;
		return message;
	}),
);
const setTransactionMessageLifetimeUsingBlockhashMock = vi.hoisted(() =>
	vi.fn((lifetime: unknown, message: MutableMessage) => {
		message.lifetime = lifetime;
		return message;
	}),
);
const signTransactionMessageWithSignersMock = vi.hoisted(() => vi.fn(async () => ({ signed: true })));
const signAndSendTransactionMessageWithSignersMock = vi.hoisted(() => vi.fn(async () => new Uint8Array([1, 2, 3])));
const getBase64EncodedWireTransactionMock = vi.hoisted(() => vi.fn(() => 'wire-data'));
const signatureMock = vi.hoisted(() => vi.fn((value: unknown) => `signature:${String(value)}`));
const pipeMock = vi.hoisted(() =>
	vi.fn((initial: unknown, ...fns: Array<(value: unknown) => unknown>) => fns.reduce((acc, fn) => fn(acc), initial)),
);
const isTransactionSendingSignerMock = vi.hoisted(() =>
	vi.fn((signer: { sendTransactions?: unknown }) => Boolean(signer?.sendTransactions)),
);
const isTransactionSendingSignerGuardMock = isTransactionSendingSignerMock; // alias for clarity
const isWalletSessionMock = vi.hoisted(() =>
	vi.fn((value: unknown) => Boolean((value as WalletSession | undefined)?.session)),
);
const createWalletTransactionSignerMock = vi.hoisted(() =>
	vi.fn((session: { account: { address: unknown } }) => ({
		mode: 'partial' as const,
		signer: { address: session.account.address } as TransactionSigner,
	})),
);
const resolveSignerModeMock = vi.hoisted(() => vi.fn(() => 'partial'));
const getTransferSolInstructionMock = vi.hoisted(() =>
	vi.fn((config: unknown) => ({ instruction: 'transfer', config })),
);
const getBase58DecoderMock = vi.hoisted(() => vi.fn(() => ({ decode: () => 'decoded-signature' })));

vi.mock('@solana/kit', () => ({
	address: addressMock,
	appendTransactionMessageInstruction: appendTransactionMessageInstructionMock,
	createTransactionMessage: createTransactionMessageMock,
	getBase64EncodedWireTransaction: getBase64EncodedWireTransactionMock,
	isTransactionSendingSigner: isTransactionSendingSignerGuardMock,
	pipe: pipeMock,
	setTransactionMessageFeePayer: setTransactionMessageFeePayerMock,
	setTransactionMessageLifetimeUsingBlockhash: setTransactionMessageLifetimeUsingBlockhashMock,
	signAndSendTransactionMessageWithSigners: signAndSendTransactionMessageWithSignersMock,
	signature: signatureMock,
	signTransactionMessageWithSigners: signTransactionMessageWithSignersMock,
}));

vi.mock('@solana/codecs-strings', () => ({
	getBase58Decoder: getBase58DecoderMock,
}));

vi.mock('@solana-program/system', () => ({
	getTransferSolInstruction: getTransferSolInstructionMock,
}));

vi.mock('../signers/walletTransactionSigner', () => ({
	createWalletTransactionSigner: createWalletTransactionSignerMock,
	isWalletSession: isWalletSessionMock,
	resolveSignerMode: resolveSignerModeMock,
}));

let createSolTransferHelper: typeof import('./sol')['createSolTransferHelper'];

beforeAll(async () => {
	({ createSolTransferHelper } = await import('./sol'));
});
describe('createSolTransferHelper', () => {
	const runtime = {
		rpc: {
			getLatestBlockhash: vi.fn(() => ({
				send: vi.fn().mockResolvedValue({ value: { blockhash: 'hash', lastValidBlockHeight: 123n } }),
			})),
			sendTransaction: vi.fn(() => ({
				send: vi.fn().mockResolvedValue('wire-signature'),
			})),
		},
		rpcSubscriptions: {} as never,
	};

	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('prepares transfers using wallet sessions and runtime lifetimes', async () => {
		const helper = createSolTransferHelper(runtime as never);
		const session = {
			session: true,
			account: { address: 'owner' },
		} as unknown as WalletSession;
		createWalletTransactionSignerMock.mockReturnValueOnce({
			mode: 'partial',
			signer: { address: 'fee-payer' } as TransactionSigner,
		});

		const prepared = await helper.prepareTransfer({
			amount: 1n,
			authority: session,
			destination: 'dest',
		});

		expect(createWalletTransactionSignerMock).toHaveBeenCalledWith(session, { commitment: undefined });
		expect(runtime.rpc.getLatestBlockhash).toHaveBeenCalled();
		expect(prepared.lifetime.lastValidBlockHeight).toBe(123n);
		expect(prepared.mode).toBe('partial');
		expect(prepared.commitment).toBeUndefined();
		expect(appendTransactionMessageInstructionMock).toHaveBeenCalled();
	});

	it('sends prepared transfers using sending signers when possible', async () => {
		const helper = createSolTransferHelper(runtime as never);
		const signer = {
			sendTransactions: vi.fn(async () => ['sig']),
		};
		const prepared = {
			commitment: 'processed',
			lifetime: { blockhash: 'hash', lastValidBlockHeight: 123n },
			message: { instructions: [] },
			mode: 'send' as const,
			signer,
		};
		const signature = await helper.sendPreparedTransfer(prepared);
		expect(signAndSendTransactionMessageWithSignersMock).toHaveBeenCalled();
		expect(signature).toBe('signature:decoded-signature');
	});

	it('sends prepared transfers via RPC when partial signing is required', async () => {
		const helper = createSolTransferHelper(runtime as never);
		const prepared = {
			commitment: 'processed',
			lifetime: { blockhash: 'hash', lastValidBlockHeight: 123n },
			message: { instructions: [] },
			mode: 'partial' as const,
			signer: { address: 'payer' } as TransactionSigner,
		};
		const signature = await helper.sendPreparedTransfer(prepared, { commitment: 'processed' });
		expect(signTransactionMessageWithSignersMock).toHaveBeenCalled();
		expect(runtime.rpc.sendTransaction).toHaveBeenCalledWith(
			'wire-data',
			expect.objectContaining({ preflightCommitment: 'processed' }),
		);
		expect(signature).toBe('signature:wire-signature');
	});

	it('chains prepare and send helpers through sendTransfer', async () => {
		const helper = createSolTransferHelper(runtime as never);
		const resolveCallsBefore = resolveSignerModeMock.mock.calls.length;
		const signature = await helper.sendTransfer({
			amount: 1n,
			authority: { address: 'payer' } as TransactionSigner,
			destination: 'dest',
		});
		expect(resolveSignerModeMock.mock.calls.length).toBeGreaterThan(resolveCallsBefore);
		expect(signTransactionMessageWithSignersMock).toHaveBeenCalled();
		expect(signature).toBe('signature:wire-signature');
	});
});
