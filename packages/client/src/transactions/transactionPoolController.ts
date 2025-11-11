import type {
	TransactionHelper,
	TransactionInstructionInput,
	TransactionPrepareAndSendRequest,
	TransactionPrepared,
	TransactionPrepareRequest,
	TransactionSendOptions,
	TransactionSignOptions,
} from '../features/transactions';
import { type AsyncState, createAsyncState, createInitialAsyncState } from '../state/asyncState';

type Listener = () => void;

export type TransactionInstructionList = readonly TransactionInstructionInput[];

type TransactionSignature = Awaited<ReturnType<TransactionHelper['send']>>;

export type LatestBlockhashCache = Readonly<{
	updatedAt: number;
	value: NonNullable<TransactionPrepareRequest['lifetime']>;
}>;

export type TransactionPoolConfig = Readonly<{
	blockhashMaxAgeMs?: number;
	helper: TransactionHelper;
	initialInstructions?: TransactionInstructionList;
}>;

export type TransactionPoolPrepareOptions = Readonly<
	Partial<Omit<TransactionPrepareRequest, 'instructions'>> & {
		instructions?: TransactionInstructionList;
	}
>;

export type TransactionPoolSignOptions = Readonly<TransactionSignOptions & { prepared?: TransactionPrepared }>;

export type TransactionPoolSendOptions = Readonly<TransactionSendOptions & { prepared?: TransactionPrepared }>;

export type TransactionPoolPrepareAndSendOptions = Readonly<
	Omit<TransactionPrepareAndSendRequest, 'instructions'> & {
		instructions?: TransactionInstructionList;
	}
>;

type Store<T> = Readonly<{
	getSnapshot(): T;
	setSnapshot(next: T): void;
	subscribe(listener: Listener): () => void;
}>;

