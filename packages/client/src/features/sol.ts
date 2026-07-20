import { getBase58Decoder } from '@solana/codecs-strings';
import {
	type Address,
	address,
	appendTransactionMessageInstruction,
	type Blockhash,
	type Commitment,
	createTransactionMessage,
	createTransactionPlanExecutor,
	getBase64EncodedWireTransaction,
	getSignatureFromTransaction,
	isTransactionSendingSigner,
	pipe,
	type Slot,
	setTransactionMessageFeePayer,
	setTransactionMessageLifetimeUsingBlockhash,
	signAndSendTransactionMessageWithSigners,
	signature,
	signTransactionMessageWithSigners,
	singleTransactionPlan,
	type TransactionPlan,
	type TransactionSigner,
} from '@solana/kit';
import { getTransferSolInstruction } from '@solana-program/system';

import { lamportsMath } from '../numeric/lamports';
import type { SolanaClientRuntime } from '../rpc/types';
import { createWalletTransactionSigner, isWalletSession, resolveSignerMode } from '../signers/walletTransactionSigner';
import type { WalletSession } from '../wallet/types';
import type { SupportedTransactionVersion } from './transactions';

/**
 * Blockhash and last valid block height for transaction lifetime.
 * Used to ensure transactions expire after a certain block height.
 */
type BlockhashLifetime = Readonly<{
	blockhash: Blockhash;
	lastValidBlockHeight: bigint;
}>;

/**
 * Amount of SOL to transfer. Can be specified as:
 * - `bigint`: Raw lamports (1 SOL = 1_000_000_000 lamports)
 * - `number`: SOL amount as decimal (e.g., 1.5 for 1.5 SOL)
 * - `string`: SOL amount as string (e.g., "1.5" for 1.5 SOL)
 */
type SolTransferAmount = bigint | number | string;

/**
 * Authority that signs the SOL transfer transaction.
 * Can be either a connected wallet session or a raw transaction signer.
 */
type SolTransferAuthority = TransactionSigner<string> | WalletSession;

type SignableSolTransactionMessage = Parameters<typeof signTransactionMessageWithSigners>[0];

/**
 * Configuration for preparing a SOL transfer transaction.
 *
 * @example
 * ```ts
 * const config: SolTransferPrepareConfig = {
 *   amount: 1_000_000_000n, // 1 SOL in lamports
 *   authority: walletSession,
 *   destination: 'RecipientAddress...',
 *   commitment: 'confirmed',
 * };
 * ```
 */
export type SolTransferPrepareConfig = Readonly<{
	/** Amount of SOL to transfer in lamports, decimal SOL, or string SOL. */
	amount: SolTransferAmount;
	/** Authority that signs the transaction. Can be a WalletSession or raw TransactionSigner. */
	authority: SolTransferAuthority;
	/** Commitment level for fetching blockhash and sending transaction. Defaults to client commitment. */
	commitment?: Commitment;
	/** Destination wallet address to receive the SOL. */
	destination: Address | string;
	/** Optional pre-fetched blockhash lifetime. If not provided, one will be fetched. */
	lifetime?: BlockhashLifetime;
	/** Transaction version. Defaults to 0 (legacy). */
	transactionVersion?: SupportedTransactionVersion;
}>;

/**
 * Options for sending a SOL transfer transaction.
 *
 * @example
 * ```ts
 * const options: SolTransferSendOptions = {
 *   commitment: 'confirmed',
 *   maxRetries: 3,
 *   skipPreflight: false,
 * };
 * ```
 */
export type SolTransferSendOptions = Readonly<{
	/** AbortSignal to cancel the transaction. */
	abortSignal?: AbortSignal;
	/** Commitment level for transaction confirmation. */
	commitment?: Commitment;
	/** Maximum number of times to retry sending the transaction. */
	maxRetries?: bigint | number;
	/** Minimum slot that the request can be evaluated at. */
	minContextSlot?: Slot;
	/** If true, skip the preflight transaction checks. */
	skipPreflight?: boolean;
}>;

/**
 * A prepared SOL transfer transaction ready to be signed and sent.
 * Contains the transaction message, signer, and metadata needed for submission.
 */
