import { getBase58Decoder } from '@solana/codecs-strings';
import {
	type Address,
	address,
	appendTransactionMessageInstruction,
	type Blockhash,
	type Commitment,
	createTransactionMessage,
	getBase64EncodedWireTransaction,
	isTransactionSendingSigner,
	pipe,
	type Slot,
	setTransactionMessageFeePayer,
	setTransactionMessageLifetimeUsingBlockhash,
	signAndSendTransactionMessageWithSigners,
	signature,
	signTransactionMessageWithSigners,
	type TransactionSigner,
	type TransactionVersion,
} from '@solana/kit';
import { getTransferSolInstruction } from '@solana-program/system';

import { lamportsMath } from '../numeric/lamports';
import { createWalletTransactionSigner, isWalletSession, resolveSignerMode } from '../signers/walletTransactionSigner';
import type { SolanaClientRuntime, WalletSession } from '../types';

type BlockhashLifetime = Readonly<{
	blockhash: Blockhash;
	lastValidBlockHeight: bigint;
}>;

type SolTransferAmount = bigint | number | string;

type SolTransferAuthority = TransactionSigner<string> | WalletSession;

type SignableSolTransactionMessage = Parameters<typeof signTransactionMessageWithSigners>[0];

export type SolTransferPrepareConfig = Readonly<{
	amount: SolTransferAmount;
	authority: SolTransferAuthority;
	commitment?: Commitment;
	destination: Address | string;
	lifetime?: BlockhashLifetime;
	transactionVersion?: TransactionVersion;
}>;

export type SolTransferSendOptions = Readonly<{
	abortSignal?: AbortSignal;
	commitment?: Commitment;
	maxRetries?: bigint | number;
	minContextSlot?: Slot;
	skipPreflight?: boolean;
}>;

type PreparedSolTransfer = Readonly<{
	commitment?: Commitment;
	lifetime: BlockhashLifetime;
	message: SignableSolTransactionMessage;
	mode: 'partial' | 'send';
	signer: TransactionSigner;
}>;

function ensureAddress(value: Address | string): Address {
	return typeof value === 'string' ? address(value) : value;
}

async function resolveLifetime(
	runtime: SolanaClientRuntime,
	commitment?: Commitment,
	fallback?: BlockhashLifetime,
): Promise<BlockhashLifetime> {
	if (fallback) {
		return fallback;
	}
	const { value } = await runtime.rpc.getLatestBlockhash({ commitment }).send();
	return value;
}

function resolveSigner(
	authority: SolTransferAuthority,
	commitment?: Commitment,
): { mode: 'partial' | 'send'; signer: TransactionSigner } {
	if (isWalletSession(authority)) {
		const { signer, mode } = createWalletTransactionSigner(authority, { commitment });
		return { mode, signer };
	}
	return { mode: resolveSignerMode(authority), signer: authority };
}

function toLamportAmount(input: SolTransferAmount): bigint {
	return lamportsMath.fromLamports(input);
}

export type SolTransferHelper = Readonly<{
	prepareTransfer(config: SolTransferPrepareConfig): Promise<PreparedSolTransfer>;
	sendPreparedTransfer(
		prepared: PreparedSolTransfer,
		options?: SolTransferSendOptions,
	): Promise<ReturnType<typeof signature>>;
	sendTransfer(
		config: SolTransferPrepareConfig,
		options?: SolTransferSendOptions,
	): Promise<ReturnType<typeof signature>>;
}>;

/** Creates documented helpers that build and submit System Program SOL transfers. */
export function createSolTransferHelper(runtime: SolanaClientRuntime): SolTransferHelper {
	async function prepareTransfer(config: SolTransferPrepareConfig): Promise<PreparedSolTransfer> {
		const commitment = config.commitment;
		const lifetime = await resolveLifetime(runtime, commitment, config.lifetime);
		const { signer, mode } = resolveSigner(config.authority, commitment);
		const destination = ensureAddress(config.destination);
		const amount = toLamportAmount(config.amount);

		const message = pipe(
			createTransactionMessage({ version: config.transactionVersion ?? 0 }),
			(m) => setTransactionMessageFeePayer(signer.address, m),
			(m) => setTransactionMessageLifetimeUsingBlockhash(lifetime, m),
			(m) =>
				appendTransactionMessageInstruction(
					getTransferSolInstruction({ amount, destination, source: signer }),
					m,
				),
		);

		return {
			commitment,
			lifetime,
			message,
			mode,
			signer,
		};
	}

	async function sendPreparedTransfer(
		prepared: PreparedSolTransfer,
		options: SolTransferSendOptions = {},
	): Promise<ReturnType<typeof signature>> {
		if (prepared.mode === 'send' && isTransactionSendingSigner(prepared.signer)) {
			const signatureBytes = await signAndSendTransactionMessageWithSigners(prepared.message, {
				abortSignal: options.abortSignal,
				minContextSlot: options.minContextSlot,
			});
			const base58Decoder = getBase58Decoder();
			return signature(base58Decoder.decode(signatureBytes));
		}

		const signed = await signTransactionMessageWithSigners(prepared.message, {
			abortSignal: options.abortSignal,
			minContextSlot: options.minContextSlot,
		});
		const wire = getBase64EncodedWireTransaction(signed);
		const maxRetries =
			options.maxRetries === undefined
				? undefined
				: typeof options.maxRetries === 'bigint'
					? options.maxRetries
					: BigInt(options.maxRetries);
		const response = await runtime.rpc
			.sendTransaction(wire, {
				encoding: 'base64',
				maxRetries,
				preflightCommitment: options.commitment ?? prepared.commitment,
				skipPreflight: options.skipPreflight,
			})
			.send({ abortSignal: options.abortSignal });
		return signature(response);
	}

	async function sendTransfer(
		config: SolTransferPrepareConfig,
		options?: SolTransferSendOptions,
	): Promise<ReturnType<typeof signature>> {
		const prepared = await prepareTransfer(config);
		return await sendPreparedTransfer(prepared, options);
	}

	return {
		prepareTransfer,
		sendPreparedTransfer,
		sendTransfer,
	};
}
