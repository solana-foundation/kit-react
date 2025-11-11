import { getBase58Decoder } from '@solana/codecs-strings';
import type { Commitment, SendableTransaction, Signature, Transaction } from '@solana/kit';
import { address } from '@solana/kit';
import { getTransactionDecoder, getTransactionEncoder } from '@solana/transactions';
import type {
	SolanaSignAndSendTransactionFeature,
	SolanaSignMessageFeature,
	SolanaSignTransactionFeature,
} from '@solana/wallet-standard-features';
import {
	SolanaSignAndSendTransaction,
	SolanaSignMessage,
	SolanaSignTransaction,
} from '@solana/wallet-standard-features';
import { getWallets } from '@wallet-standard/app';
import type { IdentifierString, Wallet, WalletAccount as WalletStandardAccount } from '@wallet-standard/base';
import type { StandardConnectFeature, StandardDisconnectFeature } from '@wallet-standard/features';
import { StandardConnect, StandardDisconnect } from '@wallet-standard/features';

import type { WalletAccount, WalletConnector, WalletConnectorMetadata, WalletSession } from '../types';

export type WalletStandardConnectorMetadata = Readonly<{
	canAutoConnect?: boolean;
	defaultChain?: IdentifierString;
	icon?: string;
	id?: string;
	name?: string;
}>;

type CommitmentLike = 'confirmed' | 'finalized' | 'processed';

const base58Decoder = getBase58Decoder();
const transactionDecoder = getTransactionDecoder();
const transactionEncoder = getTransactionEncoder();

/**
 * Derives a connector identifier from a wallet instance.
 *
 * @param wallet - Wallet whose name will be transformed into an identifier.
 * @returns Kebab-case identifier string derived from the wallet name.
 */
function deriveConnectorId(wallet: Wallet): string {
	return wallet.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
}

/**
 * Returns the primary account exposed by a wallet.
 *
 * @param accounts - List of wallet accounts provided by the wallet standard API.
 * @returns The first account in the list.
 * @throws When the wallet did not provide any accounts.
 */
function getPrimaryAccount(accounts: readonly WalletStandardAccount[]): WalletStandardAccount {
	const primary = accounts[0];
	if (!primary) {
		throw new Error('Wallet returned no accounts.');
	}
	return primary;
}

/**
 * Maps an arbitrary commitment value to the limited subset supported by Wallet Standard.
 *
 * @param commitment - Commitment requested by the caller.
 * @returns A valid Wallet Standard commitment or `undefined` when unsupported.
 */
function mapCommitment(commitment: unknown): CommitmentLike | undefined {
	if (commitment === 'processed' || commitment === 'confirmed' || commitment === 'finalized') {
		return commitment;
	}
	return undefined;
}

/**
 * Converts a Wallet Standard account into the @solana/client {@link WalletAccount} shape.
 *
 * @param walletAccount - Account provided by the wallet standard.
 * @returns Wallet account compatible with the client helpers.
 */
function toSessionAccount(walletAccount: WalletStandardAccount): WalletAccount {
	return {
		address: address(walletAccount.address),
		label: walletAccount.label,
		publicKey: new Uint8Array(walletAccount.publicKey),
	};
}

/**
 * Selects the preferred chain, if any, from a wallet account.
 *
 * @param account - Wallet Standard account to inspect.
 * @returns Preferred chain identifier or `undefined` when not specified.
 */
function getChain(account: WalletStandardAccount): IdentifierString | undefined {
	const [preferred] = account.chains ?? [];
	return preferred;
}

/**
 * Disconnects the provided wallet when supported by the feature set.
 *
 * @param wallet - Wallet instance implementing the optional disconnect feature.
 */
async function disconnectWallet(wallet: Wallet): Promise<void> {
	const disconnectFeature = wallet.features[StandardDisconnect] as
		| StandardDisconnectFeature[typeof StandardDisconnect]
		| undefined;
	if (disconnectFeature) {
		await disconnectFeature.disconnect();
	}
}

