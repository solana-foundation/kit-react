# Solana SDK

> ⚠️ Experimental: Solana SDK is an early-stage Solana SDK built on Solana Kit and slated to supersede Gill and web3.js.

Solana SDK delivers React-focused tooling for building Solana applications. This workspace currently ships two packages:

| Package | Description |
| --- | --- |
| [`@solana/react-hooks`](packages/react-hooks) | React bindings over the headless [`@solana/client`](packages/client) SDK. Supplies context providers plus hooks for wallet management, balances, transfers, and SPL helpers. |
| [`@solana/example-react-hooks`](examples/react-hooks) | Tailwind/Vite demo application showcasing the hooks with a polished UI. Handy as a reference or quick-start template. |

---

## Transaction-helper DX

`@solana/client` now folds automatic transaction preparation into the public surface. You can lean on `client.helpers.transaction.prepareAndSend` for the common “build → simulate → send” flow while still opting into the bare `prepareTransaction` utility when you need to log or inspect the wire payload. Feed it `addressLookupTables` and it automatically switches to v0 transactions—otherwise it stays legacy so you never have to name the version explicitly.

```ts
const signature = await client.helpers.transaction.prepareAndSend(
	{
		instructions,
		authority: walletSession,
		prepareTransaction: {
			computeUnitLimitMultiplier: 1.2,
			logRequest: ({ base64WireTransaction }) => telemetry.debug({ base64WireTransaction }),
		},
	},
	{ commitment: 'confirmed' },
);
```

Need finer control? `client.prepareTransaction` exposes the same simulation-powered tuning without re-exporting any of `@solana/kit`.

## Development

- Install deps with `pnpm install`.
- `pnpm dev` fans out via Turborepo to any package exposing a `dev` script.
- `pnpm build`, `pnpm lint`, `pnpm typecheck`, and `pnpm test` all proxy to `turbo run …` tasks.
- Biome powers linting (`pnpm lint`) and formatting (`pnpm format`) across packages.
- CI enforces Biome linting through `.github/workflows/biome.yml` on every push and pull request.
- Unit tests are powered by Vitest (`vitest.config.ts`), with shared setup in `vitest.setup.ts`.

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines on how to get involved.

---

## `@solana/react-hooks`

React glue around the client SDK. You either hand it a `SolanaClient` instance or a config object and the provider wires everything together. Hooks expose cluster and wallet state in a React-friendly way so you can focus on UI.

### Install

```bash
# using pnpm
pnpm add @solana/react-hooks @solana/client react react-dom

# or npm
npm install @solana/react-hooks @solana/client react react-dom
```

### Quick start

```tsx
import type { SolanaClientConfig } from '@solana/client';
import {
    SolanaClientProvider,
    useConnectWallet,
    useDisconnectWallet,
    useWallet,
    useWalletStandardConnectors,
} from '@solana/react-hooks';

const config: SolanaClientConfig = {
    commitment: 'confirmed',
    endpoint: 'https://api.devnet.solana.com',
};

function WalletButtons() {
    const wallet = useWallet();
    const connectors = useWalletStandardConnectors();
    const connect = useConnectWallet();
    const disconnect = useDisconnectWallet();

    return (
        <div>
            {connectors.map(connector => (
                <button
                    key={connector.id}
                    onClick={() => connect(connector.id)}
                    disabled={wallet.status === 'connecting'}
                >
                    {connector.name}
                </button>
            ))}
            {wallet.status === 'connected' ? (
                <button onClick={() => disconnect()}>Disconnect</button>
            ) : null}
        </div>
    );
}

export function App() {
    return (
        <SolanaClientProvider config={config}>
            <WalletButtons />
        </SolanaClientProvider>
    );
}
```

### After connecting

Once the provider is in place, grabbing wallet state or performing actions is one hook away.

