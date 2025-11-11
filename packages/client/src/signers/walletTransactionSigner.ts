import { getBase58Encoder } from '@solana/codecs-strings';
import {
	type Commitment,
	isTransactionPartialSigner,
	isTransactionSendingSigner,
	type SendableTransaction,
	type SignatureBytes,
	type SignatureDictionary,
	signatureBytes,
	type Transaction,
	type TransactionModifyingSigner,
	type TransactionPartialSigner,
	type TransactionSendingSigner,
	type TransactionSigner,
	type TransactionWithinSizeLimit,
	type TransactionWithLifetime,
} from '@solana/kit';

import type { WalletSession } from '../types';

type WalletTransactionSignerMode = 'partial' | 'send';

export type WalletTransactionSigner = Readonly<{
	mode: WalletTransactionSignerMode;
	signer: TransactionSigner;
}>;

export type WalletTransactionSignerConfig = Readonly<{
	commitment?: Commitment;
}>;

/** Type guard that determines whether the provided value is a {@link WalletSession}. */
export function isWalletSession(value: unknown): value is WalletSession {
	if (typeof value !== 'object' || value === null) {
		return false;
	}
	return 'account' in value && 'connector' in value && 'disconnect' in value;
}

/**
 * Creates a {@link TransactionSigner} wrapper around a {@link WalletSession}.
 *
 * The returned signer implements the most capable interface supported by the underlying wallet:
 * - if the wallet exposes `signTransaction`, a partial signer is returned;
 * - otherwise, if the wallet only exposes `sendTransaction`, a sending signer is returned.
 *
 * @param session - Connected wallet session used to sign or send transactions.
 * @param config - Optional configuration that propagates commitment preferences when the wallet sends transactions.
 * @returns Object containing the wrapped {@link TransactionSigner} and the strategy it supports.
 */
export function createWalletTransactionSigner(
	session: WalletSession,
	config: WalletTransactionSignerConfig = {},
): WalletTransactionSigner {
	const { commitment } = config;
	const address = session.account.address;

	if (session.signTransaction) {
		const signTransaction = session.signTransaction.bind(session);

		const modifyingSigner: TransactionModifyingSigner & TransactionPartialSigner = Object.freeze({
			address,
			async modifyAndSignTransactions(
				transactions: readonly (Transaction | (Transaction & TransactionWithLifetime))[],
			): Promise<readonly (Transaction & TransactionWithinSizeLimit & TransactionWithLifetime)[]> {
				const signedTransactions: (Transaction & TransactionWithinSizeLimit & TransactionWithLifetime)[] = [];
				for (const transaction of transactions) {
					const castTransaction = transaction as Transaction &
						TransactionWithinSizeLimit &
						TransactionWithLifetime;
					const signed = await signTransaction(
						castTransaction as unknown as SendableTransaction & Transaction,
					);
					const signature = signed.signatures[address];
					if (!signature) {
						throw new Error('Wallet did not populate the expected fee payer signature.');
					}
					const mergedTransaction = Object.freeze({
						...castTransaction,
						messageBytes: signed.messageBytes,
						signatures: Object.freeze({
							...castTransaction.signatures,
							...signed.signatures,
						}),
					}) as Transaction & TransactionWithinSizeLimit & TransactionWithLifetime;
					signedTransactions.push(mergedTransaction);
				}
				return Object.freeze(signedTransactions) as readonly (Transaction &
					TransactionWithinSizeLimit &
					TransactionWithLifetime)[];
			},
			async signTransactions(
				transactions: readonly (Transaction & TransactionWithinSizeLimit & TransactionWithLifetime)[],
			): Promise<readonly SignatureDictionary[]> {
				const signedTransactions = await this.modifyAndSignTransactions(transactions);
				return Object.freeze(
					signedTransactions.map((signedTransaction) => {
						const signature = signedTransaction.signatures[address];
						if (!signature) {
							throw new Error('Expected signer to produce a signature for the provided address.');
						}
						return Object.freeze({ [address]: signature });
					}),
				) as readonly SignatureDictionary[];
			},
		});

		return {
			mode: 'partial',
			signer: modifyingSigner,
		};
	}

	if (session.sendTransaction) {
		const base58Encoder = getBase58Encoder();
		const sendTransaction = session.sendTransaction.bind(session);
		const sendingSigner: TransactionSendingSigner = Object.freeze({
			address,
			async signAndSendTransactions(
				transactions: readonly (Transaction | (Transaction & TransactionWithLifetime))[],
			): Promise<readonly SignatureBytes[]> {
				const signatures: SignatureBytes[] = [];
				for (const transaction of transactions) {
					const signatureString = await sendTransaction(
						transaction as unknown as SendableTransaction & Transaction,
						commitment ? { commitment } : undefined,
					);
					const bytes = base58Encoder.encode(signatureString);
					signatures.push(signatureBytes(bytes));
				}
				return signatures;
			},
		});
		return {
			mode: 'send',
			signer: sendingSigner,
		};
	}

	throw new Error('Wallet session does not support signing or sending transactions.');
}

/**
 * Resolves the most capable signing strategy for a {@link TransactionSigner}.
 *
 * @param signer - Arbitrary transaction signer.
 * @returns Strategy descriptor indicating whether the signer can partially sign transactions.
 */
export function resolveSignerMode(signer: TransactionSigner): WalletTransactionSignerMode {
	if (isTransactionPartialSigner(signer)) {
		return 'partial';
	}
	if (isTransactionSendingSigner(signer)) {
		return 'send';
	}
	// Default to partial mode so downstream helpers can attempt to sign transactions.
	return 'partial';
}
