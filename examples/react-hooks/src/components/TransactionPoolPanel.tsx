import { lamportsMath } from '@solana/client';
import { address } from '@solana/kit';
import { useTransactionPool, useWalletSession } from '@solana/react-hooks';
import { getTransferSolInstruction } from '@solana-program/system';
import { type FormEvent, useMemo, useState } from 'react';

import { Button } from './ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from './ui/card';
import { Input } from './ui/input';

export function TransactionPoolPanel() {
	const session = useWalletSession();
	const [destination, setDestination] = useState('');
	const [amount, setAmount] = useState('0.001');
	const [localError, setLocalError] = useState<string | null>(null);
	const {
		addInstruction,
		clearInstructions,
		instructions,
		isSending,
		latestBlockhash,
		prepareAndSend,
		removeInstruction,
		sendError,
		sendSignature,
		sendStatus,
	} = useTransactionPool({ latestBlockhash: { refreshInterval: 20_000 } });

	const handleQueueInstruction = (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		setLocalError(null);
		if (!session) {
			setLocalError('Connect a wallet to set the fee payer and authority.');
			return;
		}
		const target = destination.trim();
		const amountInput = amount.trim();
		if (!target || !amountInput) {
			setLocalError('Destination and amount are required.');
			return;
		}
		try {
			const lamports = lamportsMath.fromSol(amountInput, { label: 'SOL amount' });
			const instruction = getTransferSolInstruction({
				amount: lamports,
				destination: address(target),
				source: session.account.address,
			});
			addInstruction(instruction);
			setDestination('');
		} catch (error) {
			setLocalError(formatError(error));
		}
	};

	const handleSend = async () => {
		setLocalError(null);
		if (!session) {
			setLocalError('Connect a wallet before sending pooled instructions.');
			return;
		}
		if (instructions.length === 0) {
			setLocalError('Queue at least one instruction first.');
			return;
		}
		try {
			await prepareAndSend({ authority: session });
		} catch (error) {
			setLocalError(formatError(error));
		}
	};

	const instructionPreview = useMemo(() => {
		if (instructions.length === 0) {
			return 'No instructions queued. Add transfers below and send them together.';
		}
		return instructions
			.map(
				(instruction, index) =>
					`${index + 1}. Program: ${instruction.programAddress.toString()} · Accounts: ${instruction.accounts.length} · Data bytes: ${instruction.data?.length ?? 0}`,
			)
			.join('\n');
	}, [instructions]);

	return (
		<Card aria-disabled={!session}>
			<CardHeader>
				<div className="space-y-1.5">
					<CardTitle>Transaction Pool</CardTitle>
					<CardDescription>
						Compose instruction batches, view the latest blockhash, and submit via{' '}
						<code>useTransactionPool</code>.
					</CardDescription>
				</div>
			</CardHeader>
			<CardContent className="space-y-4">
				<form className="grid gap-4" onSubmit={handleQueueInstruction}>
					<fieldset disabled={!session}>
						<div className="space-y-2">
							<label htmlFor="pool-destination">Destination</label>
							<Input
								autoComplete="off"
								id="pool-destination"
								onChange={(event) => setDestination(event.target.value)}
								placeholder="Recipient address"
								value={destination}
							/>
						</div>
						<div className="space-y-2">
							<label htmlFor="pool-amount">Amount (SOL)</label>
							<Input
								autoComplete="off"
								id="pool-amount"
								min="0"
								onChange={(event) => setAmount(event.target.value)}
								placeholder="0.001"
								step="0.0001"
								type="number"
								value={amount}
							/>
						</div>
						<Button disabled={!session} type="submit" variant="secondary">
							Add Transfer Instruction
						</Button>
					</fieldset>
				</form>
				<div className="log-panel whitespace-pre-wrap">
					{instructionPreview}
					{instructions.length > 0 ? (
						<ul className="mt-3 space-y-2 text-[11px] text-muted-foreground">
							{instructions.map((instruction, index) => (
								<li
									className="flex items-center justify-between gap-2"
									key={`${instruction.programAddress}-${index.toString()}`}
								>
									<span>#{index + 1}</span>
									<Button
										onClick={() => removeInstruction(index)}
										size="sm"
										type="button"
										variant="ghost"
									>
										Remove
									</Button>
								</li>
							))}
						</ul>
					) : null}
				</div>
				<div className="space-y-2 text-sm text-muted-foreground">
					<p>
						Latest blockhash: <code>{latestBlockhash.blockhash ?? 'loading…'}</code>
					</p>
					<p data-state={sendStatus === 'error' ? 'error' : 'success'} className="status-badge">
						{sendStatus === 'idle'
							? 'Idle'
							: sendStatus === 'loading'
								? 'Submitting…'
								: sendStatus === 'success'
									? `Submitted: ${sendSignature ?? 'unknown'}`
									: sendError
										? formatError(sendError)
										: 'Error while sending'}
					</p>
				</div>
			</CardContent>
			<CardFooter className="flex flex-wrap gap-2">
				<Button
					disabled={!session || isSending || instructions.length === 0}
					onClick={handleSend}
					type="button"
				>
					{isSending ? 'Sending…' : 'Prepare & Send'}
				</Button>
				<Button disabled={instructions.length === 0} onClick={clearInstructions} type="button" variant="ghost">
					Clear Instructions
				</Button>
				{localError ? (
					<span aria-live="polite" className="status-badge" data-state="error">
						{localError}
					</span>
				) : null}
			</CardFooter>
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
