# PhysioConnect by Healthtropic

Verified physiotherapy at home, matched by zone, safety rules and recovery needs.
Version **0.1.0 · Phase 0 (Foundations)**. See [CHANGELOG.md](CHANGELOG.md).

## Repository

| Path | What it is |
| --- | --- |
| `apps/api` | Node.js + Express REST API, PostgreSQL via Sequelize, migrations, tests |
| `apps/web-admin` | Admin console (React + Vite + Tailwind) — super admin, ops, finance, city coordinator |
| `apps/web-site` | Public website and web booking (React + Vite + Tailwind) |
| `packages/tokens` | Style A (Clean Blue) design tokens + Tailwind preset, shared by every app |
| `packages/shared` | Roles, zone colours, attribution sources, visit statuses, app version |

Mobile apps (patient, therapist, partner, super admin — React Native) are added in Phase 1.

## Run it locally

Needs Node 20+ and Docker Desktop.

```bash
npm install
npm run db:up                         # Postgres 17 + PostGIS on :5434, Redis on :6380
cp apps/api/.env.example apps/api/.env   # then set JWT_ACCESS_SECRET and OTP_SECRET
npm run api:migrate
npm run api:seed                      # cities, Patna zones, and the super admin (see below)
npm run api:dev                       # http://localhost:4000
npm run admin:dev                     # http://localhost:5174
npm run site:dev                      # http://localhost:5173
npm test                              # API tests against a real Postgres
```

In development, `SMS_PROVIDER=console` prints OTP codes in the API log instead of sending SMS.

## Super admin

There is no sign-up, API or screen that creates a super admin. Set `SUPER_ADMIN_PHONE` (and optionally
`SUPER_ADMIN_NAME`) in the server environment and run `npm run api:seed`. The account then signs in with OTP.

## API (v1)

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| GET | `/api/v1/status` | public | Overall status, services, maintenance, minimum app versions, version. Every app checks it on start and every 60 s |
| POST | `/api/v1/auth/otp/send` | — | Send a 6-digit code (30 s resend gap, 5 per 15 min) |
| POST | `/api/v1/auth/otp/verify` | — | Sign in or sign up. Optional `role` (patient, therapist, partner_owner), `ref` (referral / QR code), `utm`, `deviceId`, `selfReported` |
| POST | `/api/v1/auth/refresh` | — | Rotate refresh token; reuse of an old token ends the whole session |
| POST | `/api/v1/auth/logout` | — | Revoke the session |
| GET / PATCH | `/api/v1/me` | Bearer | Current user, roles, how they joined |

## Versioning

[Semantic Versioning](https://semver.org): `MAJOR.MINOR.PATCH`, one version for every app and the API.
`0.1.0` Phase 0 · `0.2.0`–`0.6.0` Phases 1–5 · `1.0.0` public launch in Patna.
