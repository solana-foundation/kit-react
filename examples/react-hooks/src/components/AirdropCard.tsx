import { lamportsMath } from '@solana/client';
import { useWalletActions, useWalletSession } from '@solana/react-hooks';
import { type FormEvent, useState } from 'react';

import { Button } from './ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from './ui/card';
import { Input } from './ui/input';

export function AirdropCard() {
	const session = useWalletSession();
	const actions = useWalletActions();
	const [amount, setAmount] = useState('1');
	const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
	const [result, setResult] = useState<string | null>(null);

	const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		if (!session) {
			return;
		}
		setStatus('loading');
		setResult(null);
		try {
			const lamports = lamportsMath.fromSol(amount.trim(), { label: 'Airdrop amount' });
			const signature = await actions.requestAirdrop(session.account.address, lamports);
			setResult(signature.toString());
			setStatus('success');
		} catch (error) {
			setResult(formatError(error));
			setStatus('error');
		}
	};

	return (
		<Card aria-disabled={!session}>
			<CardHeader>
				<div className="space-y-1.5">
					<CardTitle>Wallet Actions</CardTitle>
					<CardDescription>
						Call the headless client via <code>useWalletActions</code> to trigger RPC helpers, such as a
						devnet airdrop.
					</CardDescription>
				</div>
			</CardHeader>
			<form onSubmit={handleSubmit}>
				<CardContent className="space-y-4">
					<div className="space-y-2">
						<label htmlFor="airdrop-amount">Amount (SOL)</label>
						<Input
							autoComplete="off"
							disabled={!session}
							id="airdrop-amount"
							min="0"
							onChange={(event) => setAmount(event.target.value)}
							placeholder="1"
							step="0.1"
							type="number"
							value={amount}
						/>
					</div>
					<p className="text-sm text-muted-foreground">
						{session
							? `Requester: ${session.account.address.toString()}`
							: 'Connect a devnet wallet to request an airdrop.'}
					</p>
				</CardContent>
				<CardFooter className="flex flex-wrap gap-2">
					<Button disabled={!session || status === 'loading'} type="submit">
						{status === 'loading' ? 'Requesting…' : 'Request Airdrop'}
					</Button>
					{result ? (
						<span
							aria-live="polite"
							className="status-badge"
							data-state={status === 'error' ? 'error' : 'success'}
						>
							{result}
						</span>
					) : null}
				</CardFooter>
			</form>
		</Card>
	);
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
