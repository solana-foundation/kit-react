import { getBase58Decoder } from '@solana/codecs-strings';
import type {
	Address,
	appendTransactionMessageInstruction,
	Blockhash,
	Commitment,
	InstructionPlan,
	SingleTransactionPlan,
	Slot,
	TransactionPlan,
	TransactionPlannerConfig,
	TransactionSigner,
	TransactionVersion,
} from '@solana/kit';
import {
	createTransactionMessage,
	createTransactionPlanExecutor,
	createTransactionPlanner,
	getBase64EncodedWireTransaction,
	getMessagePackerInstructionPlanFromInstructions,
	getSignatureFromTransaction,
	isInstructionForProgram,
	isInstructionWithData,
	isTransactionSendingSigner,
	address as parseAddress,
	pipe,
	setTransactionMessageFeePayer,
	setTransactionMessageFeePayerSigner,
	setTransactionMessageLifetimeUsingBlockhash,
	signAndSendTransactionMessageWithSigners,
	signature,
	signTransactionMessageWithSigners,
	singleTransactionPlan,
} from '@solana/kit';
import {
	COMPUTE_BUDGET_PROGRAM_ADDRESS,
	ComputeBudgetInstruction,
	getSetComputeUnitLimitInstruction,
	getSetComputeUnitPriceInstruction,
} from '@solana-program/compute-budget';
import type { SolanaClientRuntime } from '../rpc/types';
import { createWalletTransactionSigner, isWalletSession, resolveSignerMode } from '../signers/walletTransactionSigner';
import {
	type PrepareTransactionMessage,
	type PrepareTransactionOptions,
	prepareTransaction as prepareTransactionUtility,
} from '../transactions/prepareTransaction';
import type { WalletSession } from '../wallet/types';

type BlockhashLifetime = Readonly<{
	blockhash: Blockhash;
	lastValidBlockHeight: bigint;
}>;

type TransactionInstruction = Parameters<typeof appendTransactionMessageInstruction>[0];

/**
 * Transaction versions these helpers support. Kit v7 introduced version `1`, which requires the
 * dedicated v1 transaction config and is not handled here, so it is excluded.
 */
export type SupportedTransactionVersion = Exclude<TransactionVersion, 1>;

export type TransactionInstructionInput = TransactionInstruction;

type SignableTransactionMessage = Parameters<typeof signTransactionMessageWithSigners>[0];

type TransactionAuthority = TransactionSigner | WalletSession;

type PrepareTransactionOverrides = Omit<PrepareTransactionOptions<PrepareTransactionMessage>, 'transaction'>;

type TransactionRecipeMetadata = Readonly<{
	commitment: Commitment;
	computeUnitLimit?: bigint;
	computeUnitPrice?: bigint;
	feePayer: Address;
	instructions: readonly TransactionInstruction[];
	lifetime: BlockhashLifetime;
	mode: 'partial' | 'send';
	version: SupportedTransactionVersion;
}>;

export type TransactionRecipe = TransactionRecipeMetadata &
	Readonly<{
		createTransactionMessage: TransactionPlannerConfig['createTransactionMessage'];
		instructionPlan: InstructionPlan;
	}>;

export type TransactionRecipeContext = Readonly<{
	getFallbackCommitment(): Commitment;
	runtime: SolanaClientRuntime;
}>;

export type TransactionPrepareRequest = Readonly<{
	abortSignal?: AbortSignal;
	authority?: TransactionAuthority;
	commitment?: Commitment;
	computeUnitLimit?: bigint | number;
	computeUnitPrice?: bigint | number;
	feePayer?: Address | string | TransactionSigner;
	instructions: readonly TransactionInstruction[];
	lifetime?: BlockhashLifetime;
	version?: SupportedTransactionVersion | 'auto';
}>;

export type TransactionPrepareAndSendRequest = TransactionPrepareRequest &
	Readonly<{
		prepareTransaction?: false | PrepareTransactionOverrides;
	}>;

export type TransactionPrepared = Readonly<{
	commitment: Commitment;
	computeUnitLimit?: bigint;
	computeUnitPrice?: bigint;
	feePayer: Address;
	instructions: readonly TransactionInstruction[];
	lifetime: BlockhashLifetime;
	message: SignableTransactionMessage;
	mode: 'partial' | 'send';
	plan?: TransactionPlan;
	version: SupportedTransactionVersion;
}>;

