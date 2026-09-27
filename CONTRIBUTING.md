# Contributing to ProtPeek

Issues and pull requests are welcome. Contributions are reviewed openly,
but nothing is merged or released without explicit approval from MOMISBACK.

## Before opening an issue

- Search existing issues first.
- Do not include private structures, credentials, access tokens, unpublished
  research data, or other sensitive material.
- For bugs, include the browser/version, reproducible steps, expected result,
  actual result, and the smallest safe fixture or identifier available.
- Use a GitHub Security Advisory instead of a public issue for a vulnerability
  that could put users at risk; see [SECURITY.md](./SECURITY.md).

## Pull requests

1. Open an issue first for a material behaviour, permission, privacy, or
   architecture change.
2. Fork the repository under a different project identity, create a focused
   branch, and keep the change small.
3. Install and validate the project:

   ```sh
   npm ci
   npm run typecheck
   npm run lint
   npm test
   npm run build:firefox
   npm run build:chrome
   npm run verify:build
   ```

4. Update tests and documentation for observable behaviour.
5. Explain any new network request, permission, persistent state, dependency,
   or meaningful performance cost in the pull request.

Passing automation is necessary but is not approval. MOMISBACK retains final
review, merge, release, and roadmap authority. Direct pushes from external
contributors are not accepted.

## Local-first invariant

Parsing, molecular analysis, article scanning, selection logic, and rendering
must remain on the user's device. ProtPeek has no project-operated backend,
analytics, or telemetry. Remote traffic is limited to an explicit user request
for structure data from the providers documented in [PRIVACY.md](./PRIVACY.md).
Any proposal that changes this invariant requires prior maintainer approval
and a transparent privacy/permission update.

## Licence and contribution rights

By submitting a contribution, you agree that it may be distributed under the
Mozilla Public License 2.0 and confirm that you have the right to contribute
it. Third-party code must be clearly identified and licence-compatible.

The MPL-2.0 applies to code, not to the reserved ProtPeek name and logo. See
[docs/TRADEMARKS.md](./docs/TRADEMARKS.md). A pull request does not authorise use of the
ProtPeek brand for a fork or modified distribution.
