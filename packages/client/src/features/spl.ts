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
import {
	fetchMint as fetchMintStandard,
	findAssociatedTokenPda,
	getCreateAssociatedTokenInstruction,
	getTransferCheckedInstruction as getTransferCheckedStandard,
	TOKEN_PROGRAM_ADDRESS,
} from '@solana-program/token';
import {
	fetchMint as fetchMintToken2022,
	getTransferCheckedInstruction as getTransferCheckedToken2022,
	TOKEN_2022_PROGRAM_ADDRESS,
} from '@solana-program/token-2022';
import { createTokenAmount, type TokenAmountMath } from '../numeric/amounts';
import type { SolanaClientRuntime } from '../rpc/types';
import { createWalletTransactionSigner, isWalletSession, resolveSignerMode } from '../signers/walletTransactionSigner';
import type { WalletSession } from '../wallet/types';
import type { SolTransferSendOptions } from './sol';
import { detectTokenProgram } from './tokenPrograms';
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
 * Authority that signs SPL token transfer transactions.
 * Can be either a connected wallet session or a raw transaction signer.
 */
type SplTokenAuthority = TransactionSigner<string> | WalletSession;

type SignableSplTransactionMessage = Parameters<typeof signTransactionMessageWithSigners>[0];

/**
 * Configuration for creating an SPL token helper.
 * Each helper instance is bound to a specific token mint.
 *
 * @example
 * ```ts
 * const config: SplTokenHelperConfig = {
 *   mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
 *   decimals: 6, // Optional: provide to skip on-chain lookup
 *   commitment: 'confirmed',
 * };
 * ```
 */
export type SplTokenHelperConfig = Readonly<{
	/** Associated Token Program address. Defaults to standard ATA program. */
	associatedTokenProgram?: Address | string;
	/** Commitment level for RPC calls. */
	commitment?: Commitment;
	/** Token decimals. If not provided, will be fetched from the mint account. */
	decimals?: number;
	/** The SPL token mint address. */
	mint: Address | string;
	/**
	 * Token Program address. Defaults to standard Token Program.
	 * Set to 'auto' to automatically detect based on mint account owner.
	 * Note: Auto-detection requires the mint to already exist on-chain.
	 */
	tokenProgram?: Address | string | 'auto';
}>;

/**
 * SPL token balance information for an owner's Associated Token Account.
 *
 * @example
 * ```ts
 * const balance: SplTokenBalance = {
 *   amount: 1000000n, // Raw token amount in base units
 *   ataAddress: 'TokenAccountAddress...',
 *   decimals: 6,
 *   exists: true,
 *   uiAmount: '1.0', // Human-readable amount
 * };
 * ```
 */
export type SplTokenBalance = Readonly<{
	/** Token amount in base units (smallest denomination). */
	amount: bigint;
	/** The Associated Token Account address. */
	ataAddress: Address;
	/** Number of decimals for this token. */
	decimals: number;
	/** Whether the token account exists on-chain. */
	exists: boolean;
	/** Human-readable token amount as a string. */
	uiAmount: string;
}>;

/**
 * Configuration for preparing an SPL token transfer transaction.
 *
 * @example
 * ```ts
 * const config: SplTransferPrepareConfig = {
 *   amount: '10.5', // Transfer 10.5 tokens
 *   authority: walletSession,
 *   destinationOwner: 'RecipientWalletAddress...',
 *   ensureDestinationAta: true, // Create ATA if needed
 * };
 * ```
 */
