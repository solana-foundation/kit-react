# Maintaining Kit React

This document captures the release and publishing workflow for this repository.
It mirrors the process used in [`create-solana-dapp`](https://github.com/solana-foundation/create-solana-dapp).

## Changesets

- We use [Changesets](https://github.com/changesets/changesets) for semantic versioning.
- Any change that affects an npm package must include a changeset. Run
  `pnpm changeset`, select the touched packages, choose the semver bump, and add
  a short changelog entry.
- When PRs with pending changesets merge into `main`, the Changesets GitHub bot
  automatically opens a "Version Packages" PR that bumps package versions and
  updates CHANGELOG entries.

## Publishing flow

1. **Canary releases**  
   Every push to `main` triggers the `Publish Canary Releases` workflow. It runs
   lint/test/build, snapshots the repo with
   `pnpm changeset version --snapshot canary`, rebuilds, and publishes the
   changed packages under the `canary` npm tag. Consumers can install preview
   builds via `@solana/<package>@canary`.

2. **Stable releases**  
   When the bot-created "Version Packages" PR is merged, there are no remaining
   pending changesets. The `Version & Publish Packages` workflow detects this
   state and runs `pnpm publish-packages` (which resolves to
   `pnpm changeset publish`) to push the new versions to npm with the `latest`
   tag.

## Operational requirements

- Define the `NPM_TOKEN` repository secret with publish rights to the
  `@solana/*` packages.
- The default `GITHUB_TOKEN` is used for bot PRs and for canary snapshot
  tagging; no extra PAT is required.
- If you need to trigger releases manually, run the corresponding workflow via
  the "Run workflow" button in the Actions tab.
