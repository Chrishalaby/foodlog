# Contributing

Thanks for helping. A few things keep reviews quick:

- **Bugs and ideas:** open an issue with steps to reproduce, or what problem the idea solves.
- **Pull requests:** keep each one to a single change. Run `npm run typecheck` and `npm test` before pushing, and
  `npm run test:e2e` when the API changes. CI runs all three.
- **Local setup:** see [Local development](README.md#local-development). `AI_PROVIDER=mock` in `.env` gives
  simulated AI results, so you need no API key.
- **Style:** match the surrounding code. Shared types and nutrition math live in `packages/shared`, used by both apps.

Contributions are accepted under the project's license, the [GNU AGPL v3.0 or later](LICENSE).