export type SplTransferPrepareConfig = Readonly<{
	/** Amount to transfer. Interpreted based on amountInBaseUnits flag. */
	amount: bigint | number | string;
	/** If true, amount is in base units (raw). If false (default), amount is in decimal tokens. */
	amountInBaseUnits?: boolean;
	/** Authority that signs the transaction. Can be a WalletSession or raw TransactionSigner. */
	authority: SplTokenAuthority;
	/** Commitment level for RPC calls. */
	commitment?: Commitment;
	/** Wallet address of the recipient (not their token account). */
	destinationOwner: Address | string;
	/** Optional: explicit destination token account. If not provided, ATA is derived. */
	destinationToken?: Address | string;
	/** If true (default), creates the destination ATA if it doesn't exist. */
	ensureDestinationAta?: boolean;
	/** Optional pre-fetched blockhash lifetime. */
	lifetime?: BlockhashLifetime;
	/** Source wallet owner. Defaults to authority address. */
	sourceOwner?: Address | string;
	/** Optional: explicit source token account. If not provided, ATA is derived. */
	sourceToken?: Address | string;
	/** Transaction version. Defaults to 0 (legacy). */
	transactionVersion?: SupportedTransactionVersion;
}>;

/**
 * A prepared SPL token transfer transaction ready to be signed and sent.
 * Contains all the information needed to submit the transaction.
 */
type PreparedSplTransfer = Readonly<{
	/** Token amount in base units. */
	amount: bigint;
	/** Commitment level used. */
	commitment?: Commitment;
	/** Token decimals. */
	decimals: number;
	/** Destination Associated Token Account address. */
	destinationAta: Address;
	/** Blockhash lifetime for transaction expiration. */
	lifetime: BlockhashLifetime;
	/** The unsigned transaction message. */
	message: SignableSplTransactionMessage;
	/** Signing mode: 'send' for wallets that sign+send, 'partial' for separate signing. */
	mode: 'partial' | 'send';
	/** The transaction signer. */
	signer: TransactionSigner;
	/** Source Associated Token Account address. */
	sourceAta: Address;
	/** Transaction plan for execution. */
	plan?: TransactionPlan;
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
	authority: SplTokenAuthority,
	commitment?: Commitment,
): { mode: 'partial' | 'send'; signer: TransactionSigner } {
	if (isWalletSession(authority)) {
		const { signer, mode } = createWalletTransactionSigner(authority, { commitment });
		return { mode, signer };
	}
	return { mode: resolveSignerMode(authority), signer: authority };
}

/**
 * Helper interface for SPL token operations including balance queries and transfers.
 * Each helper instance is bound to a specific token mint.
 *
 * @example
 * ```ts
 * import { createSplTokenHelper } from '@solana/client';
 *
 * // Create helper for USDC
 * const usdc = createSplTokenHelper(runtime, {
 *   mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
 *   decimals: 6,
 * });
 *
 * // Check balance
 * const balance = await usdc.fetchBalance(walletAddress);
 * console.log(`Balance: ${balance.uiAmount} USDC`);
 *
 * // Transfer tokens
 * const sig = await usdc.sendTransfer({
 *   amount: 10, // 10 USDC
 *   authority: walletSession,
 *   destinationOwner: recipientAddress,
 * });
 * ```
 */
export type SplTokenHelper = Readonly<{
	/**
	 * Derives the Associated Token Account (ATA) address for an owner.
	 * The ATA is a deterministic address based on the owner, mint, and token program.
	 * When using tokenProgram: 'auto', the commitment is used for program detection.
	 */
	deriveAssociatedTokenAddress(owner: Address | string, commitment?: Commitment): Promise<Address>;
	/**
	 * Fetches the token balance for an owner's Associated Token Account.
	 * Returns balance info including whether the account exists.
	 */
	fetchBalance(owner: Address | string, commitment?: Commitment): Promise<SplTokenBalance>;
	/**
	 * Prepares a token transfer transaction without sending it.
	 * Use this when you need to inspect or modify the transaction before sending.
	 */
	prepareTransfer(config: SplTransferPrepareConfig): Promise<PreparedSplTransfer>;
	/**
	 * Sends a previously prepared token transfer transaction.
	 * Use this after prepareTransfer() to submit the transaction.
	 */
	sendPreparedTransfer(
		prepared: PreparedSplTransfer,
		options?: SolTransferSendOptions,
	): Promise<ReturnType<typeof signature>>;
	/**
	 * Prepares and sends a token transfer in one call.
	 * Automatically creates the destination ATA if it doesn't exist (configurable).
	 */
	sendTransfer(
		config: SplTransferPrepareConfig,
		options?: SolTransferSendOptions,
	): Promise<ReturnType<typeof signature>>;
}>;

