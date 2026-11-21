# Security Policy

## Supported versions

| Version | Supported |
| ------- | --------- |
| 1.x     | yes       |
| < 1.0   | no        |

## Reporting a vulnerability

Please do not open a public issue. Use GitHub's private reporting: **Security → Report a vulnerability** on this repository.
You should get an acknowledgement within 72 hours.

Scope notes: the CoinMarketCap key and the RPC key are server-side only (Vercel environment variables). If you find either in the
tree, the build output or any API response, that is a vulnerability — please report it. CI runs gitleaks over the full history,
CodeQL on every push and weekly, `npm audit` (fail on high), and Dependabot for npm and GitHub Actions.