export type TransactionSignOptions = Readonly<{
	abortSignal?: AbortSignal;
	minContextSlot?: Slot;
}>;

export type TransactionSendOptions = Readonly<{
	abortSignal?: AbortSignal;
	commitment?: Commitment;
	maxRetries?: bigint | number;
	minContextSlot?: Slot;
	skipPreflight?: boolean;
}>;

export type TransactionHelper = Readonly<{
	prepare(request: TransactionPrepareRequest): Promise<TransactionPrepared>;
	sign(
		prepared: TransactionPrepared,
		options?: TransactionSignOptions,
	): ReturnType<typeof signTransactionMessageWithSigners>;
	toWire(prepared: TransactionPrepared, options?: TransactionSignOptions): Promise<string>;
	send(prepared: TransactionPrepared, options?: TransactionSendOptions): Promise<ReturnType<typeof signature>>;
	prepareAndSend(
		request: TransactionPrepareAndSendRequest,
		options?: TransactionSendOptions,
	): Promise<ReturnType<typeof signature>>;
}>;

function toAddress(value: Address | string): Address {
	return typeof value === 'string' ? parseAddress(value) : value;
}

function hasSetComputeUnitLimitInstruction(instructions: readonly TransactionInstruction[]): boolean {
	return instructions.some(
		(instruction) =>
			isInstructionForProgram(instruction, COMPUTE_BUDGET_PROGRAM_ADDRESS) &&
			isInstructionWithData(instruction) &&
			instruction.data[0] === ComputeBudgetInstruction.SetComputeUnitLimit,
	);
}

function hasSetComputeUnitPriceInstruction(instructions: readonly TransactionInstruction[]): boolean {
	return instructions.some(
		(instruction) =>
			isInstructionForProgram(instruction, COMPUTE_BUDGET_PROGRAM_ADDRESS) &&
			isInstructionWithData(instruction) &&
			instruction.data[0] === ComputeBudgetInstruction.SetComputeUnitPrice,
	);
}

function instructionUsesAddressLookup(instruction: TransactionInstruction): boolean {
	if ('addressTableLookup' in instruction && instruction.addressTableLookup != null) {
		return true;
	}
	if (
		'addressTableLookups' in instruction &&
		Array.isArray(instruction.addressTableLookups) &&
		instruction.addressTableLookups.length > 0
	) {
		return true;
	}
	return false;
}

function resolveVersion(
	requested: SupportedTransactionVersion | 'auto' | undefined,
	instructions: readonly TransactionInstruction[],
): SupportedTransactionVersion {
	if (requested && requested !== 'auto') {
		return requested;
	}
	return instructions.some(instructionUsesAddressLookup) ? 0 : 'legacy';
}

function normaliseCommitment(request: TransactionPrepareRequest, getFallbackCommitment: () => Commitment): Commitment {
	return request.commitment ?? getFallbackCommitment();
}

function resolveFeePayerAddress(
	feePayer: Address | string | TransactionSigner | undefined,
	authoritySigner: TransactionSigner | undefined,
): { address: Address; signer?: TransactionSigner } {
	if (!feePayer && !authoritySigner) {
		throw new Error('A fee payer must be provided via `feePayer` or `authority`.');
	}
	if (feePayer && typeof feePayer === 'object' && 'address' in feePayer) {
		return { address: feePayer.address as Address, signer: feePayer };
	}
	if (feePayer) {
		const address = toAddress(feePayer);
		if (authoritySigner && authoritySigner.address === address) {
			return { address, signer: authoritySigner };
		}
		return { address };
	}
	if (!authoritySigner) {
		throw new Error('Unable to resolve authority signer for the fee payer.');
	}
	const authorityAddress = authoritySigner.address as Address;
	return { address: authorityAddress, signer: authoritySigner };
}

