import { useSimulateTransaction } from '@solana/react-hooks';
import { type FormEvent, useState } from 'react';

import { Button } from './ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from './ui/card';

export function SimulateTransactionCard() {
	const [payload, setPayload] = useState('');
	const [submittedPayload, setSubmittedPayload] = useState<string | null>(null);
	const simulation = useSimulateTransaction(submittedPayload ?? undefined, {
		disabled: submittedPayload === null,
	});

	const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		const normalized = payload.trim();
		setSubmittedPayload(normalized === '' ? null : normalized);
	};

	const handleClear = () => {
		setSubmittedPayload(null);
		setPayload('');
	};

	return (
		<Card>
			<CardHeader>
				<div className="space-y-1.5">
					<CardTitle>Simulate Transaction</CardTitle>
					<CardDescription>
						Paste a Base64 wire transaction string or use a <code>SendableTransaction</code> object with{' '}
						<code>useSimulateTransaction</code> to fetch logs and unit consumption.
					</CardDescription>
				</div>
			</CardHeader>
			<form onSubmit={handleSubmit}>
				<CardContent className="space-y-4">
					<div className="space-y-2 text-sm text-muted-foreground">
						<label htmlFor="simulation-wire" className="text-foreground">
							Base64 Transaction
						</label>
						<textarea
							className="min-h-[120px] w-full rounded-lg border border-border bg-background p-3 font-mono text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
							id="simulation-wire"
							onChange={(event) => setPayload(event.target.value)}
							placeholder="Paste a serialized transaction"
							value={payload}
						/>
						<p>
							Use <code>client.helpers.transaction.toWire</code> or your favorite tool to produce a Base64
							payload, then click simulate.
						</p>
					</div>
					<div aria-live="polite" className="log-panel max-h-48 overflow-auto">
						{simulation.status === 'idle' && !submittedPayload
							? 'No simulation yet.'
							: simulation.status === 'error'
								? `Simulation failed: ${formatError(simulation.error)}`
								: simulation.logs?.length
									? simulation.logs.map((log, index) => `${index + 1}. ${log}`).join('\n')
									: 'Simulation succeeded with no logs.'}
					</div>
				</CardContent>
				<CardFooter className="flex flex-wrap gap-2">
					<Button disabled={payload.trim() === ''} type="submit">
						Simulate
					</Button>
					<Button
						disabled={!payload && !submittedPayload}
						onClick={handleClear}
						type="button"
						variant="ghost"
					>
						Clear
					</Button>
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
