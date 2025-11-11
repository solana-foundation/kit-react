import { lamportsToSolString } from '@solana/client';
import { useBalance, useWallet } from '@solana/react-hooks';
import { type ChangeEvent, useEffect, useState } from 'react';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { Input } from './ui/input';

function formatError(error: unknown): string {
	if (error instanceof Error) {
		return error.message;
	}
	if (typeof error === 'string') {
		return error;
	}
	return JSON.stringify(error);
}

function formatLamports(lamports: bigint | null): string {
	return lamports === null ? 'Unknown' : lamports.toString();
}

export function BalanceCard() {
	const wallet = useWallet();
	const [address, setAddress] = useState('');

	useEffect(() => {
		if (wallet.status === 'connected') {
			setAddress(wallet.session.account.address.toString());
		}
	}, [wallet]);

	const trimmedAddress = address.trim();
	const balance = useBalance(trimmedAddress === '' ? undefined : trimmedAddress);

	const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
		setAddress(event.target.value);
	};

	const solDisplay =
		balance.lamports !== null ? `${lamportsToSolString(balance.lamports)} SOL` : 'Balance unavailable.';

	return (
		<Card>
			<CardHeader>
				<div className="space-y-1.5">
					<CardTitle>Account Balance</CardTitle>
					<CardDescription>
						Provide an address and <code>useBalance</code> keeps the lamport cache in sync with your client
						store.
					</CardDescription>
				</div>
			</CardHeader>
			<CardContent className="space-y-5">
				<div className="space-y-2">
					<label htmlFor="balance-account">Address</label>
					<Input
						autoComplete="off"
						id="balance-account"
						onChange={handleChange}
						placeholder="Base58 address"
						value={address}
					/>
				</div>
				<div className="grid gap-1 text-sm">
					<div className="flex items-center justify-between text-muted-foreground">
						<span>Lamports</span>
						<span className="font-medium text-foreground">{formatLamports(balance.lamports)}</span>
					</div>
					<div className="flex items-center justify-between text-muted-foreground">
						<span>SOL</span>
						<span className="font-medium text-foreground">{solDisplay}</span>
					</div>
					<div className="flex items-center justify-between text-muted-foreground">
						<span>Status</span>
						<span className="font-medium text-foreground">{balance.fetching ? 'Fetching…' : 'Idle'}</span>
					</div>
					{balance.slot !== undefined && balance.slot !== null ? (
						<div className="flex items-center justify-between text-muted-foreground">
							<span>Slot</span>
							<span className="font-medium text-foreground">{balance.slot.toString()}</span>
						</div>
					) : null}
				</div>
				{balance.error ? (
					<span aria-live="polite" className="status-badge" data-state="error">
						{formatError(balance.error)}
					</span>
				) : null}
			</CardContent>
		</Card>
	);
}
