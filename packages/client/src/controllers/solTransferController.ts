import type { SolTransferHelper, SolTransferPrepareConfig, SolTransferSendOptions } from '../features/sol';
import { type AsyncState, createAsyncState, createInitialAsyncState } from '../state/asyncState';

type SolTransferSignature = Awaited<ReturnType<SolTransferHelper['sendTransfer']>>;

type Listener = () => void;

export type SolTransferControllerConfig = Readonly<{
	authorityProvider?: () => SolTransferPrepareConfig['authority'] | undefined;
	helper: SolTransferHelper;
}>;

export type SolTransferInput = Omit<SolTransferPrepareConfig, 'authority'> & {
	authority?: SolTransferPrepareConfig['authority'];
};

export type SolTransferController = Readonly<{
	getHelper(): SolTransferHelper;
	getState(): AsyncState<SolTransferSignature>;
	reset(): void;
	send(config: SolTransferInput, options?: SolTransferSendOptions): Promise<SolTransferSignature>;
	subscribe(listener: Listener): () => void;
}>;

function ensureAuthority(
	input: SolTransferInput,
	resolveDefault?: () => SolTransferPrepareConfig['authority'] | undefined,
): SolTransferPrepareConfig {
	const authority = input.authority ?? resolveDefault?.();
	if (!authority) {
		throw new Error('Connect a wallet or supply an `authority` before sending SOL transfers.');
	}
	return {
		...input,
		authority,
	};
}

export function createSolTransferController(config: SolTransferControllerConfig): SolTransferController {
	const listeners = new Set<Listener>();
	const helper = config.helper;
	const authorityProvider = config.authorityProvider;
	let state: AsyncState<SolTransferSignature> = createInitialAsyncState<SolTransferSignature>();

	function notify() {
		for (const listener of listeners) {
			listener();
		}
	}

	function setState(next: AsyncState<SolTransferSignature>) {
		state = next;
		notify();
	}

	async function send(config: SolTransferInput, options?: SolTransferSendOptions): Promise<SolTransferSignature> {
		const request = ensureAuthority(config, authorityProvider);
		setState(createAsyncState<SolTransferSignature>('loading'));
		try {
			const signature = await helper.sendTransfer(request, options);
			setState(createAsyncState<SolTransferSignature>('success', { data: signature }));
			return signature;
		} catch (error) {
			setState(createAsyncState<SolTransferSignature>('error', { error }));
			throw error;
		}
	}

	function subscribe(listener: Listener): () => void {
		listeners.add(listener);
		return () => {
			listeners.delete(listener);
		};
	}

	function reset() {
		setState(createInitialAsyncState<SolTransferSignature>());
	}

	return {
		getHelper: () => helper,
		getState: () => state,
		reset,
		send,
		subscribe,
	};
}
