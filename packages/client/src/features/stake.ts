import { getBase58Decoder } from '@solana/codecs-strings';
import {
	type Address,
	address,
	appendTransactionMessageInstructions,
	type Base58EncodedBytes,
	type Blockhash,
	type Commitment,
	createTransactionMessage,
	createTransactionPlanExecutor,
	generateKeyPairSigner,
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
import {
	getDeactivateInstruction,
	getDelegateStakeInstruction,
	getInitializeInstruction,
	getWithdrawInstruction,
} from '@solana-program/stake';
import { getCreateAccountInstruction } from '@solana-program/system';

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
 * Amount of SOL to stake. Can be specified as:
 * - `bigint`: Raw lamports (1 SOL = 1_000_000_000 lamports)
 * - `number`: SOL amount as decimal (e.g., 1.5 for 1.5 SOL)
 * - `string`: SOL amount as string (e.g., "1.5" for 1.5 SOL)
 */
type StakeAmount = bigint | number | string;

/**
 * Authority that signs staking transactions.
 * Can be either a connected wallet session or a raw transaction signer.
 */
type StakeAuthority = TransactionSigner<string> | WalletSession;

/**
 * Represents a stake account with its delegation and metadata.
 * Returned by getStakeAccounts() when querying stake positions.
 *
 * @example
 * ```ts
 * const accounts = await stakeHelper.getStakeAccounts(walletAddress);
 * for (const acc of accounts) {
 *   const delegation = acc.account.data.parsed.info.stake?.delegation;
 *   console.log(`Staked ${acc.account.lamports} to validator ${delegation?.voter}`);
 * }
 * ```
 */
export type StakeAccount = {
	/** The stake account's public key address. */
	pubkey: Address;
	account: {
		data: {
			parsed: {
				info: {
					stake?: {
						delegation?: {
							/** The validator vote account receiving the stake. */
							voter: string;
							/** Amount of lamports delegated. */
							stake: string;
							/** Epoch when stake became active. */
							activationEpoch: string;
							/** Epoch when stake will deactivate (max value if active). */
							deactivationEpoch: string;
						};
					};
					meta?: {
						/** Rent-exempt reserve in lamports. */
						rentExemptReserve: string;
						authorized: {
							/** Address authorized to delegate/undelegate. */
							staker: string;
							/** Address authorized to withdraw. */
							withdrawer: string;
						};
						lockup: {
							/** Unix timestamp when lockup expires (0 if none). */
							unixTimestamp: number;
							/** Epoch when lockup expires (0 if none). */
							epoch: number;
							/** Custodian who can modify lockup (system program if none). */
							custodian: string;
						};
					};
				};
			};
		};
		/** Total lamports in the stake account. */
		lamports: bigint;
	};
};

type SignableStakeTransactionMessage = Parameters<typeof signTransactionMessageWithSigners>[0];

// Stake Program constants
const STAKE_PROGRAM_ID: Address = 'Stake11111111111111111111111111111111111111' as Address;
const SYSVAR_CLOCK: Address = 'SysvarC1ock11111111111111111111111111111111' as Address;
const SYSVAR_STAKE_HISTORY: Address = 'SysvarStakeHistory1111111111111111111111111' as Address;
const UNUSED_STAKE_CONFIG_ACC: Address = 'StakeConfig11111111111111111111111111111111' as Address;
const STAKE_STATE_LEN = 200;

/**
 * Configuration for preparing a stake delegation transaction.
 * Creates a new stake account and delegates it to a validator.
 *
 * @example
 * ```ts
 * const config: StakePrepareConfig = {
 *   amount: 10, // Stake 10 SOL
 *   authority: walletSession,
 *   validatorId: 'ValidatorVoteAccountAddress...',
 * };
 * ```
 */
export type StakePrepareConfig = Readonly<{
	/** Amount of SOL to stake in lamports, decimal SOL, or string SOL. */
	amount: StakeAmount;
	/** Authority that signs the transaction. Will be set as staker and withdrawer. */
	authority: StakeAuthority;
	/** Commitment level for RPC calls. */
	commitment?: Commitment;
	/** Optional pre-fetched blockhash lifetime. */
	lifetime?: BlockhashLifetime;
	/** Transaction version. Defaults to 0 (legacy). */
	transactionVersion?: SupportedTransactionVersion;
	/** The validator's vote account address to delegate stake to. */
	validatorId: Address | string;
}>;

/**
 * Options for sending stake-related transactions.
 *
 * @example
 * ```ts
 * const options: StakeSendOptions = {
 *   commitment: 'confirmed',
 *   maxRetries: 3,
 * };
 * ```
 */
export type StakeSendOptions = Readonly<{
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
 * Configuration for preparing an unstake (deactivate) transaction.
 * Deactivating stake begins the cooldown period before withdrawal is possible.
 *
 * @example
 * ```ts
 * const config: UnstakePrepareConfig = {
 *   authority: walletSession,
 *   stakeAccount: 'StakeAccountAddress...',
 * };
 * ```
 */
export type UnstakePrepareConfig = Readonly<{
	/** Authority that signed the original stake (must be the staker). */
	authority: StakeAuthority;
	/** Commitment level for RPC calls. */
	commitment?: Commitment;
	/** Optional pre-fetched blockhash lifetime. */
	lifetime?: BlockhashLifetime;
	/** The stake account address to deactivate. */
	stakeAccount: Address | string;
	/** Transaction version. Defaults to 0 (legacy). */
	transactionVersion?: SupportedTransactionVersion;
}>;

/** Options for sending unstake transactions. Same as StakeSendOptions. */
export type UnstakeSendOptions = StakeSendOptions;

/**
 * Configuration for preparing a stake withdrawal transaction.
 * Withdraws SOL from a deactivated stake account.
 *
 * @example
 * ```ts
 * const config: WithdrawPrepareConfig = {
 *   amount: 10, // Withdraw 10 SOL
 *   authority: walletSession,
 *   destination: walletAddress,
 *   stakeAccount: 'StakeAccountAddress...',
 * };
 * ```
 */
export type WithdrawPrepareConfig = Readonly<{
	/** Amount of SOL to withdraw in lamports, decimal SOL, or string SOL. */
	amount: StakeAmount;
	/** Authority that signed the original stake (must be the withdrawer). */
	authority: StakeAuthority;
	/** Commitment level for RPC calls. */
	commitment?: Commitment;
	/** Destination address to receive the withdrawn SOL. */
	destination: Address | string;
	/** Optional pre-fetched blockhash lifetime. */
	lifetime?: BlockhashLifetime;
	/** The stake account address to withdraw from. */
	stakeAccount: Address | string;
	/** Transaction version. Defaults to 0 (legacy). */
	transactionVersion?: SupportedTransactionVersion;
}>;

/** Options for sending withdrawal transactions. Same as StakeSendOptions. */
export type WithdrawSendOptions = StakeSendOptions;

type PreparedUnstake = Readonly<{
	commitment?: Commitment;
	lifetime: BlockhashLifetime;
	message: SignableStakeTransactionMessage;
	mode: 'partial' | 'send';
	plan: TransactionPlan;
	signer: TransactionSigner<string>;
}>;

type PreparedWithdraw = Readonly<{
	commitment?: Commitment;
	lifetime: BlockhashLifetime;
	message: SignableStakeTransactionMessage;
	mode: 'partial' | 'send';
	plan: TransactionPlan;
	signer: TransactionSigner<string>;
}>;

type PreparedStake = Readonly<{
	commitment?: Commitment;
	lifetime: BlockhashLifetime;
	message: SignableStakeTransactionMessage;
	mode: 'partial' | 'send';
	signer: TransactionSigner;
	plan?: TransactionPlan;
	stakeAccount: TransactionSigner<string>;
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
	authority: StakeAuthority,
	commitment?: Commitment,
): { mode: 'partial' | 'send'; signer: TransactionSigner } {
	if (isWalletSession(authority)) {
		const { signer, mode } = createWalletTransactionSigner(authority, { commitment });
		return { mode, signer };
	}
	return { mode: resolveSignerMode(authority), signer: authority };
}

function toLamportAmount(input: StakeAmount): bigint {
	return lamportsMath.fromLamports(input);
}

/**
 * Helper interface for native SOL staking operations.
 * Supports staking to validators, unstaking (deactivating), and withdrawing.
 *
 * @example
 * ```ts
 * import { createStakeHelper } from '@solana/client';
 *
 * const stakeHelper = createStakeHelper(runtime);
 *
 * // Stake SOL to a validator
 * const stakeSig = await stakeHelper.sendStake({
 *   amount: 10, // 10 SOL
 *   authority: walletSession,
 *   validatorId: 'ValidatorVoteAccount...',
 * });
 *
 * // Query stake accounts
 * const accounts = await stakeHelper.getStakeAccounts(walletAddress);
 *
 * // Deactivate stake (begin cooldown)
 * const unstakeSig = await stakeHelper.sendUnstake({
 *   authority: walletSession,
 *   stakeAccount: accounts[0].pubkey,
 * });
 *
 * // Withdraw after cooldown (~2-3 days on mainnet)
 * const withdrawSig = await stakeHelper.sendWithdraw({
 *   amount: 10,
 *   authority: walletSession,
 *   destination: walletAddress,
 *   stakeAccount: accounts[0].pubkey,
 * });
 * ```
 */
export type StakeHelper = Readonly<{
	/**
	 * Queries all stake accounts owned by a wallet.
	 * Optionally filter by validator to see stakes to a specific validator.
	 */
	getStakeAccounts(wallet: Address | string, validatorId?: Address | string): Promise<StakeAccount[]>;
	/**
	 * Prepares a stake transaction without sending it.
	 * Creates a new stake account and delegates it to the specified validator.
	 */
	prepareStake(config: StakePrepareConfig): Promise<PreparedStake>;
	/**
	 * Prepares an unstake (deactivate) transaction without sending it.
	 * Deactivating begins the cooldown period before funds can be withdrawn.
	 */
	prepareUnstake(config: UnstakePrepareConfig): Promise<PreparedUnstake>;
	/**
	 * Prepares a withdrawal transaction without sending it.
	 * Can only withdraw from deactivated stake accounts after cooldown.
	 */
	prepareWithdraw(config: WithdrawPrepareConfig): Promise<PreparedWithdraw>;
	/** Sends a previously prepared stake transaction. */
	sendPreparedStake(prepared: PreparedStake, options?: StakeSendOptions): Promise<ReturnType<typeof signature>>;
	/** Sends a previously prepared unstake transaction. */
	sendPreparedUnstake(prepared: PreparedUnstake, options?: UnstakeSendOptions): Promise<ReturnType<typeof signature>>;
	/** Sends a previously prepared withdrawal transaction. */
	sendPreparedWithdraw(
		prepared: PreparedWithdraw,
		options?: WithdrawSendOptions,
	): Promise<ReturnType<typeof signature>>;
	/**
	 * Prepares and sends a stake transaction in one call.
	 * Creates a new stake account and delegates to the validator.
	 */
	sendStake(config: StakePrepareConfig, options?: StakeSendOptions): Promise<ReturnType<typeof signature>>;
	/**
	 * Prepares and sends an unstake transaction in one call.
	 * Begins the cooldown period for the stake account.
	 */
	sendUnstake(config: UnstakePrepareConfig, options?: UnstakeSendOptions): Promise<ReturnType<typeof signature>>;
	/**
	 * Prepares and sends a withdrawal transaction in one call.
	 * Withdraws SOL from a deactivated stake account.
	 */
	sendWithdraw(config: WithdrawPrepareConfig, options?: WithdrawSendOptions): Promise<ReturnType<typeof signature>>;
}>;

/**
 * Creates helpers for native SOL staking operations via the Stake Program.
 * Supports full staking lifecycle: delegate, deactivate, and withdraw.
 *
 * @param runtime - The Solana client runtime with RPC connection.
 * @returns A StakeHelper with methods for staking operations.
 *
 * @example
 * ```ts
 * import { createClient } from '@solana/client';
 *
 * const client = createClient({ cluster: 'mainnet-beta' });
 * const stake = client.helpers.stake;
 *
 * // Delegate 100 SOL to a validator
 * const sig = await stake.sendStake({
 *   amount: 100,
 *   authority: session,
 *   validatorId: 'ValidatorVoteAccount...',
 * });
 *
 * // Check stake accounts
 * const accounts = await stake.getStakeAccounts(myWallet);
 * console.log(`Found ${accounts.length} stake accounts`);
 * ```
 */
export function createStakeHelper(runtime: SolanaClientRuntime): StakeHelper {
	async function prepareStake(config: StakePrepareConfig): Promise<PreparedStake> {
		const commitment = config.commitment;
		const lifetime = await resolveLifetime(runtime, commitment, config.lifetime);
		const { signer, mode } = resolveSigner(config.authority, commitment);
		const validatorAddress = ensureAddress(config.validatorId);
		const amount = toLamportAmount(config.amount);

		// Get rent exemption for stake account
		const rentExempt = await runtime.rpc.getMinimumBalanceForRentExemption(BigInt(STAKE_STATE_LEN)).send();

		const totalLamports = rentExempt + amount;

		// Generate a new stake account
		const stakeAccount = await generateKeyPairSigner();

		// Build instructions
		const createIx = getCreateAccountInstruction({
			payer: signer,
			newAccount: stakeAccount,
			lamports: totalLamports,
			space: BigInt(STAKE_STATE_LEN),
			programAddress: STAKE_PROGRAM_ID,
		});

		const initializeIx = getInitializeInstruction({
			stake: stakeAccount.address,
			arg0: {
				staker: signer.address,
				withdrawer: signer.address,
			},
			arg1: {
				unixTimestamp: 0n,
				epoch: 0n,
				custodian: signer.address,
			},
		});

		const delegateIx = getDelegateStakeInstruction({
			stake: stakeAccount.address,
			vote: validatorAddress,
			stakeHistory: SYSVAR_STAKE_HISTORY,
			unused: UNUSED_STAKE_CONFIG_ACC,
			stakeAuthority: signer,
		});

		const message = pipe(
			createTransactionMessage({ version: config.transactionVersion ?? 0 }),
			(m) => setTransactionMessageFeePayer(signer.address, m),
			(m) => setTransactionMessageLifetimeUsingBlockhash(lifetime, m),
			(m) => appendTransactionMessageInstructions([createIx, initializeIx, delegateIx], m),
		);

		return {
			commitment,
			lifetime,
			message,
			mode,
			signer,
			stakeAccount,
			plan: singleTransactionPlan(message),
		};
	}

	async function sendPreparedStake(
		prepared: PreparedStake,
		options: StakeSendOptions = {},
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
				const signed = await signTransactionMessageWithSigners(message as SignableStakeTransactionMessage, {
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

	async function sendStake(
		config: StakePrepareConfig,
		options?: StakeSendOptions,
	): Promise<ReturnType<typeof signature>> {
		const prepared = await prepareStake(config);
		return await sendPreparedStake(prepared, options);
	}

	async function prepareUnstake(config: UnstakePrepareConfig): Promise<PreparedUnstake> {
		const commitment = config.commitment;
		const lifetime = await resolveLifetime(runtime, commitment, config.lifetime);
		const { signer, mode } = resolveSigner(config.authority, commitment);
		const stakeAccountAddress = ensureAddress(config.stakeAccount);

		const deactivateIx = getDeactivateInstruction({
			stake: stakeAccountAddress,
			clockSysvar: SYSVAR_CLOCK,
			stakeAuthority: signer,
		});

		const message = pipe(
			createTransactionMessage({ version: config.transactionVersion ?? 0 }),
			(m) => setTransactionMessageFeePayer(signer.address, m),
			(m) => setTransactionMessageLifetimeUsingBlockhash(lifetime, m),
			(m) => appendTransactionMessageInstructions([deactivateIx], m),
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

	async function sendPreparedUnstake(
		prepared: PreparedUnstake,
		options: UnstakeSendOptions = {},
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
				const signed = await signTransactionMessageWithSigners(message as SignableStakeTransactionMessage, {
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
		await executor(prepared.plan);
		if (!latestSignature) {
			throw new Error('Failed to resolve transaction signature.');
		}
		return latestSignature;
	}

	async function sendUnstake(
		config: UnstakePrepareConfig,
		options?: UnstakeSendOptions,
	): Promise<ReturnType<typeof signature>> {
		const prepared = await prepareUnstake(config);
		return await sendPreparedUnstake(prepared, options);
	}

	async function prepareWithdraw(config: WithdrawPrepareConfig): Promise<PreparedWithdraw> {
		const commitment = config.commitment;
		const lifetime = await resolveLifetime(runtime, commitment, config.lifetime);
		const { signer, mode } = resolveSigner(config.authority, commitment);
		const stakeAccountAddress = ensureAddress(config.stakeAccount);
		const destinationAddress = ensureAddress(config.destination);
		const amount = toLamportAmount(config.amount);

		const withdrawIx = getWithdrawInstruction({
			stake: stakeAccountAddress,
			recipient: destinationAddress,
			clockSysvar: SYSVAR_CLOCK,
			stakeHistory: SYSVAR_STAKE_HISTORY,
			withdrawAuthority: signer,
			args: amount,
		});

		const message = pipe(
			createTransactionMessage({ version: config.transactionVersion ?? 0 }),
			(m) => setTransactionMessageFeePayer(signer.address, m),
			(m) => setTransactionMessageLifetimeUsingBlockhash(lifetime, m),
			(m) => appendTransactionMessageInstructions([withdrawIx], m),
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

	async function sendPreparedWithdraw(
		prepared: PreparedWithdraw,
		options: WithdrawSendOptions = {},
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
				const signed = await signTransactionMessageWithSigners(message as SignableStakeTransactionMessage, {
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
		await executor(prepared.plan);
		if (!latestSignature) {
			throw new Error('Failed to resolve transaction signature.');
		}
		return latestSignature;
	}

	async function sendWithdraw(
		config: WithdrawPrepareConfig,
		options?: WithdrawSendOptions,
	): Promise<ReturnType<typeof signature>> {
		const prepared = await prepareWithdraw(config);
		return await sendPreparedWithdraw(prepared, options);
	}

	async function getStakeAccounts(wallet: Address | string, validatorId?: Address | string): Promise<StakeAccount[]> {
		const walletAddress = typeof wallet === 'string' ? wallet : String(wallet);

		const accounts = await runtime.rpc
			.getProgramAccounts(STAKE_PROGRAM_ID, {
				encoding: 'jsonParsed',
				filters: [
					{
						memcmp: {
							offset: 44n,
							bytes: walletAddress as Base58EncodedBytes,
							encoding: 'base58',
						},
					},
				],
			})
			.send();

		if (!validatorId) {
			return accounts as StakeAccount[];
		}

		const validatorIdStr = typeof validatorId === 'string' ? validatorId : String(validatorId);
		return accounts.filter((acc) => {
			const data = acc.account?.data;
			if (data && 'parsed' in data) {
				const info = data.parsed?.info as { stake?: { delegation?: { voter?: string } } } | undefined;
				return info?.stake?.delegation?.voter === validatorIdStr;
			}
			return false;
		}) as StakeAccount[];
	}

	return {
		getStakeAccounts,
		prepareStake,
		prepareUnstake,
		prepareWithdraw,
		sendPreparedStake,
		sendPreparedUnstake,
		sendPreparedWithdraw,
		sendStake,
		sendUnstake,
		sendWithdraw,
	};
}
