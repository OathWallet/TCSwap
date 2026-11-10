# TCSwap

### _Integrate Blockchains easily_

## Usage

Documentation lives in the [`docs`](./docs) folder. To run it locally:

```bash
bun docs dev
```

## Packages

This repo contains packages around TCSwap sdk and its integrations with different blockchains:

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

#### Pre-requisites

1. Install [Bun](https://bun.sh):

```bash
curl -fsSL https://bun.sh/install | bash
```

2. Copy `.env.example` to `.env` and fill it with data.

### Installation

```bash
bun bootstrap
```

### Development

```bash
bun type-check   # type-check all packages
bun lint         # format and lint with Biome
bun test         # run tests
```

#### Playgrounds

```bash
bun playground:vite dev
bun playground:next dev
bun playground:react-bun dev
bun playground:backend-bun dev
```

#### Branches

- `main` - the only long-lived branch. Create your branch from `main`.

#### Pull requests

- PRs should target the `main` branch
- PRs should be reviewed by at least one Code Owner (see the `.github/CODEOWNERS` file)
- PRs should have tests if possible
- PRs should include a changeset file if they change a published package (see the release section)

Lint and type-check run automatically on commit via `lefthook`.

### Release and publish

Releases are done manually by the maintainers: after a PR is merged to `main`, the devs preview the changes and deploy.

We use [changesets](https://github.com/changesets/changesets) to track versions and changelogs. To describe your change, add a changeset file to your PR:

```bash
bun changeset
```

### Attribution

This project is based on code from SwapKit, licensed under the Apache License 2.0. Our version contains modifications specific to TCSwap
