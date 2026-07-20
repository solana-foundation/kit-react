---
"@solana/client": minor
---

Upgrade `@solana/kit` and the related `@solana/*` packages to `v7`.

- **Transaction planner default changed:** Kit v7 lowers the default
  `maxInstructionsPerTransaction` from 64 to 16. The transaction helpers adopt this
  new default, so preparing a transaction whose instructions no longer fit in a single
  message (previously up to 64 instructions) will now produce a multi-transaction plan
  and throw. Callers relying on the old limit should split their instructions.
- Kit v7 adds transaction version `1` to `TransactionVersion`, which
  `createTransactionMessage` does not accept (it only supports
  `Exclude<TransactionVersion, 1>`). The transaction helpers now type their `version`
  inputs with a new `SupportedTransactionVersion` alias to reflect the versions they
  actually support.
