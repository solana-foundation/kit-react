import type { AccountCacheEntry, WalletSession } from '@solana/client';
import {
	type Address,
	type Commitment,
	type Lamports,
	address as parseAddress,
	type Signature,
	signature,
} from '@solana/kit';
import bs58 from 'bs58';
import { vi } from 'vitest';

export type { AccountCacheEntry } from '@solana/client';

export function createAddress(index = 0): Address {
	const bytes = new Uint8Array(32);
	bytes.fill((index % 255) + 1);
	return parseAddress(bs58.encode(bytes));
}

export function createLamports(value: bigint | number): Lamports {
	return (typeof value === 'bigint' ? value : BigInt(value)) as Lamports;
}

export function createSignature(index = 0): Signature {
	const bytes = new Uint8Array(64);
	bytes.fill(((index + 1) % 255) + 1);
	return signature(bs58.encode(bytes));
}

export function createAccountEntry(overrides: Partial<AccountCacheEntry> = {}): AccountCacheEntry {
	return {
		address: overrides.address ?? createAddress(0),
		data: overrides.data,
		error: overrides.error,
		fetching: overrides.fetching ?? false,
		lamports: overrides.lamports ?? createLamports(0),
		lastFetchedAt: overrides.lastFetchedAt,
		slot: overrides.slot ?? null,
		...overrides,
	};
}

export function createWalletSession(overrides: Partial<WalletSession> = {}): WalletSession {
	const account = overrides.account ?? {
		address: createAddress(10),
		label: overrides.account?.label ?? 'Test Wallet Account',
		publicKey: overrides.account?.publicKey ?? new Uint8Array(32),
	};
	const connector = overrides.connector ?? {
		canAutoConnect: true,
		icon: overrides.connector?.icon,
		id: overrides.connector?.id ?? 'test.connector',
		name: overrides.connector?.name ?? 'Test Connector',
	};

	return {
		account,
		connector,
		disconnect: vi.fn(async () => undefined),
		sendTransaction: vi.fn(async () => createSignature(99)),
		signMessage: vi.fn(async (message: Uint8Array) => message),
		signTransaction: vi.fn(async (transaction) => transaction),
		...overrides,
	};
}

export function createConnectedWalletSession(overrides: Partial<WalletSession> = {}): Readonly<{
	commitment: Commitment;
	session: WalletSession;
}> {
	return {
		commitment: 'confirmed',
		session: createWalletSession(overrides),
	};
}