/**
 * Builds a connector function that adheres to the wallet standard API.
 *
 * @param wallet - Wallet instance compatible with Wallet Standard.
 * @param options - Optional overrides for connector metadata.
 * @returns A {@link WalletConnector} wrapping the provided wallet.
 */
export function createWalletStandardConnector(
	wallet: Wallet,
	options: WalletStandardConnectorMetadata = {},
): WalletConnector {
	const metadata: WalletConnectorMetadata = {
		canAutoConnect: options.canAutoConnect ?? Boolean(wallet.features[StandardConnect]),
		icon: options.icon ?? wallet.icon,
		id: options.id ?? deriveConnectorId(wallet),
		name: options.name ?? wallet.name,
	};

	/**
	 * Establishes a session with the wallet, optionally attempting a silent connection.
	 *
	 * @param connectionOptions - Optional connection configuration.
	 * @returns A wallet session that exposes signing helpers.
	 */
	async function connect(connectionOptions: Readonly<{ autoConnect?: boolean }> = {}): Promise<WalletSession> {
		const connectFeature = wallet.features[StandardConnect] as
			| StandardConnectFeature[typeof StandardConnect]
			| undefined;
		const shouldConnectSilently = Boolean(connectionOptions.autoConnect);
		let walletAccounts = wallet.accounts;
		if (connectFeature) {
			const { accounts } = await connectFeature.connect({
				silent: shouldConnectSilently || undefined,
			});
			if (accounts.length) {
				walletAccounts = accounts;
			}
		}

		const primaryAccount = getPrimaryAccount(walletAccounts);
		const sessionAccount = toSessionAccount(primaryAccount);

		const signMessageFeature = wallet.features[SolanaSignMessage] as
			| SolanaSignMessageFeature[typeof SolanaSignMessage]
			| undefined;
		const signTransactionFeature = wallet.features[SolanaSignTransaction] as
			| SolanaSignTransactionFeature[typeof SolanaSignTransaction]
			| undefined;
		const signAndSendFeature = wallet.features[SolanaSignAndSendTransaction] as
			| SolanaSignAndSendTransactionFeature[typeof SolanaSignAndSendTransaction]
			| undefined;

		const resolvedChain = options.defaultChain ?? getChain(primaryAccount);

		/**
		 * Signs messages using the wallet standard feature when available.
		 *
		 * @param message - Message payload to sign.
		 * @returns Promise resolving with the signature.
		 */
		const signMessage = signMessageFeature
			? async (message: Uint8Array) => {
					const [output] = await signMessageFeature.signMessage({
						account: primaryAccount,
						message,
					});
					return output.signature;
				}
			: undefined;

		/**
		 * Signs transactions using the wallet standard feature when available.
		 *
		 * @param transaction - Transaction to sign.
		 * @returns Promise resolving with the signed transaction.
		 */
		const signTransaction = signTransactionFeature
			? async (transaction: SendableTransaction & Transaction) => {
					const wireBytes = new Uint8Array(transactionEncoder.encode(transaction));
					const request = resolvedChain
						? {
								account: primaryAccount,
								chain: resolvedChain,
								transaction: wireBytes,
							}
						: {
								account: primaryAccount,
								transaction: wireBytes,
							};
					const [output] = await signTransactionFeature.signTransaction(request);
					return transactionDecoder.decode(output.signedTransaction) as SendableTransaction & Transaction;
				}
			: undefined;

		/**
		 * Signs and sends transactions using the wallet standard feature when available.
		 *
		 * @param transaction - Transaction to sign and submit.
		 * @param config - Optional commitment override for the submission.
		 * @returns Promise resolving with the submitted signature.
		 */
		const sendTransaction = signAndSendFeature
			? async (
					transaction: SendableTransaction & Transaction,
					config?: Readonly<{ commitment?: Commitment }>,
				) => {
					const wireBytes = new Uint8Array(transactionEncoder.encode(transaction));
					const chain: IdentifierString =
						options.defaultChain ?? getChain(primaryAccount) ?? 'solana:mainnet-beta';
					const [output] = await signAndSendFeature.signAndSendTransaction({
						account: primaryAccount,
						chain,
						options: {
							commitment: mapCommitment(config?.commitment),
						},
						transaction: wireBytes,
					});
					return base58Decoder.decode(output.signature) as Signature;
				}
			: undefined;

		/**
		 * Disconnects the session scoped to this connect invocation.
		 *
		 * @returns Promise that resolves once the wallet has been disconnected.
		 */
		async function disconnectSession(): Promise<void> {
			await disconnectWallet(wallet);
		}

		return {
			account: sessionAccount,
			connector: metadata,
			disconnect: disconnectSession,
			sendTransaction,
			signMessage,
			signTransaction,
		};
	}

	/**
	 * Disconnects the wallet session when supported.
	 *
	 * @returns Promise that resolves once the wallet has been disconnected.
	 */
	async function disconnect(): Promise<void> {
		await disconnectWallet(wallet);
	}

	/**
	 * Indicates whether the runtime environment appears to be browser based.
	 *
	 * @returns `true` when the wallet can be interacted with.
	 */
	function isSupported(): boolean {
		return typeof window !== 'undefined';
	}

	return {
		...metadata,
		connect,
		disconnect,
		isSupported,
	};
}

