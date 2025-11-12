# Contributing

Thanks for your interest in helping! This project is an experimental Solana SDK, and we value contributions that respect the community and keep the codebase healthy.

## Code of Conduct & Ethics

- Be respectful and welcoming. Harassment or discrimination of any kind is not tolerated.
- Act transparently. Disclose conflicts of interest and avoid sharing sensitive data.
- Contribute original work or clearly mark external sources with proper attribution.

## Prerequisites

- **Node.js** ≥ 24 (LTS) and **pnpm** ≥ 10.20.0.
- Clone the repo and install dependencies with `pnpm install`.
- Familiarity with Turborepo, Biome, and Vitest helps—see `README.md` for local workflows.

## Development Workflow

1. Create a feature branch from `main`.
2. Run `pnpm format`, `pnpm lint`, `pnpm typecheck`, and `pnpm test` before submitting.
   - A Husky pre-commit hook automatically runs `pnpm exec biome check --staged --no-errors-on-unmatched` so commits only land when Biome formatting and lint checks pass.
3. Keep changes focused; open separate PRs for unrelated fixes.
4. Write tests when adding or modifying functionality.
5. Open a pull request with a clear summary and note any follow-up work.

## Versioning & Changesets

- Any change that impacts a published package (e.g., `@solana/client`,
  `@solana/react-hooks`) must include a Changeset entry. Run `pnpm changeset`
  and follow the prompts to record the bump type and changelog note.
- Multiple commits can reference the same changeset; it only needs to exist once
  in the PR.
- When the PR merges, the automated release workflow will collect these
  entries, open a "Version Packages" PR, and eventually publish the new versions
  to npm.

## Commit & PR Guidelines

- Follow conventional commits when possible (e.g., `feat:`, `fix:`, `docs:`).
- Ensure CI passes; the Biome workflow enforces linting on every PR.
- Include screenshots or recordings for UI tweaks when practical.

## Reporting Issues

- Use the issue tracker for bugs or feature requests.
- Provide reproduction steps, expected vs. actual behavior, and environment details.
- Be patient and courteous—maintainers review issues and PRs as time allows.

We appreciate your contribution to the Solana SDK ecosystem!