/**
 * Creates helpers for SPL token operations bound to a specific token mint.
 * Supports balance queries, ATA derivation, and token transfers.
 *
 * @param runtime - The Solana client runtime with RPC connection.
 * @param config - Configuration specifying the token mint and optional settings.
 * @returns An SplTokenHelper with methods for token operations.
 *
 * @example
 * ```ts
 * import { createClient } from '@solana/client';
 *
 * const client = createClient({ cluster: 'mainnet-beta' });
 *
 * // Create a helper for USDC
 * const usdc = client.helpers.spl({
 *   mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
 *   decimals: 6, // Skip on-chain lookup
 * });
 *
 * // Get token balance
 * const balance = await usdc.fetchBalance(myWallet);
 * if (balance.exists) {
 *   console.log(`USDC balance: ${balance.uiAmount}`);
 * }
 *
 * // Transfer tokens
 * const sig = await usdc.sendTransfer({
 *   amount: '25.50', // Can use string decimals
 *   authority: session,
 *   destinationOwner: recipientWallet,
 * });
 * ```
 */
export function createSplTokenHelper(runtime: SolanaClientRuntime, config: SplTokenHelperConfig): SplTokenHelper {
	const mintAddress = ensureAddress(config.mint);

	let cachedDecimals: number | undefined = config.decimals;
	let cachedMath: TokenAmountMath | undefined;
	let resolvedTokenProgram: Address | undefined =
		config.tokenProgram && config.tokenProgram !== 'auto' ? ensureAddress(config.tokenProgram) : undefined;
	let isToken2022: boolean | undefined =
		config.tokenProgram === 'auto'
			? undefined
			: config.tokenProgram
				? config.tokenProgram === TOKEN_2022_PROGRAM_ADDRESS ||
					(typeof config.tokenProgram === 'string' && config.tokenProgram === TOKEN_2022_PROGRAM_ADDRESS)
				: false;

	async function resolveTokenProgram(commitment?: Commitment): Promise<Address> {
		if (resolvedTokenProgram) {
			return resolvedTokenProgram;
		}

		if (config.tokenProgram === 'auto') {
			const result = await detectTokenProgram(runtime, mintAddress, commitment);
			resolvedTokenProgram = result.programAddress;
			isToken2022 = result.programId === 'token-2022';
		} else {
			resolvedTokenProgram = address(TOKEN_PROGRAM_ADDRESS);
			isToken2022 = false;
		}

		return resolvedTokenProgram;
	}

	async function resolveDecimals(commitment?: Commitment): Promise<number> {
		if (cachedDecimals !== undefined) {
			return cachedDecimals;
		}

		const tokenProgram = await resolveTokenProgram(commitment);
		const fetchMint = tokenProgram === TOKEN_2022_PROGRAM_ADDRESS ? fetchMintToken2022 : fetchMintStandard;
		const account = await fetchMint(runtime.rpc, mintAddress, { commitment });
		cachedDecimals = account.data.decimals;
		return cachedDecimals;
	}

	async function getTokenMath(commitment?: Commitment): Promise<TokenAmountMath> {
		if (cachedMath) {
			return cachedMath;
		}
		const decimals = await resolveDecimals(commitment);
		cachedMath = createTokenAmount(decimals);
		return cachedMath;
	}

	async function deriveAssociatedTokenAddress(owner: Address | string, commitment?: Commitment): Promise<Address> {
		const tokenProgram = await resolveTokenProgram(commitment);
		const [ata] = await findAssociatedTokenPda({
			mint: mintAddress,
			owner: ensureAddress(owner),
			tokenProgram,
		});
		return ata;
	}

	async function fetchBalance(owner: Address | string, commitment?: Commitment): Promise<SplTokenBalance> {
		const ataAddress = await deriveAssociatedTokenAddress(owner, commitment);
		const decimals = await resolveDecimals(commitment);
		try {
			const { value } = await runtime.rpc.getTokenAccountBalance(ataAddress, { commitment }).send();
			const math = await getTokenMath(commitment);
			const amount = math.fromBaseUnits(value.amount, 'balance');
			const uiAmount = value.uiAmountString ?? value.amount;
			return {
				amount,
				ataAddress,
				decimals,
				exists: true,
				uiAmount,
			};
		} catch {
			return {
				amount: 0n,
				ataAddress,
				decimals,
				exists: false,
				uiAmount: '0',
			};
		}
	}

	async function prepareTransfer(config: SplTransferPrepareConfig): Promise<PreparedSplTransfer> {
		const commitment = config.commitment;
		const tokenProgram = await resolveTokenProgram(commitment);
		const lifetime = await resolveLifetime(runtime, commitment, config.lifetime);
		const { signer, mode } = resolveSigner(config.authority, commitment);
		const sourceOwner = ensureAddress(config.sourceOwner, signer.address);
		const destinationOwner = ensureAddress(config.destinationOwner);

		const sourceAta = ensureAddress(
			config.sourceToken,
			await deriveAssociatedTokenAddress(sourceOwner, commitment),
		);
		const destinationAta = ensureAddress(
			config.destinationToken,
			await deriveAssociatedTokenAddress(destinationOwner, commitment),
		);

		const math = await getTokenMath(commitment);
		const decimals = await resolveDecimals(commitment);
		const amount = config.amountInBaseUnits
			? math.fromBaseUnits(config.amount, 'amount')
			: math.fromDecimal(config.amount as number | string, { label: 'amount' });

		const instructionList: Parameters<typeof appendTransactionMessageInstruction>[0][] = [];
		if (config.ensureDestinationAta ?? true) {
			const { value } = await runtime.rpc
				.getAccountInfo(destinationAta, {
					commitment,
					dataSlice: { length: 0, offset: 0 },
					encoding: 'base64',
				})
				.send();
			if (!value) {
				instructionList.push(
					getCreateAssociatedTokenInstruction({
						ata: destinationAta,
						mint: mintAddress,
						owner: destinationOwner,
						payer: signer,
						tokenProgram,
					}),
				);
			}
		}

		// Use the correct transfer instruction based on token program
		const getTransferCheckedInstruction = isToken2022 ? getTransferCheckedToken2022 : getTransferCheckedStandard;

		instructionList.push(
			getTransferCheckedInstruction({
				amount,
				authority: signer,
				decimals,
				destination: destinationAta,
				mint: mintAddress,
				source: sourceAta,
			}),
		);

		let message: SignableSplTransactionMessage = pipe(
			createTransactionMessage({ version: config.transactionVersion ?? 0 }),
			(m) => setTransactionMessageFeePayer(signer.address, m),
			(m) => setTransactionMessageLifetimeUsingBlockhash(lifetime, m),
		);

		for (const instruction of instructionList) {
			message = appendTransactionMessageInstruction(instruction, message);
		}

		return {
			amount,
			commitment,
			decimals,
			destinationAta,
			lifetime,
			message,
			mode,
			signer,
			sourceAta,
			plan: singleTransactionPlan(message),
		};
	}

	async function sendPreparedTransfer(
		prepared: PreparedSplTransfer,
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
				const signed = await signTransactionMessageWithSigners(message as SignableSplTransactionMessage, {
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
		config: SplTransferPrepareConfig,
		options?: SolTransferSendOptions,
	): Promise<ReturnType<typeof signature>> {
		const prepared = await prepareTransfer(config);
		try {
			return await sendPreparedTransfer(prepared, options);
		} catch (error) {
			if (isSolanaError(error, SOLANA_ERROR__TRANSACTION_ERROR__ALREADY_PROCESSED)) {
				const retriedPrepared = await prepareTransfer({ ...config, lifetime: undefined });
				return await sendPreparedTransfer(retriedPrepared, options);
			}
			throw error;
		}
	}

	return {
		deriveAssociatedTokenAddress,
		fetchBalance,
		prepareTransfer,
		sendPreparedTransfer,
		sendTransfer,
	};
}
