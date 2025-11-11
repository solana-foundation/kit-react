import { useClientStore } from '@solana/react-hooks';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';

export function StoreInspectorCard() {
	const state = useClientStore();
	const accountsCached = Object.keys(state.accounts).length;
	const transactionsTracked = Object.keys(state.transactions).length;

	return (
		<Card>
			<CardHeader>
				<div className="space-y-1.5">
					<CardTitle>Client Store</CardTitle>
					<CardDescription>
						<code>useClientStore</code> exposes the Zustand snapshot if you need bespoke selectors or simply
						want to introspect state.
					</CardDescription>
				</div>
			</CardHeader>
			<CardContent className="space-y-3 text-sm text-muted-foreground">
				<p>
					Accounts cached: <span className="font-medium text-foreground">{accountsCached}</span>
				</p>
				<p>
					Subscriptions · Account:{' '}
					<span className="font-medium text-foreground">
						{Object.keys(state.subscriptions.account).length}
					</span>{' '}
					/ Signature:{' '}
					<span className="font-medium text-foreground">
						{Object.keys(state.subscriptions.signature).length}
					</span>
				</p>
				<p>
					Transactions tracked: <span className="font-medium text-foreground">{transactionsTracked}</span>
				</p>
				<p>
					Last updated at:{' '}
					<span className="font-medium text-foreground">
						{new Date(state.lastUpdatedAt).toLocaleTimeString()}
					</span>
				</p>
			</CardContent>
		</Card>
	);
}
