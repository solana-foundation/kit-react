# @solana/client

Framework-agnostic building blocks for Solana RPC, subscriptions, wallets, and transactions. Works
in any runtime (React, Svelte, API routes, workers, etc.).

> **Status:** Experimental – expect rapid iteration.

## Install

```bash
pnpm add @solana/client
```

## Quick start

```ts
import { createClient } from "@solana/client";

const client = createClient({
  endpoint: "https://api.devnet.solana.com",
});

// Fetch an account once.
const account = await client.actions.fetchAccount(address);
console.log(account.lamports?.toString());

// Watch lamports in real time.
const watcher = client.watchers.watchBalance({ address }, (lamports) => {
  console.log("balance:", lamports.toString());
});

// Later…
watcher.abort();
```

## Core pieces

- **Client store** – Zustand store that tracks cluster status, accounts, subscriptions, transactions,
  and wallet state. Provide your own store if you need custom persistence.
- **Actions** – Promise-based helpers (`fetchAccount`, `fetchBalance`, `sendTransaction`, `requestAirdrop`, `setCluster`, etc.) that wrap the RPC and keep the store in sync.
- **Watchers** – Subscription helpers (`watchAccount`, `watchBalance`, `watchSignature`) that stream
  updates into the store and call your listeners.
- **Helpers** – Opinionated utilities for SOL transfers, SPL tokens, and transactions. They handle
  mundane tasks like resolving fee payers, refreshing blockhashes, or signing with Wallet Standard
  sessions.

## Transaction helper

`client.helpers.transaction` handles blockhashes, fee payers, and signing for you.

```ts
const prepared = await client.helpers.transaction.prepare({
  authority: walletSession,
  instructions: [instruction],
});

const signature = await client.helpers.transaction.send(prepared);
console.log(signature.toString());
```

- `prepare` builds a transaction message and refreshes the blockhash.
- `sign` / `toWire` let you collect signatures or emit Base64 manually.
- `send` submits the prepared transaction (or uses `signAndSend` if the wallet supports it).
- `prepareAndSend` runs everything plus an optional simulation/logging pass via `prepareTransaction`.
- Versions default to `0` automatically when any instruction references address lookup tables, otherwise `legacy`; pass `version` if you need to override.

Need just the tuning step? Call `client.prepareTransaction` directly with your unsigned message.

## Wallet helpers

Use `createWalletStandardConnector` to wrap Wallet Standard apps and register them with
`createWalletRegistry`. The registry powers `client.actions.connectWallet` and the React hooks
package, but you can also query it directly to build your own selectors.

## Scripts

- `pnpm build` – run JS compilation and type definition emit
- `pnpm test:typecheck` – strict type-checking without emit
- `pnpm lint` / `pnpm format` – Biome-powered linting and formatting
