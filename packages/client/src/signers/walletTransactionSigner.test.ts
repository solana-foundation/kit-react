import { getBase58Decoder } from '@solana/codecs-strings';
import type { TransactionSigner } from '@solana/kit';
import { describe, expect, it, vi } from 'vitest';

import type { WalletSession } from '../types';
import { createWalletTransactionSigner, isWalletSession, resolveSignerMode } from './walletTransactionSigner';

type SessionTransaction = Parameters<NonNullable<WalletSession['signTransaction']>>[0];
type SignAndSendTransactionParam = Parameters<NonNullable<TransactionSigner['signAndSendTransactions']>>[0][number];

describe('wallet transaction signer', () => {
	const baseAccount: WalletSession['account'] = {
		address: 'wallet-address' as unknown as WalletSession['account']['address'],
		publicKey: new Uint8Array(32),
		label: 'primary',
	};
	const addressKey = String(baseAccount.address);
	const createSession = (overrides: Partial<WalletSession> = {}): WalletSession => ({
		account: { ...baseAccount, ...(overrides.account ?? {}) } as WalletSession['account'],
		connector: { id: 'connector', name: 'Test Wallet', ...(overrides.connector ?? {}) },
		disconnect: vi.fn(async () => undefined),
		...(overrides as Omit<WalletSession, 'account' | 'connector' | 'disconnect'>),
	});

	it('identifies wallet session shapes', () => {
		const session = createSession();
		expect(isWalletSession(session)).toBe(true);
		expect(isWalletSession({})).toBe(false);
	});

	it('wraps partial signing wallets', async () => {
		const signatureStub = new Uint8Array([1, 2, 3]);
		const signTransaction = vi.fn(async (transaction: SessionTransaction) => ({
			...transaction,
			messageBytes: new Uint8Array([9]),
			signatures: { ...transaction.signatures, [addressKey]: signatureStub },
		}));
		const session = createSession({ signTransaction });
		const { mode, signer } = createWalletTransactionSigner(session);
		expect(mode).toBe('partial');

		const inputTx = {
			messageBytes: new Uint8Array([0]),
			signatures: {},
		};
		const signedTransactions = await signer.modifyAndSignTransactions([
			inputTx as Parameters<typeof signer.modifyAndSignTransactions>[0][number],
		]);
		expect(signTransaction).toHaveBeenCalledTimes(1);
		expect(Object.isFrozen(signedTransactions)).toBe(true);
		expect(signedTransactions[0].signatures[addressKey]).toBe(signatureStub);

		const signatureDictionaries = await signer.signTransactions([
			inputTx as Parameters<typeof signer.signTransactions>[0][number],
		]);
		expect(signatureDictionaries[0][addressKey]).toBe(signatureStub);
	});

	it('wraps sending wallets', async () => {
		const signatureBytes = new Uint8Array(64).fill(1);
		const signatureString = getBase58Decoder().decode(signatureBytes);
		const sendTransaction = vi.fn(async () => signatureString);
		const session = createSession({ sendTransaction });
		const { mode, signer } = createWalletTransactionSigner(session, { commitment: 'processed' });
		expect(mode).toBe('send');

		if ('signAndSendTransactions' in signer) {
			const results = await signer.signAndSendTransactions([
				{ messageBytes: new Uint8Array([0]) } as SignAndSendTransactionParam,
			]);
			expect(sendTransaction).toHaveBeenCalledWith(expect.anything(), { commitment: 'processed' });
			expect(Array.isArray(results)).toBe(true);
			expect(results).toHaveLength(1);
		} else {
			throw new Error('expected signer to support sending');
		}
	});

	it('throws when wallet cannot sign or send', () => {
		const session = createSession();
		expect(() => createWalletTransactionSigner(session)).toThrow(/does not support/);
	});

	it('resolves signer mode for wrapped signers', () => {
		const partialSession = createSession({
			signTransaction: vi.fn(async (transaction: SessionTransaction) => ({
				...transaction,
				signatures: { ...transaction.signatures, [addressKey]: new Uint8Array([1]) },
			})),
		});
		const sendingSession = createSession({
			sendTransaction: vi.fn(async () => '11111111111111111111111111111111'),
		});
		const partialSigner = createWalletTransactionSigner(partialSession).signer;
		const sendingSigner = createWalletTransactionSigner(sendingSession).signer;
		expect(resolveSignerMode(partialSigner)).toBe('partial');
		expect(resolveSignerMode(sendingSigner)).toBe('send');
		expect(resolveSignerMode({} as unknown as TransactionSigner)).toBe('partial');
	});
});
