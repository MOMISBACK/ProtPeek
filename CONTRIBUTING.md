# Contributing

Issues and pull requests are welcome.

For bug reports, include the browser/version, steps to reproduce, expected behaviour, actual behaviour, and a public structure identifier or minimal safe fixture when possible. Do not post credentials, private structures, unpublished research data, or other sensitive material.

For security issues, use the private reporting route described in [SECURITY.md](./SECURITY.md).

## Development

```sh
npm ci
npm run typecheck
npm run lint
npm test
npm run build:firefox
npm run build:chrome
npm run verify:build
```

Keep changes focused and add or update tests when behaviour changes.

ProtPeek is local-first: article scanning, local-file parsing, molecular processing, and rendering stay on the user's device. New remote requests, browser permissions, persistent storage, or dependencies should be clearly justified in the pull request.