function createStore<T>(initial: T): Store<T> {
	let snapshot = initial;
	const listeners = new Set<Listener>();
	return {
		getSnapshot: () => snapshot,
		setSnapshot(next: T) {
			snapshot = next;
			for (const listener of listeners) {
				listener();
			}
		},
		subscribe(listener: Listener) {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
	};
}

function freezeInstructions(list: TransactionInstructionList): TransactionInstructionList {
	return Object.freeze([...list]);
}

export type TransactionPoolController = Readonly<{
	addInstruction(instruction: TransactionInstructionInput): void;
	addInstructions(instructionSet: TransactionInstructionList): void;
	clearInstructions(): void;
	getInstructions(): TransactionInstructionList;
	getPrepareState(): AsyncState<TransactionPrepared>;
	getPrepared(): TransactionPrepared | null;
	getSendState(): AsyncState<TransactionSignature>;
	getLatestBlockhashCache(): LatestBlockhashCache | undefined;
	prepare(options?: TransactionPoolPrepareOptions): Promise<TransactionPrepared>;
	prepareAndSend(
		request?: TransactionPoolPrepareAndSendOptions,
		sendOptions?: TransactionSendOptions,
	): Promise<TransactionSignature>;
	removeInstruction(index: number): void;
	replaceInstructions(instructionSet: TransactionInstructionList): void;
	reset(): void;
	send(options?: TransactionPoolSendOptions): Promise<TransactionSignature>;
	setLatestBlockhashCache(cache: LatestBlockhashCache | undefined): void;
	sign(options?: TransactionPoolSignOptions): ReturnType<TransactionHelper['sign']>;
	subscribeInstructions(listener: Listener): () => void;
	subscribePrepareState(listener: Listener): () => void;
	subscribePrepared(listener: Listener): () => void;
	subscribeSendState(listener: Listener): () => void;
	toWire(options?: TransactionPoolSignOptions): ReturnType<TransactionHelper['toWire']>;
	get helper(): TransactionHelper;
}>;

export function createTransactionPoolController(config: TransactionPoolConfig): TransactionPoolController {
	const helper = config.helper;
	const initialInstructions = freezeInstructions(config.initialInstructions ?? []);
	const blockhashMaxAgeMs = config.blockhashMaxAgeMs ?? 30_000;
	let latestBlockhashCache: LatestBlockhashCache | undefined;

	const instructionsStore = createStore<TransactionInstructionList>(initialInstructions);
	const preparedStore = createStore<TransactionPrepared | null>(null);
	const prepareStateStore = createStore<AsyncState<TransactionPrepared>>(
		createInitialAsyncState<TransactionPrepared>(),
	);
	const sendStateStore = createStore<AsyncState<TransactionSignature>>(
		createInitialAsyncState<TransactionSignature>(),
	);

	function resetDerivedState() {
		preparedStore.setSnapshot(null);
		prepareStateStore.setSnapshot(createInitialAsyncState<TransactionPrepared>());
		sendStateStore.setSnapshot(createInitialAsyncState<TransactionSignature>());
	}

	function commitInstructions(next: TransactionInstructionList) {
		instructionsStore.setSnapshot(freezeInstructions(next));
		resetDerivedState();
	}

	function addInstruction(instruction: TransactionInstructionInput) {
		const next = [...instructionsStore.getSnapshot(), instruction];
		commitInstructions(next);
	}

	function addInstructions(instructionSet: TransactionInstructionList) {
		if (!instructionSet.length) {
			return;
		}
		const next = [...instructionsStore.getSnapshot(), ...instructionSet];
		commitInstructions(next);
	}

	function replaceInstructions(instructionSet: TransactionInstructionList) {
		commitInstructions(instructionSet);
	}

	function clearInstructions() {
		commitInstructions([]);
	}

	function removeInstruction(index: number) {
		const current = instructionsStore.getSnapshot();
		if (index < 0 || index >= current.length) {
			return;
		}
		const next = current.filter((_, ii) => ii !== index);
		commitInstructions(next);
	}

	function reset() {
		commitInstructions(initialInstructions);
	}

	function ensureInstructions(
		instructionList: TransactionInstructionList,
	): asserts instructionList is TransactionInstructionList & { length: number } {
		if (!instructionList.length) {
			throw new Error('Add at least one instruction before preparing a transaction.');
		}
	}

	function resolveCachedLifetime(): TransactionPoolPrepareOptions['lifetime'] | undefined {
		if (!latestBlockhashCache) {
			return undefined;
		}
		if (Date.now() - latestBlockhashCache.updatedAt > blockhashMaxAgeMs) {
			return undefined;
		}
		return latestBlockhashCache.value;
	}

	async function prepare(options: TransactionPoolPrepareOptions = {}): Promise<TransactionPrepared> {
		const { instructions: overrideInstructions, ...rest } = options;
		const nextInstructions = overrideInstructions ?? instructionsStore.getSnapshot();
		ensureInstructions(nextInstructions);
		prepareStateStore.setSnapshot(createAsyncState<TransactionPrepared>('loading'));
		try {
			const cachedLifetime = rest.lifetime ?? resolveCachedLifetime();
			const restWithLifetime = cachedLifetime && !rest.lifetime ? { ...rest, lifetime: cachedLifetime } : rest;
			const prepared = await helper.prepare({
				...(restWithLifetime as Omit<TransactionPrepareRequest, 'instructions'>),
				instructions: nextInstructions,
			});
			preparedStore.setSnapshot(prepared);
			prepareStateStore.setSnapshot(createAsyncState<TransactionPrepared>('success', { data: prepared }));
			return prepared;
		} catch (error) {
			prepareStateStore.setSnapshot(createAsyncState<TransactionPrepared>('error', { error }));
			throw error;
		}
	}

	function resolvePrepared(override?: TransactionPrepared | null): TransactionPrepared {
		const target = override ?? preparedStore.getSnapshot();
		if (!target) {
			throw new Error('Prepare a transaction before sending.');
		}
		return target;
	}

	function resolveLifetimeOptions<T extends { lifetime?: TransactionPoolPrepareOptions['lifetime'] }>(options: T): T {
		if (options.lifetime) {
			return options;
		}
		const cachedLifetime = resolveCachedLifetime();
		if (!cachedLifetime) {
			return options;
		}
		return { ...options, lifetime: cachedLifetime };
	}

	async function send(options: TransactionPoolSendOptions = {}): Promise<TransactionSignature> {
		const { prepared: overridePrepared, ...rest } = options;
		const target = resolvePrepared(overridePrepared);
		sendStateStore.setSnapshot(createAsyncState<TransactionSignature>('loading'));
		try {
			const signature = await helper.send(target, rest);
			sendStateStore.setSnapshot(createAsyncState<TransactionSignature>('success', { data: signature }));
			return signature;
		} catch (error) {
			sendStateStore.setSnapshot(createAsyncState<TransactionSignature>('error', { error }));
			throw error;
		}
	}

	async function prepareAndSend(
		request: TransactionPoolPrepareAndSendOptions = {},
		sendOptions?: TransactionSendOptions,
	): Promise<TransactionSignature> {
		const { instructions: overrideInstructions, ...rest } = request;
		const nextInstructions = overrideInstructions ?? instructionsStore.getSnapshot();
		ensureInstructions(nextInstructions);
		sendStateStore.setSnapshot(createAsyncState<TransactionSignature>('loading'));
		try {
			const restWithLifetime = resolveLifetimeOptions(rest);
			const signature = await helper.prepareAndSend(
				{
					...(restWithLifetime as Omit<TransactionPrepareAndSendRequest, 'instructions'>),
					instructions: nextInstructions,
				},
				sendOptions,
			);
			sendStateStore.setSnapshot(createAsyncState<TransactionSignature>('success', { data: signature }));
			return signature;
		} catch (error) {
			sendStateStore.setSnapshot(createAsyncState<TransactionSignature>('error', { error }));
			throw error;
		}
	}

	function sign(options: TransactionPoolSignOptions = {}) {
		const { prepared: overridePrepared, ...rest } = options;
		const target = resolvePrepared(overridePrepared);
		return helper.sign(target, rest);
	}

	function toWire(options: TransactionPoolSignOptions = {}) {
		const { prepared: overridePrepared, ...rest } = options;
		const target = resolvePrepared(overridePrepared);
		return helper.toWire(target, rest);
	}

	function subscribeInstructions(listener: Listener) {
		return instructionsStore.subscribe(listener);
	}

	function subscribePrepared(listener: Listener) {
		return preparedStore.subscribe(listener);
	}

	function subscribePrepareState(listener: Listener) {
		return prepareStateStore.subscribe(listener);
	}

	function subscribeSendState(listener: Listener) {
		return sendStateStore.subscribe(listener);
	}

	function setLatestBlockhashCache(cache: LatestBlockhashCache | undefined) {
		latestBlockhashCache = cache;
	}

	return {
		addInstruction,
		addInstructions,
		clearInstructions,
		get helper() {
			return helper;
		},
		getInstructions: instructionsStore.getSnapshot,
		getPrepareState: prepareStateStore.getSnapshot,
		getPrepared: preparedStore.getSnapshot,
		getSendState: sendStateStore.getSnapshot,
		getLatestBlockhashCache: () => latestBlockhashCache,
		prepare,
		prepareAndSend,
		removeInstruction,
		replaceInstructions,
		reset,
		send,
		setLatestBlockhashCache,
		sign,
		subscribeInstructions,
		subscribePrepareState,
		subscribePrepared,
		subscribeSendState,
		toWire,
	};
}