```tsx
import { useBalance, useSolTransfer, useSplToken, useWalletSession } from '@solana/react-hooks';

function WalletDetails() {
    const session = useWalletSession();
    const address = session?.account.address.toString();
    const balance = useBalance(address);

    if (!session) {
        return <p>Connect a wallet to see details.</p>;
    }

    return (
        <div>
            <p>Address: {address}</p>
            <p>Lamports: {balance.lamports?.toString() ?? '–'}</p>
        </div>
    );
}

function SendOneLamport() {
    const session = useWalletSession();
    const { send, status } = useSolTransfer();

    if (!session) {
        return null;
    }

    return (
        <button
            disabled={status === 'loading'}
            onClick={() =>
                send({
                    amount: 1n,
                    destination: session.account.address,
                })
            }
        >
            {status === 'loading' ? 'Sending…' : 'Send 1 lamport to myself'}
        </button>
    );
}

function UsdcBalance() {
    const { balance, status } = useSplToken('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU');
    if (status !== 'ready' || !balance) {
        return <p>Fetching USDC balance…</p>;
    }
    return <p>USDC: {balance.uiAmount}</p>;
}

function SendUsdc({ destination }: { destination: string }) {
    const { isSending, send } = useSplToken('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU');
    return (
        <button
            disabled={isSending}
            onClick={() =>
                send({
                    amount: '0.5',
                    destinationOwner: destination,
                })
            }
        >
            {isSending ? 'Sending…' : 'Send 0.5 USDC'}
        </button>
    );
}
```

### Popular hooks

- `useClusterState`, `useClusterStatus`: check RPC/WebSocket connectivity and latency.
- `useWallet`, `useWalletSession`, `useConnectWallet`, `useDisconnectWallet`: Wallet Standard lifecycle helpers.
- `useSolTransfer`, `useSplToken`: SOL and SPL transfer helpers with status + error tracking.
- `useBalance`, `useAccount`: live cache reads from the client store.
- `useTransactionPool`: construct, sign, and send transactions using the built-in helper.
- `useWalletStandardConnectors`: auto-discover Wallet Standard providers at runtime.

> The package also exports deprecated compatibility hooks (`useSignTransaction`, `useSignMessage`, etc.) mirroring the API from `@solana/react`. They exist for easy upgrades but you should prefer the new client-centric helpers.

### Provider options

`SolanaClientProvider` accepts either:

```tsx
<SolanaClientProvider config={config}>...</SolanaClientProvider>
```

or a client instance you manage:

```tsx
const client = createClient(config);

<SolanaClientProvider client={client}>
    <App />
</SolanaClientProvider>
```

Internally created clients are destroyed when the provider unmounts.

---

## `@solana/example-react-hooks`

A Vite + React + Tailwind playground that implements common flows using the hooks library. It mirrors the visual style of the anchor-kit demo and is great for copy/paste snippets.

### Develop

```bash
# using pnpm
pnpm install
pnpm --filter @solana/example-react-hooks dev

# or npm
npm install
npx --yes pnpm --filter @solana/example-react-hooks dev
```

### What’s inside

- Cluster status card (latency + endpoint info)
- Wallet connector picker using Wallet Standard
- SOL transfer form (`useSolTransfer`)
- USDC transfer panel (`useSplToken`)
- Reusable Card/Button/Input components styled with Tailwind and class-variance-authority

### Build

```bash
# using pnpm
pnpm --filter @solana/example-react-hooks build

# or npm
npx --yes pnpm --filter @solana/example-react-hooks build
```

> If you consume `@solana/react-hooks` from the workspace, ensure the `@solana/client-poc` import is aliased to `@solana/client` (the example’s Vite config handles this).

---

## Scripts & Tooling

Everything uses pnpm workspaces:

```bash
pnpm install
pnpm --filter @solana/react-hooks test:typecheck
pnpm --filter @solana/example-react-hooks dev
```

Contributions welcome—file issues or PRs as needed. Happy shipping!
