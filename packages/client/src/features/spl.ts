import { getBase58Decoder } from '@solana/codecs-strings';
import {
	type Address,
	address,
	appendTransactionMessageInstruction,
	type Blockhash,
	type Commitment,
	createTransactionMessage,
	getBase64EncodedWireTransaction,
	isSolanaError,
	isTransactionSendingSigner,
	pipe,
	SOLANA_ERROR__TRANSACTION_ERROR__ALREADY_PROCESSED,
	setTransactionMessageFeePayer,
	setTransactionMessageLifetimeUsingBlockhash,
	signAndSendTransactionMessageWithSigners,
	signature,
	signTransactionMessageWithSigners,
	type TransactionSigner,
	type TransactionVersion,
} from '@solana/kit';
import {
	fetchMint,
	findAssociatedTokenPda,
	getCreateAssociatedTokenInstruction,
	getTransferCheckedInstruction,
	TOKEN_PROGRAM_ADDRESS,
} from '@solana-program/token';

import { createTokenAmount, type TokenAmountMath } from '../numeric/amounts';
import { createWalletTransactionSigner, isWalletSession, resolveSignerMode } from '../signers/walletTransactionSigner';
import type { SolanaClientRuntime, WalletSession } from '../types';
import type { SolTransferSendOptions } from './sol';

type BlockhashLifetime = Readonly<{
	blockhash: Blockhash;
	lastValidBlockHeight: bigint;
}>;

type SplTokenAuthority = TransactionSigner<string> | WalletSession;

type SignableSplTransactionMessage = Parameters<typeof signTransactionMessageWithSigners>[0];

export type SplTokenHelperConfig = Readonly<{
	associatedTokenProgram?: Address | string;
	commitment?: Commitment;
	decimals?: number;
	mint: Address | string;
	tokenProgram?: Address | string;
}>;

export type SplTokenBalance = Readonly<{
	amount: bigint;
	ataAddress: Address;
	decimals: number;
	exists: boolean;
	uiAmount: string;
}>;

export type SplTransferPrepareConfig = Readonly<{
	amount: bigint | number | string;
	amountInBaseUnits?: boolean;
	authority: SplTokenAuthority;
	commitment?: Commitment;
	destinationOwner: Address | string;
	destinationToken?: Address | string;
	ensureDestinationAta?: boolean;
	lifetime?: BlockhashLifetime;
	sourceOwner?: Address | string;
	sourceToken?: Address | string;
	transactionVersion?: TransactionVersion;
}>;

type PreparedSplTransfer = Readonly<{
	amount: bigint;
	commitment?: Commitment;
	decimals: number;
	destinationAta: Address;
	lifetime: BlockhashLifetime;
	message: SignableSplTransactionMessage;
	mode: 'partial' | 'send';
	signer: TransactionSigner;
	sourceAta: Address;
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

export type SplTokenHelper = Readonly<{
	deriveAssociatedTokenAddress(owner: Address | string): Promise<Address>;
	fetchBalance(owner: Address | string, commitment?: Commitment): Promise<SplTokenBalance>;
	prepareTransfer(config: SplTransferPrepareConfig): Promise<PreparedSplTransfer>;
	sendPreparedTransfer(
		prepared: PreparedSplTransfer,
		options?: SolTransferSendOptions,
	): Promise<ReturnType<typeof signature>>;
	sendTransfer(
		config: SplTransferPrepareConfig,
		options?: SolTransferSendOptions,
	): Promise<ReturnType<typeof signature>>;
}>;

/** Creates helpers dedicated to SPL token account discovery, balances, and transfers. */
export function createSplTokenHelper(runtime: SolanaClientRuntime, config: SplTokenHelperConfig): SplTokenHelper {
	const mintAddress = ensureAddress(config.mint);
	const tokenProgram = ensureAddress(config.tokenProgram, address(TOKEN_PROGRAM_ADDRESS));

	let cachedDecimals: number | undefined = config.decimals;
	let cachedMath: TokenAmountMath | undefined;

	async function resolveDecimals(commitment?: Commitment): Promise<number> {
		if (cachedDecimals !== undefined) {
			return cachedDecimals;
		}
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

	async function deriveAssociatedTokenAddress(owner: Address | string): Promise<Address> {
		const [ata] = await findAssociatedTokenPda({
			mint: mintAddress,
			owner: ensureAddress(owner),
			tokenProgram,
		});
		return ata;
	}

	async function fetchBalance(owner: Address | string, commitment?: Commitment): Promise<SplTokenBalance> {
		const ataAddress = await deriveAssociatedTokenAddress(owner);
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
		const lifetime = await resolveLifetime(runtime, commitment, config.lifetime);
		const { signer, mode } = resolveSigner(config.authority, commitment);
		const sourceOwner = ensureAddress(config.sourceOwner, signer.address);
		const destinationOwner = ensureAddress(config.destinationOwner);

		const sourceAta = ensureAddress(config.sourceToken, await deriveAssociatedTokenAddress(sourceOwner));
		const destinationAta = ensureAddress(
			config.destinationToken,
			await deriveAssociatedTokenAddress(destinationOwner),
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
