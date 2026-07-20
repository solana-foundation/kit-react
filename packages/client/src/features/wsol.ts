import { getBase58Decoder } from '@solana/codecs-strings';
import {
	type Address,
	address,
	appendTransactionMessageInstruction,
	appendTransactionMessageInstructions,
	type Blockhash,
	type Commitment,
	createTransactionMessage,
	createTransactionPlanExecutor,
	getBase64EncodedWireTransaction,
	getSignatureFromTransaction,
	isSolanaError,
	isTransactionSendingSigner,
	pipe,
	SOLANA_ERROR__TRANSACTION_ERROR__ALREADY_PROCESSED,
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
import {
	findAssociatedTokenPda,
	getCloseAccountInstruction,
	getCreateAssociatedTokenIdempotentInstruction,
	getSyncNativeInstruction,
	TOKEN_PROGRAM_ADDRESS,
} from '@solana-program/token';

import { lamportsMath } from '../numeric/lamports';
import type { SolanaClientRuntime } from '../rpc/types';
import { createWalletTransactionSigner, isWalletSession, resolveSignerMode } from '../signers/walletTransactionSigner';
import type { WalletSession } from '../wallet/types';
import type { SolTransferSendOptions } from './sol';
import type { SupportedTransactionVersion } from './transactions';

/**
 * The Wrapped SOL (wSOL) mint address.
 * This is the same address on all Solana clusters (mainnet, devnet, testnet).
 * wSOL is an SPL token representation of native SOL, useful for DeFi protocols
 * that require all assets to be SPL tokens.
 *
 * @example
 * ```ts
 * import { WRAPPED_SOL_MINT } from '@solana/client';
 *
 * console.log(WRAPPED_SOL_MINT); // 'So11111111111111111111111111111111111111112'
 * ```
 */
export const WRAPPED_SOL_MINT = address('So11111111111111111111111111111111111111112');

/**
 * Blockhash and last valid block height for transaction lifetime.
 * Used to ensure transactions expire after a certain block height.
 */
type BlockhashLifetime = Readonly<{
	blockhash: Blockhash;
	lastValidBlockHeight: bigint;
}>;

/**
 * Authority that signs wSOL wrap/unwrap transactions.
 * Can be either a connected wallet session or a raw transaction signer.
 */
type WsolAuthority = TransactionSigner<string> | WalletSession;

type SignableWsolTransactionMessage = Parameters<typeof signTransactionMessageWithSigners>[0];

/**
 * Configuration for preparing a wrap SOL to wSOL transaction.
 * Wrapping creates a wSOL token account and deposits native SOL into it.
 *
 * @example
 * ```ts
 * const config: WsolWrapPrepareConfig = {
 *   amount: 1, // Wrap 1 SOL
 *   authority: walletSession,
 *   commitment: 'confirmed',
 * };
 * ```
 */
export type WsolWrapPrepareConfig = Readonly<{
	/** Amount of SOL to wrap. Can be lamports (bigint), decimal SOL (number), or string SOL. */
	amount: bigint | number | string;
	/** Authority that signs the transaction. Can be a WalletSession or raw TransactionSigner. */
	authority: WsolAuthority;
	/** Commitment level for RPC calls. */
	commitment?: Commitment;
	/** Optional pre-fetched blockhash lifetime. If not provided, one will be fetched. */
	lifetime?: BlockhashLifetime;
	/** Owner of the wSOL account. Defaults to the authority's address. */
	owner?: Address | string;
	/** Transaction version. Defaults to 0 (legacy). */
	transactionVersion?: SupportedTransactionVersion;
}>;

/**
 * Configuration for preparing an unwrap wSOL to SOL transaction.
 * Unwrapping closes the wSOL token account and returns all SOL to the owner.
 *
 * @example
 * ```ts
 * const config: WsolUnwrapPrepareConfig = {
 *   authority: walletSession,
 *   commitment: 'confirmed',
 * };
 * ```
 */
export type WsolUnwrapPrepareConfig = Readonly<{
	/** Authority that signs the transaction. Must be the owner of the wSOL account. */
	authority: WsolAuthority;
	/** Commitment level for RPC calls. */
	commitment?: Commitment;
	/** Optional pre-fetched blockhash lifetime. If not provided, one will be fetched. */
	lifetime?: BlockhashLifetime;
	/** Owner of the wSOL account. Defaults to the authority's address. */
	owner?: Address | string;
	/** Transaction version. Defaults to 0 (legacy). */
	transactionVersion?: SupportedTransactionVersion;
}>;

/**
 * A prepared wrap transaction ready to be signed and sent.
 * Contains the transaction message and metadata needed for submission.
 */
type PreparedWsolWrap = Readonly<{
	/** Amount being wrapped in lamports. */
	amount: bigint;
	/** The wSOL Associated Token Account address. */
	ataAddress: Address;
	/** Commitment level used. */
	commitment?: Commitment;
	/** Blockhash lifetime for transaction expiration. */
	lifetime: BlockhashLifetime;
	/** The unsigned transaction message. */
	message: SignableWsolTransactionMessage;
	/** Signing mode: 'send' for wallets that sign+send, 'partial' for separate signing. */
	mode: 'partial' | 'send';
	/** Owner of the wSOL account. */
	owner: Address;
	/** Transaction plan for execution. */
	plan?: TransactionPlan;
	/** The transaction signer. */
	signer: TransactionSigner;
}>;

/**
 * A prepared unwrap transaction ready to be signed and sent.
 * Contains the transaction message and metadata needed for submission.
 */
type PreparedWsolUnwrap = Readonly<{
	/** The wSOL Associated Token Account address being closed. */
	ataAddress: Address;
	/** Commitment level used. */
	commitment?: Commitment;
	/** Blockhash lifetime for transaction expiration. */
	lifetime: BlockhashLifetime;
	/** The unsigned transaction message. */
	message: SignableWsolTransactionMessage;
	/** Signing mode: 'send' for wallets that sign+send, 'partial' for separate signing. */
	mode: 'partial' | 'send';
	/** Owner receiving the unwrapped SOL. */
	owner: Address;
	/** Transaction plan for execution. */
	plan?: TransactionPlan;
	/** The transaction signer. */
	signer: TransactionSigner;
}>;

function ensureAddress(value: Address | string | undefined, fallback?: Address): Address {
	if (value) {
		return typeof value === 'string' ? address(value) : value;
	}
	if (!fallback) {
		throw new Error('An address value was expected but not provided.');
	}
	return fallback;
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
	authority: WsolAuthority,
	commitment?: Commitment,
): { mode: 'partial' | 'send'; signer: TransactionSigner } {
	if (isWalletSession(authority)) {
		const { signer, mode } = createWalletTransactionSigner(authority, { commitment });
		return { mode, signer };
	}
	return { mode: resolveSignerMode(authority), signer: authority };
}

function toLamportAmount(input: bigint | number | string): bigint {
	return lamportsMath.fromLamports(input);
}

/**
 * Helper interface for wrapping and unwrapping SOL to/from wSOL.
 * wSOL (Wrapped SOL) is an SPL token representation of native SOL.
 *
 * @example
 * ```ts
 * import { createWsolHelper } from '@solana/client';
 *
 * const wsol = createWsolHelper(runtime);
 *
 * // Check wSOL balance
 * const balance = await wsol.fetchWsolBalance(walletAddress);
 * console.log(`wSOL balance: ${balance.amount} lamports`);
 *
 * // Wrap 1 SOL to wSOL
 * const wrapSig = await wsol.sendWrap({
 *   amount: 1, // 1 SOL
 *   authority: walletSession,
 * });
 *
 * // Unwrap all wSOL back to SOL
 * const unwrapSig = await wsol.sendUnwrap({
 *   authority: walletSession,
 * });
 * ```
 */
export type WsolHelper = Readonly<{
	/**
	 * Derives the wSOL Associated Token Account (ATA) address for an owner.
	 * The ATA is a deterministic address based on the owner and wSOL mint.
	 */
	deriveWsolAddress(owner: Address | string): Promise<Address>;
	/**
	 * Fetches the wSOL balance for an owner.
	 * Returns balance info including whether the wSOL account exists.
	 */
	fetchWsolBalance(owner: Address | string, commitment?: Commitment): Promise<WsolBalance>;
	/**
	 * Prepares a wrap transaction without sending it.
	 * Use this when you need to inspect or modify the transaction before sending.
	 */
	prepareWrap(config: WsolWrapPrepareConfig): Promise<PreparedWsolWrap>;
	/**
	 * Prepares an unwrap transaction without sending it.
	 * Use this when you need to inspect or modify the transaction before sending.
	 */
	prepareUnwrap(config: WsolUnwrapPrepareConfig): Promise<PreparedWsolUnwrap>;
	/**
	 * Sends a previously prepared wrap transaction.
	 * Use this after prepareWrap() to submit the transaction.
	 */
	sendPreparedWrap(
		prepared: PreparedWsolWrap,
		options?: SolTransferSendOptions,
	): Promise<ReturnType<typeof signature>>;
	/**
	 * Sends a previously prepared unwrap transaction.
	 * Use this after prepareUnwrap() to submit the transaction.
	 */
	sendPreparedUnwrap(
		prepared: PreparedWsolUnwrap,
		options?: SolTransferSendOptions,
	): Promise<ReturnType<typeof signature>>;
	/**
	 * Wraps native SOL to wSOL in one call.
	 * Creates the wSOL token account if it doesn't exist.
	 */
	sendWrap(config: WsolWrapPrepareConfig, options?: SolTransferSendOptions): Promise<ReturnType<typeof signature>>;
	/**
	 * Unwraps all wSOL back to native SOL in one call.
	 * Closes the wSOL token account and returns all lamports to the owner.
	 */
	sendUnwrap(
		config: WsolUnwrapPrepareConfig,
		options?: SolTransferSendOptions,
	): Promise<ReturnType<typeof signature>>;
}>;

/**
 * wSOL balance information for an owner's Associated Token Account.
 *
 * @example
 * ```ts
 * const balance = await wsolHelper.fetchWsolBalance(walletAddress);
 * if (balance.exists) {
 *   console.log(`wSOL balance: ${balance.amount} lamports`);
 *   console.log(`Token account: ${balance.ataAddress}`);
 * } else {
 *   console.log('No wSOL account exists');
 * }
 * ```
 */
export type WsolBalance = Readonly<{
	/** wSOL amount in lamports. */
	amount: bigint;
	/** The wSOL Associated Token Account address. */
	ataAddress: Address;
	/** Whether the wSOL token account exists on-chain. */
	exists: boolean;
}>;

/**
 * Creates helpers for wrapping native SOL to wSOL and unwrapping back.
 * wSOL is useful for DeFi protocols that require all assets to be SPL tokens.
 *
 * @param runtime - The Solana client runtime with RPC connection.
 * @returns A WsolHelper with methods for wrap/unwrap operations.
 *
 * @example
 * ```ts
 * import { createClient } from '@solana/client';
 *
 * const client = createClient({ cluster: 'devnet' });
 * const wsol = client.helpers.wsol;
 *
 * // Wrap 0.5 SOL
 * const wrapSig = await wsol.sendWrap({
 *   amount: 0.5,
 *   authority: session,
 * });
 * console.log('Wrapped SOL, signature:', wrapSig);
 *
 * // Check balance
 * const balance = await wsol.fetchWsolBalance(myWallet);
 * console.log(`wSOL: ${Number(balance.amount) / 1e9} SOL`);
 *
 * // Unwrap all wSOL back to native SOL
 * const unwrapSig = await wsol.sendUnwrap({
 *   authority: session,
 * });
 * console.log('Unwrapped wSOL, signature:', unwrapSig);
 * ```
 */
export function createWsolHelper(runtime: SolanaClientRuntime): WsolHelper {
	const tokenProgram = address(TOKEN_PROGRAM_ADDRESS);

	async function deriveWsolAddress(owner: Address | string): Promise<Address> {
		const [ata] = await findAssociatedTokenPda({
			mint: WRAPPED_SOL_MINT,
			owner: ensureAddress(owner),
			tokenProgram,
		});
		return ata;
	}

	async function fetchWsolBalance(owner: Address | string, commitment?: Commitment): Promise<WsolBalance> {
		const ataAddress = await deriveWsolAddress(owner);
		try {
			const { value } = await runtime.rpc.getTokenAccountBalance(ataAddress, { commitment }).send();
			const amount = BigInt(value.amount);
			return {
				amount,
				ataAddress,
				exists: true,
			};
		} catch {
			return {
				amount: 0n,
				ataAddress,
				exists: false,
			};
		}
	}

	async function prepareWrap(config: WsolWrapPrepareConfig): Promise<PreparedWsolWrap> {
		const commitment = config.commitment;
		const lifetime = await resolveLifetime(runtime, commitment, config.lifetime);
		const { signer, mode } = resolveSigner(config.authority, commitment);
		const owner = ensureAddress(config.owner, signer.address);
		const amount = toLamportAmount(config.amount);
		const ataAddress = await deriveWsolAddress(owner);

		// Instructions:
		// 1. Create ATA if it doesn't exist (idempotent)
		// 2. Transfer SOL to ATA
		// 3. Sync native to update token balance
		const instructions = [
			getCreateAssociatedTokenIdempotentInstruction({
				ata: ataAddress,
				mint: WRAPPED_SOL_MINT,
				owner,
				payer: signer,
				tokenProgram,
			}),
			getTransferSolInstruction({
				amount,
				destination: ataAddress,
				source: signer,
			}),
			getSyncNativeInstruction({
				account: ataAddress,
			}),
		];

		const message = pipe(
			createTransactionMessage({ version: config.transactionVersion ?? 0 }),
			(m) => setTransactionMessageFeePayer(signer.address, m),
			(m) => setTransactionMessageLifetimeUsingBlockhash(lifetime, m),
			(m) => appendTransactionMessageInstructions(instructions, m),
		);

		return {
			amount,
			ataAddress,
			commitment,
			lifetime,
			message,
			mode,
			owner,
			plan: singleTransactionPlan(message),
			signer,
		};
	}

	async function prepareUnwrap(config: WsolUnwrapPrepareConfig): Promise<PreparedWsolUnwrap> {
		const commitment = config.commitment;
		const lifetime = await resolveLifetime(runtime, commitment, config.lifetime);
		const { signer, mode } = resolveSigner(config.authority, commitment);
		const owner = ensureAddress(config.owner, signer.address);
		const ataAddress = await deriveWsolAddress(owner);

		// Close account instruction transfers remaining lamports to destination
		const instruction = getCloseAccountInstruction({
			account: ataAddress,
			destination: owner,
			owner: signer,
		});

		const message = pipe(
			createTransactionMessage({ version: config.transactionVersion ?? 0 }),
			(m) => setTransactionMessageFeePayer(signer.address, m),
			(m) => setTransactionMessageLifetimeUsingBlockhash(lifetime, m),
			(m) => appendTransactionMessageInstruction(instruction, m),
		);

		return {
			ataAddress,
			commitment,
			lifetime,
			message,
			mode,
			owner,
			plan: singleTransactionPlan(message),
			signer,
		};
	}

	async function sendPreparedTransaction(
		prepared: PreparedWsolWrap | PreparedWsolUnwrap,
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
				const signed = await signTransactionMessageWithSigners(message as SignableWsolTransactionMessage, {
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

	async function sendPreparedWrap(
		prepared: PreparedWsolWrap,
		options?: SolTransferSendOptions,
	): Promise<ReturnType<typeof signature>> {
		return sendPreparedTransaction(prepared, options);
	}

	async function sendPreparedUnwrap(
		prepared: PreparedWsolUnwrap,
		options?: SolTransferSendOptions,
	): Promise<ReturnType<typeof signature>> {
		return sendPreparedTransaction(prepared, options);
	}

	async function sendWrap(
		config: WsolWrapPrepareConfig,
		options?: SolTransferSendOptions,
	): Promise<ReturnType<typeof signature>> {
		const prepared = await prepareWrap(config);
		try {
			return await sendPreparedWrap(prepared, options);
		} catch (error) {
			if (isSolanaError(error, SOLANA_ERROR__TRANSACTION_ERROR__ALREADY_PROCESSED)) {
				const retriedPrepared = await prepareWrap({ ...config, lifetime: undefined });
				return await sendPreparedWrap(retriedPrepared, options);
			}
			throw error;
		}
	}

	async function sendUnwrap(
		config: WsolUnwrapPrepareConfig,
		options?: SolTransferSendOptions,
	): Promise<ReturnType<typeof signature>> {
		const prepared = await prepareUnwrap(config);
		try {
			return await sendPreparedUnwrap(prepared, options);
		} catch (error) {
			if (isSolanaError(error, SOLANA_ERROR__TRANSACTION_ERROR__ALREADY_PROCESSED)) {
				const retriedPrepared = await prepareUnwrap({ ...config, lifetime: undefined });
				return await sendPreparedUnwrap(retriedPrepared, options);
			}
			throw error;
		}
	}

	return {
		deriveWsolAddress,
		fetchWsolBalance,
		prepareUnwrap,
		prepareWrap,
		sendPreparedUnwrap,
		sendPreparedWrap,
		sendUnwrap,
		sendWrap,
	};
}
