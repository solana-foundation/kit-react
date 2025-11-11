import { useAccount } from '@solana/react-hooks';
import { type ChangeEvent, useMemo, useState } from 'react';

import { Button } from './ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from './ui/card';
import { Input } from './ui/input';

export function AccountInspectorCard() {
	const [address, setAddress] = useState('');
	const [watch, setWatch] = useState(false);
	const target = address.trim();
	const account = useAccount(target === '' ? undefined : target, {
		fetch: target !== '',
		skip: target === '',
		watch,
	});

	const formattedData = useMemo(() => {
		if (!account?.data) {
			return 'No account data fetched yet.';
		}
		try {
			return JSON.stringify(account.data, null, 2);
		} catch {
			return String(account.data);
		}
	}, [account]);

	const statusLabel = (() => {
		if (target === '') {
			return 'Enter an address to fetch the cache entry.';
		}
		if (!account) {
			return 'Loading account data…';
		}
		if (account.error) {
			return `Fetch error: ${formatError(account.error)}`;
		}
		return `Lamports: ${account.lamports ?? 'unknown'} · Slot: ${account.slot ?? 'unknown'}`;
	})();

	const handleAddressChange = (event: ChangeEvent<HTMLInputElement>) => {
		setAddress(event.target.value);
	};

	return (
		<Card>
			<CardHeader>
				<div className="space-y-1.5">
					<CardTitle>Account Inspector</CardTitle>
					<CardDescription>
						Use <code>useAccount</code> to populate the client store cache and optionally subscribe to live
						account changes.
					</CardDescription>
				</div>
			</CardHeader>
			<CardContent className="space-y-4">
				<div className="space-y-2">
					<label htmlFor="account-address">Address</label>
					<Input
						autoComplete="off"
						id="account-address"
						onChange={handleAddressChange}
						placeholder="Base58 account address"
						value={address}
					/>
				</div>
				<label className="flex items-center gap-2 text-sm text-muted-foreground">
					<input
						checked={watch}
						className="size-4 rounded border-border text-primary focus-visible:ring-2 focus-visible:ring-ring/60"
						onChange={(event) => setWatch(event.target.checked)}
						type="checkbox"
					/>
					Watch account for changes
				</label>
				<div className="space-y-2 text-sm text-muted-foreground">
					<p aria-live="polite">{statusLabel}</p>
					{account?.fetching ? (
						<span className="status-badge" data-state="success">
							Refreshing…
						</span>
					) : null}
				</div>
				<div className="log-panel max-h-60 overflow-auto whitespace-pre-wrap">{formattedData}</div>
			</CardContent>
			<CardFooter className="text-xs text-muted-foreground">
				<Button disabled={target === ''} onClick={() => setAddress('')} type="button" variant="ghost">
					Clear
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
