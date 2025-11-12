import { lamportsMath } from '@solana/client';
import { useSolTransfer, useWalletSession } from '@solana/react-hooks';
import { type FormEvent, useEffect, useState } from 'react';

import { formatTransferFeedback } from './demoUi';
import { Button } from './ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from './ui/card';
import { Input } from './ui/input';

export function SolTransferForm() {
	const session = useWalletSession();
	const { send, status, signature, error, reset, isSending } = useSolTransfer();

	const [destination, setDestination] = useState('');
	const [amount, setAmount] = useState('0.01');

	useEffect(() => {
		if (session) {
			setDestination((current) => current || session.account.address.toString());
		} else {
			setDestination('');
		}
	}, [session]);

	useEffect(() => {
		if (status === 'success') {
			setAmount('0.01');
		}
	}, [status]);

	const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		const target = destination.trim();
		const amountInput = amount.trim();
		if (!target || !amountInput) {
			return;
		}
		const lamports = lamportsMath.fromSol(amountInput, { label: 'SOL amount' });
		await send({
			amount: lamports,
			destination: target,
		});
	};

	const feedback = formatTransferFeedback({ error, session, signature, status });

	const isWalletConnected = Boolean(session);

	return (
		<Card aria-disabled={!isWalletConnected}>
			<CardHeader>
				<div className="space-y-1.5">
					<CardTitle>SOL Transfer</CardTitle>
					<CardDescription>
						The <code>useSolTransfer</code> hook wraps the underlying helper, manages status, and exposes
						the latest signature so you only worry about form inputs.
					</CardDescription>
				</div>
			</CardHeader>
			<CardContent>
				<form className="grid gap-4" onSubmit={handleSubmit}>
					<fieldset className="grid gap-4" disabled={!isWalletConnected}>
						<div className="space-y-2">
							<label htmlFor="sol-destination">Destination</label>
							<Input
								autoComplete="off"
								id="sol-destination"
								onChange={(event) => setDestination(event.target.value)}
								placeholder="Recipient address"
								value={destination}
							/>
						</div>
						<div className="space-y-2">
							<label htmlFor="sol-amount">Amount (SOL)</label>
							<Input
								autoComplete="off"
								id="sol-amount"
								min="0"
								onChange={(event) => setAmount(event.target.value)}
								placeholder="0.01"
								step="0.0001"
								type="number"
								value={amount}
							/>
						</div>
						<div className="flex flex-wrap gap-2">
							<Button disabled={!session || isSending} type="submit">
								{isSending ? 'Sending…' : 'Send SOL'}
							</Button>
							<Button disabled={status === 'idle'} onClick={reset} type="button" variant="ghost">
								Reset
							</Button>
						</div>
					</fieldset>
				</form>
			</CardContent>
			<CardFooter>
				<div aria-live="polite" className="log-panel w-full">
					{feedback}
				</div>
			</CardFooter>
		</Card>
	);
}
