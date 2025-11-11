import { createSolanaRpcClient, type SolanaClientConfig, type WalletConnector } from '@solana/client';
import {
	SolanaClientProvider,
	SolanaQueryProvider,
	useConnectWallet,
	useWallet,
	useWalletStandardConnectors,
} from '@solana/react-hooks';
import { useEffect, useMemo, useRef } from 'react';

import { AccountInspectorCard } from './components/AccountInspectorCard.tsx';
import { AirdropCard } from './components/AirdropCard.tsx';
import { BalanceCard } from './components/BalanceCard.tsx';
import { ClusterStatusCard } from './components/ClusterStatusCard.tsx';
import { LatestBlockhashCard } from './components/LatestBlockhashCard.tsx';
import { ProgramAccountsCard } from './components/ProgramAccountsCard.tsx';
import { SendTransactionCard } from './components/SendTransactionCard.tsx';
import { SignatureWatcherCard } from './components/SignatureWatcherCard.tsx';
import { SimulateTransactionCard } from './components/SimulateTransactionCard.tsx';
import { SolTransferForm } from './components/SolTransferForm.tsx';
import { SplTokenPanel } from './components/SplTokenPanel.tsx';
import { StoreInspectorCard } from './components/StoreInspectorCard.tsx';
import { TransactionPoolPanel } from './components/TransactionPoolPanel.tsx';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './components/ui/tabs.tsx';
import { WalletControls } from './components/WalletControls.tsx';

const LAST_CONNECTOR_STORAGE_KEY = 'solana:last-connector';

const DEFAULT_CLIENT_CONFIG: SolanaClientConfig = {
	commitment: 'confirmed',
	endpoint: 'https://api.devnet.solana.com',
	websocketEndpoint: 'wss://api.devnet.solana.com',
};

export default function App() {
	const walletConnectors = useWalletStandardConnectors();
	const rpcClient = useMemo(
		() =>
			createSolanaRpcClient({
				commitment: DEFAULT_CLIENT_CONFIG.commitment,
				endpoint: DEFAULT_CLIENT_CONFIG.endpoint,
				websocketEndpoint: DEFAULT_CLIENT_CONFIG.websocketEndpoint,
			}),
		[],
	);

	const clientConfig = useMemo<SolanaClientConfig>(
		() => ({
			...DEFAULT_CLIENT_CONFIG,
			rpcClient,
			walletConnectors,
		}),
		[rpcClient, walletConnectors],
	);

	return (
		<SolanaClientProvider config={clientConfig}>
			<SolanaQueryProvider>
				<DemoApp connectors={walletConnectors} />
			</SolanaQueryProvider>
		</SolanaClientProvider>
	);
}

type DemoAppProps = Readonly<{
	connectors: readonly WalletConnector[];
}>;

function DemoApp({ connectors }: DemoAppProps) {
	const connectWallet = useConnectWallet();
	const wallet = useWallet();
	const attemptedAutoConnect = useRef(false);

	useEffect(() => {
		if (typeof window === 'undefined') {
			return;
		}
		if (wallet.status === 'connected') {
			window.localStorage.setItem(LAST_CONNECTOR_STORAGE_KEY, wallet.connectorId);
		} else if (wallet.status === 'disconnected') {
			window.localStorage.removeItem(LAST_CONNECTOR_STORAGE_KEY);
		}
	}, [wallet]);

	useEffect(() => {
		if (typeof window === 'undefined') {
			return;
		}
		if (attemptedAutoConnect.current) {
			return;
		}
		if (!connectors.length) {
			return;
		}
		if (wallet.status !== 'disconnected' && wallet.status !== 'error') {
			return;
		}
		const lastConnectorId = window.localStorage.getItem(LAST_CONNECTOR_STORAGE_KEY);
		if (!lastConnectorId) {
			attemptedAutoConnect.current = true;
			return;
		}
		const candidate = connectors.find((connector) => connector.id === lastConnectorId && connector.canAutoConnect);
		if (!candidate) {
			attemptedAutoConnect.current = true;
			window.localStorage.removeItem(LAST_CONNECTOR_STORAGE_KEY);
			return;
		}
		attemptedAutoConnect.current = true;
		void connectWallet(candidate.id, { autoConnect: true }).catch(() => {
			window.localStorage.removeItem(LAST_CONNECTOR_STORAGE_KEY);
		});
	}, [connectWallet, connectors, wallet.status]);

	return (
		<div className="relative min-h-screen">
			<div className="pointer-events-none absolute inset-0 -z-10">
				<div className="absolute left-1/2 top-24 h-64 w-64 -translate-x-1/2 rounded-full bg-primary/20 blur-3xl" />
				<div className="absolute bottom-0 right-10 h-72 w-72 rounded-full bg-secondary/20 blur-3xl" />
			</div>
			<div className="container mx-auto max-w-6xl space-y-8 py-12">
				<header className="space-y-4 text-center sm:text-left">
					<span className="inline-flex items-center rounded-full border border-primary/40 bg-primary/10 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-primary shadow-xs">
						React Hooks
					</span>
					<h1>Solana Client Toolkit</h1>
					<p>
						This example wraps the headless <code>@solana/client</code> with a React context provider and
						showcases the hooks exposed by <code>@solana/react-hooks</code>. Explore state, transactions,
						and query helpers via the tabs below.
					</p>
				</header>
				<Tabs defaultValue="state">
					<TabsList>
						<TabsTrigger value="state">Wallet &amp; State</TabsTrigger>
						<TabsTrigger value="transactions">Transfers &amp; Transactions</TabsTrigger>
						<TabsTrigger value="queries">Queries &amp; Diagnostics</TabsTrigger>
					</TabsList>
					<TabsContent value="state">
						<div className="grid gap-6 lg:grid-cols-2">
							<ClusterStatusCard />
							<WalletControls connectors={connectors} />
							<BalanceCard />
							<AccountInspectorCard />
							<AirdropCard />
							<StoreInspectorCard />
						</div>
					</TabsContent>
					<TabsContent value="transactions">
						<div className="grid gap-6 lg:grid-cols-2">
							<SolTransferForm />
							<SendTransactionCard />
							<SplTokenPanel />
							<TransactionPoolPanel />
						</div>
					</TabsContent>
					<TabsContent value="queries">
						<div className="grid gap-6 lg:grid-cols-2">
							<LatestBlockhashCard />
							<ProgramAccountsCard />
							<SimulateTransactionCard />
							<SignatureWatcherCard />
						</div>
					</TabsContent>
				</Tabs>
			</div>
		</div>
	);
}