function resolveComputeUnitLimit(
	request: TransactionPrepareRequest,
	instructions: readonly TransactionInstruction[],
): bigint | undefined {
	const value = request.computeUnitLimit;
	if (value === undefined || hasSetComputeUnitLimitInstruction(instructions)) {
		return undefined;
	}
	return typeof value === 'bigint' ? value : BigInt(Math.floor(value));
}

function resolveComputeUnitPrice(
	request: TransactionPrepareRequest,
	instructions: readonly TransactionInstruction[],
): bigint | undefined {
	if (request.computeUnitPrice === undefined || hasSetComputeUnitPriceInstruction(instructions)) {
		return undefined;
	}
	if (typeof request.computeUnitPrice === 'bigint') {
		return request.computeUnitPrice;
	}
	return BigInt(Math.floor(request.computeUnitPrice));
}

export async function createTransactionRecipe(
	request: TransactionPrepareRequest,
	context: TransactionRecipeContext,
): Promise<TransactionRecipe> {
	if (!request.instructions.length) {
		throw new Error('Add at least one instruction before preparing a transaction.');
	}

	const { getFallbackCommitment, runtime } = context;
	request.abortSignal?.throwIfAborted();

	const commitment = normaliseCommitment(request, getFallbackCommitment);

	let authoritySigner: TransactionSigner | undefined;
	let mode: 'partial' | 'send' = 'partial';
	if (request.authority) {
		if (isWalletSession(request.authority)) {
			const { signer, mode: walletMode } = createWalletTransactionSigner(request.authority, { commitment });
			authoritySigner = signer;
			mode = walletMode;
		} else {
			authoritySigner = request.authority;
			mode = resolveSignerMode(authoritySigner);
		}
	}

	const { address: feePayer, signer: feePayerSigner } = resolveFeePayerAddress(request.feePayer, authoritySigner);

	if (mode === 'send') {
		if (!feePayerSigner || !isTransactionSendingSigner(feePayerSigner)) {
			mode = 'partial';
		}
	}

	const baseInstructions = [...request.instructions];
	const version = resolveVersion(request.version, baseInstructions);

	const lifetime =
		request.lifetime ??
		(await runtime.rpc.getLatestBlockhash({ commitment }).send({ abortSignal: request.abortSignal })).value;

	request.abortSignal?.throwIfAborted();

	const resolvedComputeUnitLimit = resolveComputeUnitLimit(request, baseInstructions);
	const computeUnitPrice = resolveComputeUnitPrice(request, baseInstructions);

	const prefixInstructions: TransactionInstruction[] = [];
	if (resolvedComputeUnitLimit !== undefined) {
		prefixInstructions.push(getSetComputeUnitLimitInstruction({ units: Number(resolvedComputeUnitLimit) }));
	}
	if (computeUnitPrice !== undefined) {
		prefixInstructions.push(getSetComputeUnitPriceInstruction({ microLamports: Number(computeUnitPrice) }));
	}
	const instructionSequence = [...prefixInstructions, ...baseInstructions];

	const createMessage: TransactionPlannerConfig['createTransactionMessage'] = async () =>
		pipe(
			createTransactionMessage({ version }),
			(message) =>
				feePayerSigner
					? setTransactionMessageFeePayerSigner(feePayerSigner, message)
					: setTransactionMessageFeePayer(feePayer, message),
			(message) => setTransactionMessageLifetimeUsingBlockhash(lifetime, message),
		) as SignableTransactionMessage;

	return Object.freeze({
		commitment,
		computeUnitLimit: resolvedComputeUnitLimit,
		computeUnitPrice,
		createTransactionMessage: createMessage,
		feePayer,
		instructionPlan: getMessagePackerInstructionPlanFromInstructions(instructionSequence),
		instructions: Object.freeze(baseInstructions),
		lifetime,
		mode,
		version,
	});
}

function assertSingleTransactionPlan(
	plan: TransactionPlan,
): SingleTransactionPlan<SignableTransactionMessage> & { message: SignableTransactionMessage } {
	if (plan.kind !== 'single') {
		throw new Error('Transaction recipe produced a multi-transaction plan which is not supported.');
	}
	return plan as SingleTransactionPlan<SignableTransactionMessage> & { message: SignableTransactionMessage };
}