/**
 * Maps a wallet instance to a connector, applying optional overrides.
 *
 * @param wallet - Wallet retrieved from Wallet Standard.
 * @param overrides - Optional override factory for connector metadata.
 * @returns Connector representation of the wallet.
 */
function mapWalletToConnector(
	wallet: Wallet,
	overrides?: (wallet: Wallet) => WalletStandardConnectorMetadata | undefined,
): WalletConnector {
	return createWalletStandardConnector(wallet, overrides?.(wallet));
}

export type WalletStandardDiscoveryOptions = Readonly<{
	overrides?: (wallet: Wallet) => WalletStandardConnectorMetadata | undefined;
}>;

/**
 * Returns connectors for all wallets currently registered with Wallet Standard.
 *
 * @param options - Optional discovery configuration.
 * @returns A deduplicated list of wallet connectors.
 */
export function getWalletStandardConnectors(options: WalletStandardDiscoveryOptions = {}): readonly WalletConnector[] {
	const { get } = getWallets();
	const connectors = get().map((wallet) => mapWalletToConnector(wallet, options.overrides));

	// Deduplicate by connector ID (keep first occurrence)
	const seen = new Set<string>();
	return connectors.filter((connector) => {
		if (seen.has(connector.id)) {
			return false;
		}
		seen.add(connector.id);
		return true;
	});
}

/**
 * Watches Wallet Standard registrations and emits new connector lists whenever the set changes.
 *
 * @param onChange - Callback invoked each time the connector set changes.
 * @param options - Optional discovery configuration overrides.
 * @returns Cleanup function that removes all listeners.
 */
export function watchWalletStandardConnectors(
	onChange: (connectors: readonly WalletConnector[]) => void,
	options: WalletStandardDiscoveryOptions = {},
): () => void {
	const { get, on } = getWallets();
	const emit = () => {
		const connectors = get().map((wallet) => mapWalletToConnector(wallet, options.overrides));

		// Deduplicate by connector ID (keep first occurrence)
		const seen = new Set<string>();
		const deduplicated = connectors.filter((connector) => {
			if (seen.has(connector.id)) {
				return false;
			}
			seen.add(connector.id);
			return true;
		});

		onChange(deduplicated);
	};
	emit();
	const offRegister = on('register', emit);
	const offUnregister = on('unregister', emit);
	return () => {
		offRegister();
		offUnregister();
	};
}
