# TCSwap

### _Integrate Blockchains easily_

## Usage

Documentation lives in the [`docs`](./docs) folder. To run it locally:

```bash
bun docs dev
```

## Packages

This repo contains the TCSwap SDK and its integrations with different blockchains:

| Package | Description |
| --- | --- |
| `@tcswap/sdk` | All-in-one SDK with default plugins and wallets |
| `@tcswap/core` | Core client for building a custom setup |
| `@tcswap/helpers` | Shared helpers, config, API clients and `AssetValue` |
| `@tcswap/types` | Shared types |
| `@tcswap/toolboxes` | Low-level chain toolboxes (EVM, UTXO, Cosmos, Solana, ...) |
| `@tcswap/plugins` | Swap provider plugins (THORChain, Maya, Chainflip, ...) |
| `@tcswap/wallets` | All wallet integrations |
| `@tcswap/wallet-core` | Base utilities for building wallets |
| `@tcswap/wallet-extensions` | Browser extension wallets |
| `@tcswap/wallet-hardware` | Hardware wallets (Ledger, Trezor, KeepKey) |
| `@tcswap/wallet-keystore` | Keystore / phrase wallet |
| `@tcswap/wallet-mobile` | Mobile wallets |
| `@tcswap/tokens` | Token lists |
| `@tcswap/contracts` | Contract ABIs |
| `@tcswap/ui` | React UI components and swap widget |
| `@tcswap/browser` | Browser SDK |
| `@tcswap/server` | Server SDK |

## Contributing

### Quick start

Requires [Bun](https://bun.sh) 1.3.1 or newer:

```bash
curl -fsSL https://bun.sh/install | bash
```

Then:

```bash
git clone https://github.com/thorchain/TCSwap.git
cd TCSwap
bun install      # installs dependencies and the git hooks
bun build:ci     # builds all packages (needed for playgrounds and docs)
bun test         # runs all tests
```

### Environment

Copy `.env.example` to `.env`. It has one variable, `TEST_PHRASE`: a mnemonic used by some toolbox and keystore tests and by the `bun-backend` playground. Use a throwaway test phrase, never one that holds real funds.

### Repo layout

- `packages/` - the published `@tcswap/*` packages (see the table above)
- `playgrounds/` - example apps (Vite, Next.js, Bun + React, Bun backend)
- `docs/` - documentation site (Astro Starlight); pages are in `docs/src/content/docs`
- `tools/` - internal build tooling

### Development

```bash
bun type-check   # type-check all packages
bun lint         # format and lint with Biome (fixes files in place)
bun test         # run all tests
bun build:ci     # rebuild all packages
```

To work on a single package, run the same commands from its folder, e.g.:

```bash
cd packages/helpers
bun test
bun type-check
```

If your install gets into a bad state, `bun bootstrap` does a full clean rebuild. Note that it deletes `node_modules` and `bun.lock` before reinstalling, so check `bun.lock` changes before committing.

#### Playgrounds

Build the packages first (`bun build:ci`), then:

```bash
bun playground:vite dev
bun playground:next dev
bun playground:react-bun dev
bun playground:backend-bun dev
```

#### Docs

```bash
bun docs dev
```

#### Branches

- `main` - the only long-lived branch. Create your branch from `main`.

#### Pull requests

- PRs should target the `main` branch
- PRs should be reviewed by at least one Code Owner (see the `.github/CODEOWNERS` file)
- PRs should have tests if possible
- PRs should include a changeset file if they change a published package (see the release section)

Report bugs and request features in [GitHub issues](https://github.com/thorchain/TCSwap/issues).

### Release and publish

Releases are done manually by the maintainers: after a PR is merged to `main`, the devs preview the changes and deploy.

We use [changesets](https://github.com/changesets/changesets) to track versions and changelogs. To describe your change, add a changeset file to your PR:

```bash
bun changeset
```

It asks which packages changed and whether each change is a patch, minor or major, then writes a short markdown file to `.changeset/`. Commit that file with your change.

### Attribution

This project is based on code from SwapKit, licensed under the Apache License 2.0. Our version contains modifications specific to TCSwap.
