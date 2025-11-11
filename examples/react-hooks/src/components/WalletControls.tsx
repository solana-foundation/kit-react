import type { WalletConnector } from '@solana/client';
import { useConnectWallet, useDisconnectWallet, useWallet, useWalletSession } from '@solana/react-hooks';
import { useCallback } from 'react';
import { Button } from './ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from './ui/card';

function formatError(error: unknown): string {
	if (error instanceof Error) {
		return error.message;
	}
	if (typeof error === 'string') {
		return error;
	}
	return JSON.stringify(error);
}

type Props = Readonly<{
	connectors: readonly WalletConnector[];
}>;

export function WalletControls({ connectors }: Props) {
	const wallet = useWallet();
	const session = useWalletSession();
	const connectWallet = useConnectWallet();
	const disconnectWallet = useDisconnectWallet();

	const handleConnect = useCallback(
		async (connectorId: string) => {
			try {
				await connectWallet(connectorId);
			} catch {
				// Store will expose the error state; nothing else to do here.
			}
		},
		[connectWallet],
	);

	const handleDisconnect = useCallback(async () => {
		try {
			await disconnectWallet();
		} catch {
			// Store already captures the error in wallet state.
		}
	}, [disconnectWallet]);

	const activeConnectorId =
		wallet.status === 'connected' || wallet.status === 'connecting' ? wallet.connectorId : undefined;

	let statusLabel = 'No wallet connected.';
	if (wallet.status === 'connected') {
		statusLabel = `Connected to ${wallet.connectorId}: ${wallet.session.account.address.toString()}`;
	} else if (wallet.status === 'connecting') {
		statusLabel = `Connecting to ${wallet.connectorId}…`;
	} else if (wallet.status === 'error') {
		statusLabel = `Error connecting to ${wallet.connectorId ?? 'wallet'}.`;
	}

	const error = wallet.status === 'error' && wallet.error ? formatError(wallet.error) : null;

	return (
		<Card>
			<CardHeader>
				<div className="space-y-1.5">
					<CardTitle>Wallets</CardTitle>
					<CardDescription>
						Discover Wallet Standard connectors, connect with wallet actions, and disconnect with a single
						helper call.
					</CardDescription>
				</div>
			</CardHeader>
			<CardContent className="space-y-4">
				<div className="grid gap-2 sm:grid-cols-2" aria-live="polite">
					{connectors.length === 0 ? (
						<span className="rounded-md border border-dashed border-border/70 px-3 py-2 text-sm text-muted-foreground">
							No Wallet Standard providers detected.
						</span>
					) : null}
					{connectors.map((connector) => {
						const isActive = wallet.status === 'connected' && connector.id === activeConnectorId;
						const isBusy = wallet.status === 'connecting' && connector.id === activeConnectorId;
						return (
							<Button
								key={connector.id}
								disabled={isActive || isBusy}
								onClick={() => handleConnect(connector.id)}
								title={connector.name}
								type="button"
								variant={isActive ? 'secondary' : 'outline'}
								className="justify-start"
							>
								{isActive ? `✓ ${connector.name}` : connector.name}
							</Button>
						);
					})}
				</div>
				{session ? (
					<div className="flex flex-wrap gap-2">
						<Button
							disabled={wallet.status === 'connecting'}
							onClick={handleDisconnect}
							type="button"
							variant="ghost"
						>
							Disconnect
						</Button>
					</div>
				) : null}
			</CardContent>
			<CardFooter className="flex flex-col gap-3 text-sm">
				<p className="text-muted-foreground">{statusLabel}</p>
				{error ? (
					<span aria-live="polite" className="status-badge" data-state="error">
						{error}
					</span>
				) : null}
			</CardFooter>
		</Card>
	);
}
