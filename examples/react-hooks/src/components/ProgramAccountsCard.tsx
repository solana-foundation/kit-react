import { useProgramAccounts } from '@solana/react-hooks';
import { type ChangeEvent, useMemo, useState } from 'react';

import { Button } from './ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from './ui/card';
import { Input } from './ui/input';

const DEFAULT_PROGRAM = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr';

export function ProgramAccountsCard() {
	const [program, setProgram] = useState(DEFAULT_PROGRAM);
	const target = program.trim();
	const query = useProgramAccounts(target === '' ? undefined : target, {
		config: { commitment: 'confirmed', encoding: 'base64', filters: [] },
	});

	const results = useMemo(() => {
		if (!query.accounts?.length) {
			return 'No accounts fetched yet.';
		}
		return query.accounts
			.slice(0, 5)
			.map((account) => `${account.pubkey.toString()} · ${account.account.data.length} bytes`)
			.join('\n');
	}, [query.accounts]);

	const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
		setProgram(event.target.value);
	};

	return (
		<Card>
			<CardHeader>
				<div className="space-y-1.5">
					<CardTitle>Program Accounts</CardTitle>
					<CardDescription>
						Call <code>useProgramAccounts</code> to hydrate GPA results and manually refresh the dataset.
					</CardDescription>
				</div>
			</CardHeader>
			<CardContent className="space-y-4">
				<div className="space-y-2">
					<label htmlFor="program-address">Program Address</label>
					<Input
						autoComplete="off"
						id="program-address"
						onChange={handleChange}
						placeholder="Program public key"
						value={program}
					/>
				</div>
				<div className="log-panel max-h-48 overflow-auto whitespace-pre-wrap" aria-live="polite">
					{query.status === 'error' && query.error
						? `Error fetching accounts: ${formatError(query.error)}`
						: results}
				</div>
			</CardContent>
			<CardFooter className="flex flex-wrap gap-2">
				<Button disabled={target === ''} onClick={() => query.refresh()} type="button" variant="secondary">
					Refresh
				</Button>
				<span className="text-xs text-muted-foreground">
					Status:{' '}
					<span className="font-medium text-foreground">
						{query.status === 'idle' ? 'idle' : query.status}
					</span>
				</span>
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
