import { lamportsMath } from '@solana/client';
import { address } from '@solana/kit';
import { useSendTransaction, useWalletSession } from '@solana/react-hooks';
import { getTransferSolInstruction } from '@solana-program/system';
import { type FormEvent, useEffect, useState } from 'react';

import { formatTransferFeedback } from './demoUi';
import { Button } from './ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from './ui/card';
import { Input } from './ui/input';

export function SendTransactionCard() {
	const session = useWalletSession();
	const { error, isSending, reset, send, signature, status } = useSendTransaction();
	const [destination, setDestination] = useState('');
	const [amount, setAmount] = useState('0.002');

	useEffect(() => {
		if (!session) {
			setDestination('');
		}
	}, [session]);

	const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		if (!session) {
			return;
		}
		const target = destination.trim();
		const amountInput = amount.trim();
		if (!target || !amountInput) {
			return;
		}
		const lamports = lamportsMath.fromSol(amountInput, { label: 'SOL amount' });
		const instruction = getTransferSolInstruction({
			amount: lamports,
			destination: address(target),
			source: session.account.address,
		});
		await send({
			instructions: [instruction],
		});
	};

	const feedback = formatTransferFeedback({ error, session, signature, status });

	return (
		<Card aria-disabled={!session}>
			<CardHeader>
				<div className="space-y-1.5">
					<CardTitle>useSendTransaction</CardTitle>
					<CardDescription>
						Queue any instruction array and <code>useSendTransaction</code> handles prepare, signing, and
						submission while exposing mutation status.
					</CardDescription>
				</div>
			</CardHeader>
			<CardContent>
				<form className="grid gap-4" onSubmit={handleSubmit}>
					<fieldset disabled={!session}>
						<div className="space-y-2">
							<label htmlFor="send-destination">Destination</label>
							<Input
								autoComplete="off"
								id="send-destination"
								onChange={(event) => setDestination(event.target.value)}
								placeholder="Recipient address"
								value={destination}
							/>
						</div>
						<div className="space-y-2">
							<label htmlFor="send-amount">Amount (SOL)</label>
							<Input
								autoComplete="off"
								id="send-amount"
								min="0"
								onChange={(event) => setAmount(event.target.value)}
								placeholder="0.002"
								step="0.0001"
								type="number"
								value={amount}
							/>
						</div>
						<div className="flex flex-wrap gap-2">
							<Button disabled={!session || isSending} type="submit">
								{isSending ? 'Submitting…' : 'Send'}
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
