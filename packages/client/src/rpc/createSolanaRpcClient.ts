import {
	type ClusterUrl,
	type Commitment,
	createSolanaRpc,
	createSolanaRpcSubscriptions,
	getBase64EncodedWireTransaction,
	type SendableTransaction,
	type Signature,
	type Transaction,
} from '@solana/kit';
import type { TransactionWithLastValidBlockHeight } from '@solana/transaction-confirmation';
import {
	createBlockHeightExceedencePromiseFactory,
	createRecentSignatureConfirmationPromiseFactory,
	waitForRecentTransactionConfirmation,
} from '@solana/transaction-confirmation';

type SolanaRpcInstance = ReturnType<typeof createSolanaRpc>;
type SolanaRpcSubscriptionsInstance = ReturnType<typeof createSolanaRpcSubscriptions>;

type ConfirmableTransaction = SendableTransaction & Transaction & TransactionWithLastValidBlockHeight;

type SimulateTransactionPlan = ReturnType<SolanaRpcInstance['simulateTransaction']>;
type SimulateTransactionConfig = Parameters<SolanaRpcInstance['simulateTransaction']>[1];
type SimulateTransactionResult = Awaited<ReturnType<SimulateTransactionPlan['send']>>;

export type SendAndConfirmTransactionOptions = Readonly<{
	abortSignal?: AbortSignal;
	commitment?: Commitment;
	maxRetries?: bigint | number;
	minContextSlot?: bigint | number;
	skipPreflight?: boolean;
}>;

export type SimulateTransactionOptions = Readonly<{
	abortSignal?: AbortSignal;
	commitment?: Commitment;
	config?: SimulateTransactionConfig;
}>;

export type SolanaRpcClient = Readonly<{
	commitment: Commitment;
	endpoint: ClusterUrl;
	rpc: SolanaRpcInstance;
	rpcSubscriptions: SolanaRpcSubscriptionsInstance;
	sendAndConfirmTransaction(
		transaction: ConfirmableTransaction,
		options?: SendAndConfirmTransactionOptions,
	): Promise<Signature>;
	simulateTransaction(
		transaction: SendableTransaction & Transaction,
		options?: SimulateTransactionOptions,
	): Promise<SimulateTransactionResult>;
	websocketEndpoint: ClusterUrl;
}>;

export type CreateSolanaRpcClientConfig = Readonly<{
	commitment?: Commitment;
	endpoint: ClusterUrl;
	rpcConfig?: Parameters<typeof createSolanaRpc>[1];
	rpcSubscriptionsConfig?: Parameters<typeof createSolanaRpcSubscriptions>[1];
	websocketEndpoint?: ClusterUrl;
}>;

function createChainedAbortController(parent?: AbortSignal): AbortController {
	const controller = new AbortController();
	if (!parent) {
		return controller;
	}
	if (parent.aborted) {
		controller.abort(parent.reason);
		return controller;
	}
	const onAbort = () => {
		controller.abort(parent.reason);
		parent.removeEventListener('abort', onAbort);
	};
	parent.addEventListener('abort', onAbort, { once: true });
	return controller;
}

function toBigint(value?: number | bigint): bigint | undefined {
	if (value === undefined) {
		return undefined;
	}
	return typeof value === 'bigint' ? value : BigInt(Math.floor(value));
}

const DEFAULT_SIMULATION_CONFIG = Object.freeze({
	encoding: 'base64' as const,
	replaceRecentBlockhash: true as const,
	sigVerify: false as const,
});

/**
 * Creates a lightweight RPC client that wires up JSON-RPC, subscriptions, and common helpers.
 */
export function createSolanaRpcClient(config: CreateSolanaRpcClientConfig): SolanaRpcClient {
	const endpoint = config.endpoint;
	const websocketEndpoint = config.websocketEndpoint ?? endpoint;
	const commitment = config.commitment ?? 'confirmed';
	const rpc = createSolanaRpc(endpoint, config.rpcConfig);
	const rpcSubscriptions = createSolanaRpcSubscriptions(websocketEndpoint, config.rpcSubscriptionsConfig);

	async function sendAndConfirmTransaction(
		transaction: ConfirmableTransaction,
		options: SendAndConfirmTransactionOptions = {},
	): Promise<Signature> {
		const abortController = createChainedAbortController(options.abortSignal);
		const targetCommitment = options.commitment ?? commitment;
		const wireTransaction = getBase64EncodedWireTransaction(transaction);
		const response = await rpc
			.sendTransaction(wireTransaction, {
				encoding: 'base64',
				maxRetries: toBigint(options.maxRetries),
				minContextSlot: toBigint(options.minContextSlot),
				preflightCommitment: targetCommitment,
				skipPreflight: options.skipPreflight,
			})
			.send({ abortSignal: abortController.signal });

		const getBlockHeightExceedencePromise = createBlockHeightExceedencePromiseFactory({
			rpc: rpc as Parameters<typeof createBlockHeightExceedencePromiseFactory>[0]['rpc'],
			rpcSubscriptions: rpcSubscriptions as Parameters<
				typeof createBlockHeightExceedencePromiseFactory
			>[0]['rpcSubscriptions'],
		});
		const getRecentSignatureConfirmationPromise = createRecentSignatureConfirmationPromiseFactory({
			rpc: rpc as Parameters<typeof createRecentSignatureConfirmationPromiseFactory>[0]['rpc'],
			rpcSubscriptions: rpcSubscriptions as Parameters<
				typeof createRecentSignatureConfirmationPromiseFactory
			>[0]['rpcSubscriptions'],
		});

		await waitForRecentTransactionConfirmation({
			abortSignal: abortController.signal,
			commitment: targetCommitment,
			getBlockHeightExceedencePromise,
			getRecentSignatureConfirmationPromise,
			transaction,
		});

		return response;
	}

	async function simulateTransaction(
		transaction: SendableTransaction & Transaction,
		options: SimulateTransactionOptions = {},
	): Promise<SimulateTransactionResult> {
		const wireTransaction = getBase64EncodedWireTransaction(transaction);
		const baseConfig = (options.config ?? {}) as SimulateTransactionConfig;
		const mergedConfig = {
			...DEFAULT_SIMULATION_CONFIG,
			...baseConfig,
			commitment: baseConfig.commitment ?? options.commitment ?? commitment,
		};
		const normalizedConfig =
			mergedConfig.sigVerify === true && mergedConfig.replaceRecentBlockhash !== false
				? { ...mergedConfig, replaceRecentBlockhash: false }
				: mergedConfig;
		return rpc
			.simulateTransaction(wireTransaction, normalizedConfig as SimulateTransactionConfig)
			.send({ abortSignal: options.abortSignal });
	}

	return {
		commitment,
		endpoint,
		rpc,
		rpcSubscriptions,
		sendAndConfirmTransaction,
		simulateTransaction,
		websocketEndpoint,
	};
}
