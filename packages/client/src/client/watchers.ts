import type { Lamports, SolanaRpcSubscriptionsApi } from '@solana/kit';

import { createLogger, formatError } from '../logging/logger';
import type {
	AccountCacheEntry,
	AccountWatcherConfig,
	BalanceWatcherConfig,
	ClientStore,
	ClientWatchers,
	SignatureWatcherConfig,
	SolanaClientRuntime,
	SubscriptionStatus,
} from '../types';
import { now } from '../utils';

type SubscriptionKind = 'account' | 'signature';

type WatcherDeps = Readonly<{
	logger?: ReturnType<typeof createLogger>;
	runtime: SolanaClientRuntime;
	store: ClientStore;
}>;

/**
 * Creates watcher helpers that wrap RPC subscriptions and keep store metadata in sync.
 *
 * @param deps - Dependencies required to construct watcher helpers.
 * @returns Collection of watcher functions.
 */
export function createWatchers({ logger: inputLogger, runtime, store }: WatcherDeps): ClientWatchers {
	const logger = inputLogger ?? createLogger();

	/**
	 * Updates subscription metadata in the store for the provided subscription kind and identifier.
	 *
	 * @param kind - Subscription bucket being updated.
	 * @param id - Identifier for the subscription instance.
	 * @param status - Status descriptor to store.
	 * @returns Nothing; mutates the provided store.
	 */
	function setSubscriptionStatus(kind: SubscriptionKind, id: string, status: SubscriptionStatus): void {
		store.setState((state) => ({
			...state,
			lastUpdatedAt: now(),
			subscriptions: {
				...state.subscriptions,
				[kind]: {
					...state.subscriptions[kind],
					[id]: status,
				},
			},
		}));
	}

	/**
	 * Handles abort events from active subscriptions.
	 *
	 * @param kind - Subscription category that was aborted.
	 * @param id - Identifier for the subscription instance.
	 * @returns Nothing; updates store status.
	 */
	function onAbort(kind: SubscriptionKind, id: string): void {
		setSubscriptionStatus(kind, id, { status: 'inactive' });
	}

	/**
	 * Creates a subscription handle that exposes an abort method.
	 *
	 * @param kind - Subscription category.
	 * @param id - Identifier for the subscription instance.
	 * @param abortController - Controller associated with the subscription.
	 * @returns Handle with an `abort` method.
	 */
	function createSubscriptionHandle(kind: SubscriptionKind, id: string, abortController: AbortController) {
		/**
		 * Cancels the underlying subscription and updates store metadata.
		 *
		 * @returns Nothing; aborts the subscription.
		 */
		function abort(): void {
			abortController.abort();
			onAbort(kind, id);
		}

		return { abort };
	}

	/**
	 * Consumes account notifications and synchronizes store cache with on-chain updates.
	 *
	 * @param config - Watcher configuration specifying the target account.
	 * @param listener - Callback invoked with each account cache entry.
	 * @param abortController - Abort controller tied to the subscription lifecycle.
	 * @returns Promise that resolves when the subscription naturally completes.
	 */
	async function handleAccountNotifications(
		config: AccountWatcherConfig,
		listener: (account: AccountCacheEntry) => void,
		abortController: AbortController,
	): Promise<void> {
		const commitment = config.commitment ?? store.getState().cluster.commitment;
		const plan = runtime.rpcSubscriptions.accountNotifications(config.address, { commitment });
		const key = config.address.toString();
		setSubscriptionStatus('account', key, { status: 'activating' });
		abortController.signal.addEventListener('abort', () => onAbort('account', key));
		try {
			const iterator = await plan.subscribe({ abortSignal: abortController.signal });
			setSubscriptionStatus('account', key, { status: 'active' });
			for await (const notification of iterator) {
				const lamports = notification.value?.lamports ?? null;
				const slot = notification.context?.slot ?? null;
				const entry: AccountCacheEntry = {
					address: config.address,
					data: notification.value?.data,
					error: undefined,
					fetching: false,
					lamports,
					lastFetchedAt: now(),
					slot,
				};
				listener(entry);
				store.setState((state) => ({
					...state,
					accounts: {
						...state.accounts,
						[key]: entry,
					},
					lastUpdatedAt: now(),
				}));
			}
		} catch (error) {
			if (!abortController.signal.aborted) {
				logger({
					data: { address: key, ...formatError(error) },
					level: 'error',
					message: 'account subscription failed',
				});
				setSubscriptionStatus('account', key, { error, status: 'error' });
			}
		}
	}

	/**
	 * Subscribes to account notifications and keeps the store cache in sync.
	 *
	 * @param config - Watcher configuration specifying the target account.
	 * @param listener - Callback invoked with updated account cache entries.
	 * @returns Subscription handle that allows aborting the subscription.
	 */
	function watchAccount(config: AccountWatcherConfig, listener: (account: AccountCacheEntry) => void) {
		const abortController = new AbortController();
		handleAccountNotifications(config, listener, abortController).catch((error) => {
			if (!abortController.signal.aborted) {
				logger({
					data: { address: config.address.toString(), ...formatError(error) },
					level: 'error',
					message: 'account watcher error',
				});
			}
		});
		return createSubscriptionHandle('account', config.address.toString(), abortController);
	}

	/**
	 * Subscribes to balance changes for the provided address.
	 *
	 * @param config - Watcher configuration specifying the target account.
	 * @param listener - Callback invoked with balance updates.
	 * @returns Subscription handle that allows aborting the subscription.
	 */
	function watchBalance(config: BalanceWatcherConfig, listener: (lamports: Lamports) => void) {
		return watchAccount(config, (account) => {
			if (account.lamports !== null) {
				listener(account.lamports);
			}
		});
	}

	/**
	 * Consumes signature notifications and updates transaction metadata.
	 *
	 * @param config - Watcher configuration containing the signature to observe.
	 * @param listener - Callback invoked with each subscription notification payload.
	 * @param abortController - Abort controller tied to the subscription lifecycle.
	 * @returns Promise that resolves when the subscription naturally completes.
	 */
	async function handleSignatureNotifications(
		config: SignatureWatcherConfig,
		listener: (notification: unknown) => void,
		abortController: AbortController,
	): Promise<void> {
		const commitment = config.commitment ?? store.getState().cluster.commitment;
		const plan = runtime.rpcSubscriptions.signatureNotifications(config.signature, {
			commitment,
			enableReceivedNotification: config.enableReceivedNotification,
		} as Parameters<SolanaRpcSubscriptionsApi['signatureNotifications']>[1]);
		const key = config.signature.toString();
		setSubscriptionStatus('signature', key, { status: 'activating' });
		abortController.signal.addEventListener('abort', () => onAbort('signature', key));
		try {
			const iterator = await plan.subscribe({ abortSignal: abortController.signal });
			setSubscriptionStatus('signature', key, { status: 'active' });
			for await (const notification of iterator) {
				listener(notification);
				store.setState((state) => ({
					...state,
					lastUpdatedAt: now(),
					transactions: {
						...state.transactions,
						[key]: {
							lastUpdatedAt: now(),
							signature: config.signature,
							status: 'waiting',
						},
					},
				}));
			}
		} catch (error) {
			if (!abortController.signal.aborted) {
				logger({
					data: { signature: key, ...formatError(error) },
					level: 'error',
					message: 'signature subscription failed',
				});
				setSubscriptionStatus('signature', key, { error, status: 'error' });
			}
		}
	}

	/**
	 * Subscribes to signature status updates for a submitted transaction.
	 *
	 * @param config - Watcher configuration containing the signature to observe.
	 * @param listener - Callback invoked for each notification received.
	 * @returns Subscription handle that allows aborting the subscription.
	 */
	function watchSignature(config: SignatureWatcherConfig, listener: (notification: unknown) => void) {
		const abortController = new AbortController();
		handleSignatureNotifications(config, listener, abortController).catch((error) => {
			if (!abortController.signal.aborted) {
				logger({
					data: { signature: config.signature.toString(), ...formatError(error) },
					level: 'error',
					message: 'signature watcher error',
				});
			}
		});
		return createSubscriptionHandle('signature', config.signature.toString(), abortController);
	}

	return {
		watchAccount,
		watchBalance,
		watchSignature,
	};
}
