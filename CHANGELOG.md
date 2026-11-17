# Changelog

All apps and the API share one version number, following [Semantic Versioning](https://semver.org): `MAJOR.MINOR.PATCH`.

- `0.x` — building towards launch; each phase is a minor version.
- `1.0.0` — public launch in Patna.

## [0.1.0] — Phase 0 · Foundations

### Added
- Monorepo with npm workspaces: `apps/api`, `apps/web-admin`, `apps/web-site`, `packages/tokens`, `packages/shared`.
- Style A (Clean Blue) design tokens and Tailwind preset.
- PostgreSQL schema via migrations: users and roles, OTP, refresh tokens, cities and zones, consents, blocks, attribution (tracked links, link events, attributions), scheduling foundations (availability, leave, calendar connections, slot holds, visits with a no-overlap constraint), audit log, app settings.
- Public `GET /api/v1/status` endpoint used by every app.
- Phone + OTP sign-in (MSG91; console provider in development), JWT access tokens and rotating refresh tokens.
- Onboarding attribution captured at sign-up (referral code, QR, UTM).
- Super admin seeded from server environment only; no API can create a super admin.
