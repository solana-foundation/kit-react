# @solana/example-react-hooks

Demonstrates how to build a React interface with the experimental `@solana/react-hooks` package.

The example mirrors the vanilla proof-of-concept by wiring wallet discovery, SOL transfers, SPL token helpers, and live balance updates through idiomatic React components.

## Compute-unit tuned transactions

`useTransactionPool` now exposes the same `prepareAndSend` helper that lives in `@solana/client`. You can surface compute-unit simulation plus logging in a single call:

```tsx
import { useMemo } from 'react';
import { useTransactionPool, useWalletSession } from '@solana/react-hooks';

const MEMO_PROGRAM = 'Memo111111111111111111111111111111111111111';

export function MemoWithTelemetryButton() {
	const session = useWalletSession();
	const instruction = useMemo(() => {
		if (!session) {
			return null;
		}
		return {
			accounts: [
				{ address: session.account.address, isSigner: true, isWritable: false },
			],
			data: new TextEncoder().encode('hello from hooks'),
			programAddress: MEMO_PROGRAM,
		};
	}, [session]);
	const pool = useTransactionPool({ instructions: instruction ? [instruction] : [] });

	return (
		<button
			disabled={!session || pool.isSending}
			onClick={() =>
				pool.prepareAndSend(
					{
						authority: session,
						prepareTransaction: {
							computeUnitLimitMultiplier: 1.25,
							logRequest: ({ base64WireTransaction }) =>
								console.debug('tx wire payload', base64WireTransaction),
						},
					},
					{ commitment: 'confirmed' },
				)}
		>
			{pool.isSending ? 'Sending memo…' : 'Send memo with CU tuning'}
		</button>
	);
}
```

The hook takes care of building instructions, simulating to determine compute units, logging the Base64 wire transaction, and finally sending the tuned transaction.

## Developing

```sh
pnpm install
pnpm --filter @solana/example-react-hooks dev
```

The app runs against Devnet by default. Press <kbd>o</kbd> + <kbd>Enter</kbd> in the terminal to open a browser window once Vite starts.

## Building

```sh
pnpm --filter @solana/example-react-hooks build
```

The production bundle is emitted to `dist/`.
