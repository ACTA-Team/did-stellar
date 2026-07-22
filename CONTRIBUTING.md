# Contributing to did-stellar

Thank you for your interest in contributing to the `did:stellar`
implementation. This guide covers the basics for getting started.

## Prerequisites

- **Node.js** >=22.22.0 (see `.nvmrc`)
- **pnpm** >=9 (corepack: `corepack enable`)
- **Git** with hooks enabled (husky installs automatically on `pnpm install`)

## Setup

```bash
git clone https://github.com/ACTA-Team/did-stellar.git
cd did-stellar
pnpm install
pnpm run build
```

## Development workflow

```bash
pnpm run build        # Build SDK + API
pnpm run typecheck    # Type-check all packages
pnpm run lint         # Lint all packages (zero warnings allowed)
pnpm test             # Run all test suites
pnpm run format       # Format with Prettier
```

Run the API locally:

```bash
pnpm --filter did-stellar-api run dev
# http://localhost:8080/docs  (Swagger UI)
# http://localhost:8080/health
```

## Git hooks

Husky runs automatically after `pnpm install`:

- **Pre-commit** — `lint-staged` formats staged files with Prettier.
- **Pre-push** — runs `lint` + `typecheck`. Push is blocked if either
  fails.

## Project structure

```
did-stellar/
├── packages/
│   ├── resolver/   # @acta-team/did-stellar (SDK, published to npm)
│   └── api/        # did.acta.build (HTTP resolver, deployed to Railway)
└── docs/           # Method spec, SDK reference, API reference, error codes
```

## Conventions

- **TypeScript** — strict mode, zero `any`, `import type` enforced.
- **File naming** — kebab-case for all files and directories.
- **Import ordering** — enforced by `eslint-plugin-import-x`: Node
  builtins, external packages, internal modules, then types.
- **Tests** — Vitest, placed in a sibling `tests/` directory per
  package with `.test.ts` suffix.
- **Commits** — use [Conventional Commits](https://www.conventionalcommits.org/)
  (`feat:`, `fix:`, `docs:`, `chore:`, etc.).
- **No comments unless the "why" is non-obvious.** Code should be
  self-documenting through clear naming.

## Pull requests

1. Create a feature branch from `main`.
2. Make your changes and ensure `pnpm run build && pnpm run lint && pnpm run typecheck && pnpm test` all pass.
3. Sign off every commit (see [Developer Certificate of Origin](#developer-certificate-of-origin)).
4. Open a PR with a clear title and description.
5. PRs require passing CI before merge.

## Developer Certificate of Origin

`did:stellar` is a registered W3C DID method, and third parties run this code
in their own infrastructure. To keep the provenance of every contribution
auditable, we require a Developer Certificate of Origin
([DCO 1.1](https://developercertificate.org/)) sign-off on each commit.

Add it automatically with:

```bash
git commit -s -m "your message"
```

which appends the trailer:

```
Signed-off-by: Your Name <your.email@example.com>
```

By signing off you certify that you wrote the contribution, or otherwise have
the right to submit it under the project's license. Use your real name and an
email address you can be reached at. Commits without a sign-off will be asked
to amend before merge.

## Reporting issues

Open an issue at
[github.com/ACTA-Team/did-stellar/issues](https://github.com/ACTA-Team/did-stellar/issues).
Include the Node version, pnpm version, and steps to reproduce.

## License

By contributing, you agree that your contributions will be licensed
under the [Apache License, Version 2.0](./LICENSE), which includes an express
patent grant from each contributor. This matches the license of the
`did:stellar` specification and the `did-stellar-registry` contract in
[contracts-acta](https://github.com/ACTA-Team/contracts-acta).

Trademarks are not covered by the license — see [TRADEMARK.md](./TRADEMARK.md).
