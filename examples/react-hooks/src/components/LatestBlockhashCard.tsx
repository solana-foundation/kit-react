import { useLatestBlockhash } from '@solana/react-hooks';

import { Button } from './ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from './ui/card';

export function LatestBlockhashCard() {
	const latest = useLatestBlockhash({ refreshInterval: 30_000 });

	return (
		<Card>
			<CardHeader>
				<div className="space-y-1.5">
					<CardTitle>Latest Blockhash</CardTitle>
					<CardDescription>
						<code>useLatestBlockhash</code> polls the cluster (or refetches manually) and exposes blockhash
						context including the expiry height.
					</CardDescription>
				</div>
			</CardHeader>
			<CardContent className="space-y-3 text-sm text-muted-foreground">
				<div>
					<span className="font-medium text-foreground">Blockhash:</span>{' '}
					<code>{latest.blockhash ?? 'Loading…'}</code>
				</div>
				<div>
					<span className="font-medium text-foreground">Last Valid Height:</span>{' '}
					{latest.lastValidBlockHeight ?? 'Unknown'}
				</div>
				<div>
					<span className="font-medium text-foreground">Context Slot:</span> {latest.contextSlot ?? 'Unknown'}
				</div>
				<p aria-live="polite">
					Status:{' '}
					<span className="status-badge" data-state={latest.status === 'error' ? 'error' : 'success'}>
						{latest.status}
					</span>
				</p>
			</CardContent>
			<CardFooter>
				<Button onClick={() => latest.refresh()} type="button" variant="secondary">
					Refresh now
				</Button>
			</CardFooter>
		</Card>
	);
}