type PreparedSolTransfer = Readonly<{
	/** Commitment level used for this transaction. */
	commitment?: Commitment;
	/** Blockhash lifetime for transaction expiration. */
	lifetime: BlockhashLifetime;
	/** The unsigned transaction message. */
	message: SignableSolTransactionMessage;
	/** Signing mode: 'send' for wallets that sign+send, 'partial' for separate signing. */
	mode: 'partial' | 'send';
	/** The transaction signer. */
	signer: TransactionSigner;
	/** Transaction plan for execution. */
	plan?: TransactionPlan;
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

/**
 * Helper interface for native SOL transfers using the System Program.
 * Provides methods to prepare, sign, and send SOL transfer transactions.
 *
 * @example
 * ```ts
 * import { createSolTransferHelper } from '@solana/client';
 *
 * const helper = createSolTransferHelper(runtime);
 *
 * // Simple transfer
 * const signature = await helper.sendTransfer({
 *   amount: 1_000_000_000n, // 1 SOL
 *   authority: walletSession,
 *   destination: 'RecipientAddress...',
 * });
 *
 * // Or prepare and send separately
 * const prepared = await helper.prepareTransfer({ ... });
 * const signature = await helper.sendPreparedTransfer(prepared);
 * ```
 */
export type SolTransferHelper = Readonly<{
	/**
	 * Prepares a SOL transfer transaction without sending it.
	 * Use this when you need to inspect or modify the transaction before sending.
	 */
	prepareTransfer(config: SolTransferPrepareConfig): Promise<PreparedSolTransfer>;
	/**
	 * Sends a previously prepared SOL transfer transaction.
	 * Use this after prepareTransfer() to submit the transaction.
	 */
	sendPreparedTransfer(
		prepared: PreparedSolTransfer,
		options?: SolTransferSendOptions,
	): Promise<ReturnType<typeof signature>>;
	/**
	 * Prepares and sends a SOL transfer in one call.
	 * This is the simplest way to transfer SOL.
	 */
	sendTransfer(
		config: SolTransferPrepareConfig,
		options?: SolTransferSendOptions,
	): Promise<ReturnType<typeof signature>>;
}>;

/**
 * Creates helpers for building and submitting native SOL transfers via the System Program.
 *
 * @param runtime - The Solana client runtime with RPC connection.
 * @returns A SolTransferHelper with methods to prepare and send SOL transfers.
 *
 * @example
 * ```ts
 * import { createClient } from '@solana/client';
 *
 * const client = createClient({ cluster: 'devnet' });
 * const helper = client.helpers.sol;
 *
 * // Transfer 0.5 SOL
 * const sig = await helper.sendTransfer({
 *   amount: 0.5, // Can use decimal SOL
 *   authority: session,
 *   destination: 'RecipientAddress...',
 * });
 * console.log('Transfer signature:', sig);
 * ```
 */
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
			plan: singleTransactionPlan(message),
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

		const commitment = options.commitment ?? prepared.commitment;
		const maxRetries =
			options.maxRetries === undefined
				? undefined
				: typeof options.maxRetries === 'bigint'
					? options.maxRetries
					: BigInt(options.maxRetries);
		let latestSignature: ReturnType<typeof signature> | null = null;
		const executor = createTransactionPlanExecutor({
			async executeTransactionMessage(context, message, config = {}) {
				const signed = await signTransactionMessageWithSigners(message as SignableSolTransactionMessage, {
					abortSignal: config.abortSignal ?? options.abortSignal,
					minContextSlot: options.minContextSlot,
				});
				context.transaction = signed;
				context.signature = getSignatureFromTransaction(signed);
				const wire = getBase64EncodedWireTransaction(signed);
				const response = await runtime.rpc
					.sendTransaction(wire, {
						encoding: 'base64',
						maxRetries,
						preflightCommitment: commitment,
						skipPreflight: options.skipPreflight,
					})
					.send({ abortSignal: config.abortSignal ?? options.abortSignal });
				latestSignature = signature(response);
				return signed;
			},
		});
		await executor(prepared.plan ?? singleTransactionPlan(prepared.message), { abortSignal: options.abortSignal });
		if (!latestSignature) {
			throw new Error('Failed to resolve transaction signature.');
		}
		return latestSignature;
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