export function createTransactionHelper(
	runtime: SolanaClientRuntime,
	getFallbackCommitment: () => Commitment,
): TransactionHelper {
	async function prepare(request: TransactionPrepareRequest): Promise<TransactionPrepared> {
		const recipe = await createTransactionRecipe(request, { getFallbackCommitment, runtime });
		const planner = createTransactionPlanner({
			createTransactionMessage: recipe.createTransactionMessage,
		});
		const plan = await planner(recipe.instructionPlan, { abortSignal: request.abortSignal });
		const singlePlan = assertSingleTransactionPlan(plan);

		const prepared: TransactionPrepared = Object.freeze({
			commitment: recipe.commitment,
			computeUnitLimit: recipe.computeUnitLimit,
			computeUnitPrice: recipe.computeUnitPrice,
			feePayer: recipe.feePayer,
			instructions: recipe.instructions,
			lifetime: recipe.lifetime,
			message: singlePlan.message,
			mode: recipe.mode,
			plan,
			version: recipe.version,
		});
		return prepared;
	}

	async function sign(
		prepared: TransactionPrepared,
		options: TransactionSignOptions = {},
	): ReturnType<typeof signTransactionMessageWithSigners> {
		return await signTransactionMessageWithSigners(prepared.message, {
			abortSignal: options.abortSignal,
			minContextSlot: options.minContextSlot,
		});
	}

	async function toWire(prepared: TransactionPrepared, options: TransactionSignOptions = {}) {
		const signed = await sign(prepared, options);
		return getBase64EncodedWireTransaction(signed);
	}

	async function send(
		prepared: TransactionPrepared,
		options: TransactionSendOptions = {},
	): Promise<ReturnType<typeof signature>> {
		if (!prepared.plan || prepared.mode === 'send') {
			return sendDirect(prepared, options);
		}
		return sendWithExecutor(prepared, options);
	}

	async function sendDirect(
		prepared: TransactionPrepared,
		options: TransactionSendOptions,
	): Promise<ReturnType<typeof signature>> {
		const commitment = options.commitment ?? prepared.commitment;
		if (prepared.mode === 'send') {
			const signatureBytes = await signAndSendTransactionMessageWithSigners(prepared.message, {
				abortSignal: options.abortSignal,
				minContextSlot: options.minContextSlot,
			});
			const base58Decoder = getBase58Decoder();
			return signature(base58Decoder.decode(signatureBytes));
		}

		const signed = await sign(prepared, {
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
				preflightCommitment: commitment,
				skipPreflight: options.skipPreflight,
			})
			.send({ abortSignal: options.abortSignal });

		return signature(response);
	}

	async function sendWithExecutor(
		prepared: TransactionPrepared,
		options: TransactionSendOptions,
	): Promise<ReturnType<typeof signature>> {
		if (!prepared.plan) {
			return sendDirect(prepared, options);
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
				const signed = await signTransactionMessageWithSigners(message as SignableTransactionMessage, {
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
		await executor(prepared.plan, { abortSignal: options.abortSignal });
		if (!latestSignature) {
			throw new Error('Failed to resolve transaction signature.');
		}
		return latestSignature;
	}

	async function prepareAndSend(
		request: TransactionPrepareAndSendRequest,
		options: TransactionSendOptions = {},
	): Promise<ReturnType<typeof signature>> {
		const { prepareTransaction: overrides, ...rest } = request;
		const prepared = await prepare(rest);
		if (overrides === false) {
			return send(prepared, options);
		}
		const prepareConfig = overrides ?? {};
		const tunedMessage = (await prepareTransactionUtility({
			blockhashReset: prepareConfig.blockhashReset ?? false,
			...prepareConfig,
			rpc: runtime.rpc as Parameters<typeof prepareTransactionUtility>[0]['rpc'],
			transaction: prepared.message as unknown as PrepareTransactionMessage,
		})) as SignableTransactionMessage;
		const tunedPrepared: TransactionPrepared = Object.freeze({
			...prepared,
			message: tunedMessage,
			plan: singleTransactionPlan(tunedMessage),
		});
		return send(tunedPrepared, options);
	}

	return Object.freeze({
		prepare,
		sign,
		toWire,
		send,
		prepareAndSend,
	});
}
