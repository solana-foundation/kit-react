import { useSignatureStatus, useWaitForSignature } from '@solana/react-hooks';
import { type ChangeEvent, useState } from 'react';

import { Button } from './ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from './ui/card';
import { Input } from './ui/input';

const COMMITMENTS = ['processed', 'confirmed', 'finalized'] as const;

export function SignatureWatcherCard() {
	const [signature, setSignature] = useState('');
	const [commitment, setCommitment] = useState<(typeof COMMITMENTS)[number]>('confirmed');
	const [subscribe, setSubscribe] = useState(true);
	const target = signature.trim();

	const signatureStatus = useSignatureStatus(target === '' ? undefined : target, {
		config: { searchTransactionHistory: true },
		disabled: target === '',
	});
	const waiter = useWaitForSignature(target === '' ? undefined : target, {
		commitment,
		disabled: target === '',
		subscribe,
	});

	const handleSignatureChange = (event: ChangeEvent<HTMLInputElement>) => {
		setSignature(event.target.value);
	};

	return (
		<Card>
			<CardHeader>
				<div className="space-y-1.5">
					<CardTitle>Signature Status</CardTitle>
					<CardDescription>
						Combine <code>useSignatureStatus</code> with <code>useWaitForSignature</code> to track
						confirmations declaratively.
					</CardDescription>
				</div>
			</CardHeader>
			<CardContent className="space-y-4">
				<div className="space-y-2">
					<label htmlFor="signature-input">Signature</label>
					<Input
						autoComplete="off"
						id="signature-input"
						onChange={handleSignatureChange}
						placeholder="Base58 transaction signature"
						value={signature}
					/>
				</div>
				<div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
					<label className="flex items-center gap-2">
						<input
							checked={subscribe}
							className="size-4 rounded border-border text-primary focus-visible:ring-2 focus-visible:ring-ring/60"
							onChange={(event) => setSubscribe(event.target.checked)}
							type="checkbox"
						/>
						Subscribe via WebSocket
					</label>
					<label className="flex items-center gap-2">
						<span>Commitment</span>
						<select
							className="rounded-md border border-border bg-transparent px-2 py-1 text-sm text-foreground"
							onChange={(event) => setCommitment(event.target.value as (typeof COMMITMENTS)[number])}
							value={commitment}
						>
							{COMMITMENTS.map((value) => (
								<option key={value} value={value}>
									{value}
								</option>
							))}
						</select>
					</label>
				</div>
				<div className="grid gap-2 text-sm text-muted-foreground">
					<p>
						Signature status:{' '}
						<span className="font-medium text-foreground">
							{signatureStatus.signatureStatus?.confirmationStatus ?? 'unknown'}
						</span>
					</p>
					<p>
						Wait helper:{' '}
						<span className="font-medium text-foreground" data-state={waiter.waitStatus}>
							{waiter.waitStatus}
						</span>
					</p>
					{waiter.waitError ? (
						<span className="status-badge" data-state="error">
							{formatError(waiter.waitError)}
						</span>
					) : null}
				</div>
			</CardContent>
			<CardFooter className="flex flex-wrap gap-2">
				<Button
					disabled={target === ''}
					onClick={() => signatureStatus.refresh()}
					type="button"
					variant="secondary"
				>
					Refresh status
				</Button>
				<Button disabled={target === ''} onClick={() => waiter.refresh()} type="button" variant="ghost">
					Refresh wait helper
				</Button>
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
