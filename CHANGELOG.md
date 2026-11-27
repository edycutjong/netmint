# Changelog

All notable changes, generated from Conventional Commits by `scripts/release.mjs`.

## 1.1.5 (2026-11-27)

### Bug fixes

- **api:** /api/health says there is no scheduled refresh, instead of a null cron field (8d5f5cd)
- **ui:** the home card's link to the per-stock page keeps the card's window (0140cb3)

## 1.1.4 (2026-11-27)

### Bug fixes

- **proof:** the missing-day line says what the chain check covers (05f6673)
- **ui:** a pinned answer presses no window chip; the earlier-answer note dates stored bodies (394b040)
- **proof:** days missing inside a verified window are listed under the proof rows (3dcbe65)
- **stored:** skip_invalid is not part of what a stored info body answers (4ab0f2f)
- **chain:** a reverted eth_call costs its own read, not every wrapper on the chain (a3ef1c3)

## 1.1.3 (2026-11-27)

### Bug fixes

- **ui:** a stored answer carries its capture date, a failed run labels the card it leaves (e46a8f7)
- **proof:** show the trial that decided the verdict beside the 1-day proof rows (8271283)
- **stored:** a wrapper listed after the capture no longer voids the stored fallback (543afb8)
- **chain:** ride out the RPC rate cap, keep one dead address from voiding a chain, label mixed sources (c55a44c)
- **cmc:** one wrapper id that info rejects no longer fails the whole lookup (7ae4e9d)
- **api:** a window date that is not a real calendar day is a 400 (a5e9052)

## 1.1.2 (2026-11-23)

### Bug fixes

- **copy:** app description says units created or redeemed, not dollars (ad9d776)

## 1.1.1 (2026-11-23)

### Bug fixes

- **site:** landing trial counts live CMC calls apart from stored bodies and marks a 60 s repeat as the first run's figures; copy buttons report a refused clipboard (fedcadc)
- **scripts:** chain-supply names files only from well-formed EVM addresses; one read instead of exists-then-read (39091c1)

## 1.1.0 (2026-11-22)

### Features

- judge page at /judge, a 30-second path to the live NVDAB verdict (6384b95)
- fire-assay redesign of the landing (/about) and the pitch deck (/pitch) (23db0d2)

### Bug fixes

- price change and failed step checks no longer use the redemption red (e92d40d)

## 1.0.1 (2026-11-22)

### Dependencies

- bump @types/node from 22.20.5 to 26.6.6 (#6) (e55590d)

