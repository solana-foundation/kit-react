import type { Commitment } from '@solana/kit';

import { createSolTransferHelper, type SolTransferHelper } from '../features/sol';
import { createSplTokenHelper, type SplTokenHelper, type SplTokenHelperConfig } from '../features/spl';
import { createTransactionHelper, type TransactionHelper } from '../features/transactions';
import {
	type PrepareTransactionMessage,
	type PrepareTransactionOptions,
	prepareTransaction as prepareTransactionUtility,
} from '../transactions/prepareTransaction';
import type { ClientHelpers, ClientStore, SolanaClientRuntime } from '../types';

type SplTokenCacheEntry = Readonly<{
	baseCommitment?: Commitment;
	scoped: SplTokenHelper;
}>;

function withDefaultCommitment<T extends { commitment?: Commitment }>(
	config: T,
	getFallback: () => Commitment,
	baseCommitment?: Commitment,
): T {
	if (config.commitment !== undefined) {
		return config;
	}
	const commitment = baseCommitment ?? getFallback();
	return {
		...config,
		commitment,
	};
}

function wrapSolTransferHelper(helper: SolTransferHelper, getFallback: () => Commitment): SolTransferHelper {
	return {
		prepareTransfer: (config) => helper.prepareTransfer(withDefaultCommitment(config, getFallback)),
		sendPreparedTransfer: helper.sendPreparedTransfer,
		sendTransfer: (config, options) => helper.sendTransfer(withDefaultCommitment(config, getFallback), options),
	};
}

function wrapSplTokenHelper(
	helper: SplTokenHelper,
	getFallback: () => Commitment,
	baseCommitment?: Commitment,
): SplTokenHelper {
	const resolveCommitment = (commitment?: Commitment) => commitment ?? baseCommitment ?? getFallback();

	return {
		deriveAssociatedTokenAddress: helper.deriveAssociatedTokenAddress,
		fetchBalance: (owner, commitment) => helper.fetchBalance(owner, resolveCommitment(commitment)),
		prepareTransfer: (config) => helper.prepareTransfer(withDefaultCommitment(config, getFallback, baseCommitment)),
		sendPreparedTransfer: helper.sendPreparedTransfer,
		sendTransfer: (config, options) =>
			helper.sendTransfer(withDefaultCommitment(config, getFallback, baseCommitment), options),
	};
}

function normaliseConfigValue(value: unknown): string | undefined {
	if (value === null || value === undefined) {
		return undefined;
	}
	if (typeof value === 'string') {
		return value;
	}
	if (typeof value === 'object' && 'toString' in value) {
		return String((value as { toString(): unknown }).toString());
	}
	return JSON.stringify(value);
}

function serialiseSplConfig(config: SplTokenHelperConfig): string {
	return JSON.stringify({
		associatedTokenProgram: normaliseConfigValue(config.associatedTokenProgram),
		commitment: normaliseConfigValue(config.commitment),
		decimals: config.decimals,
		mint: normaliseConfigValue(config.mint),
		tokenProgram: normaliseConfigValue(config.tokenProgram),
	});
}

export function createClientHelpers(runtime: SolanaClientRuntime, store: ClientStore): ClientHelpers {
	const getFallbackCommitment = () => store.getState().cluster.commitment;
	const splTokenCache = new Map<string, SplTokenCacheEntry>();
	let solTransfer: SolTransferHelper | undefined;
	let transaction: TransactionHelper | undefined;

	const getSolTransfer = () => {
		if (!solTransfer) {
			solTransfer = wrapSolTransferHelper(createSolTransferHelper(runtime), getFallbackCommitment);
		}
		return solTransfer;
	};

	const getTransaction = () => {
		if (!transaction) {
			transaction = createTransactionHelper(runtime, getFallbackCommitment);
		}
		return transaction;
	};

	function getSplTokenHelper(config: SplTokenHelperConfig): SplTokenHelper {
		const cacheKey = serialiseSplConfig(config);
		const cached = splTokenCache.get(cacheKey);
		if (cached) {
			return cached.scoped;
		}
		const helper = createSplTokenHelper(runtime, config);
		const scoped = wrapSplTokenHelper(helper, getFallbackCommitment, config.commitment);
		splTokenCache.set(cacheKey, {
			baseCommitment: config.commitment,
			scoped,
		});
		return scoped;
	}

	const prepareTransactionWithRuntime = <TMessage extends PrepareTransactionMessage>(
		options: PrepareTransactionOptions<TMessage>,
	) =>
		prepareTransactionUtility({
			...options,
			rpc: runtime.rpc as Parameters<typeof prepareTransactionUtility>[0]['rpc'],
		});

	return Object.freeze({
		get solTransfer() {
			return getSolTransfer();
		},
		splToken: getSplTokenHelper,
		get transaction() {
			return getTransaction();
		},
		prepareTransaction: prepareTransactionWithRuntime,
	});
}
