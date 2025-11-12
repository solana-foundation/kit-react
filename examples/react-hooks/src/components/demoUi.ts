import type { SplTokenBalance } from '@solana/client';
import type { WalletSession } from '@solana/react-hooks';

type AsyncStatus = 'disconnected' | 'error' | 'idle' | 'loading' | 'ready' | 'success';

export type TransferState = Readonly<{
	error: unknown;
	session: WalletSession | undefined;
	signature: unknown;
	status: AsyncStatus;
}>;

type SplBalanceDescriptor = Readonly<{
	balance: SplTokenBalance | null;
	error: unknown;
	isFetching: boolean;
	owner: string | null;
	status: 'disconnected' | 'error' | 'loading' | 'ready';
}>;

type SplTransferDescriptor = Readonly<{
	error: unknown;
	isSending: boolean;
	owner: string | null;
	signature: unknown;
	status: 'error' | 'idle' | 'loading' | 'success';
}>;

export function formatTransferFeedback({ error, session, signature, status }: TransferState): string {
	if (!session) {
		return 'Connect a wallet to send SOL transfers.';
	}
	if (status === 'loading') {
		return 'Sending transfer…';
	}
	if (status === 'success' && signature) {
		return `Transfer submitted! Signature: ${String(signature)}`;
	}
	if (status === 'error' && error) {
		return `Transfer failed: ${formatError(error)}`;
	}
	return 'Enter a destination and amount, then submit to send SOL.';
}

export function formatSplBalanceStatus({ balance, error, isFetching, owner, status }: SplBalanceDescriptor): string {
	if (!owner) {
		return 'Connect a wallet to inspect your USDC balance.';
	}
	if (status === 'loading' || isFetching) {
		return 'Fetching balance…';
	}
	if (status === 'error' && error) {
		return `Balance error: ${formatError(error)}`;
	}
	if (!balance) {
		return 'No cached balance. Refresh to fetch the latest data.';
	}
	return `${balance.uiAmount} USDC (${balance.amount.toString()} base units)`;
}

export function formatSplTransferStatus({ error, isSending, owner, signature, status }: SplTransferDescriptor): string {
	if (!owner) {
		return 'Connect a wallet to send USDC.';
	}
	if (isSending || status === 'loading') {
		return 'Sending token transfer…';
	}
	if (status === 'success' && signature) {
		return `Transfer submitted! Signature: ${String(signature)}`;
	}
	if (status === 'error' && error) {
		return `Transfer failed: ${formatError(error)}`;
	}
	return 'Ready to send.';
}

export function computeSplAmountStep(decimals: number | null | undefined): string {
	const resolvedDecimals = decimals ?? 0;
	if (resolvedDecimals <= 0) {
		return '1';
	}
	return `0.${'0'.repeat(resolvedDecimals - 1)}1`;
}

export function isWalletConnected(session: WalletSession | undefined): boolean {
	return Boolean(session);
}

function formatError(error: unknown): string {
	if (error instanceof Error) {
		return error.message;
	}
	if (typeof error === 'string') {
		return error;
	}
	return JSON.stringify(error);
}
