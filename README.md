# PhysioConnect by Healthtropic

Verified physiotherapy at home, matched by zone, safety rules and recovery needs.
Version **0.2.0 · Phase 1 (Patient books and pays)**. See [CHANGELOG.md](CHANGELOG.md).

## Repository

| Path | What it is |
| --- | --- |
| `apps/api` | Node.js + Express REST API, PostgreSQL via Sequelize, migrations, tests |
| `apps/web-admin` | Admin console (React + Vite + Tailwind) — super admin, ops, finance, city coordinator |
| `apps/web-site` | Public website and web booking (React + Vite + Tailwind) |
| `apps/mobile-patient` | Patient app (React Native, Expo SDK 58, Expo Router) |
| `packages/tokens` | Style A (Clean Blue) design tokens + Tailwind preset, shared by every app |
| `packages/shared` | Roles, zone colours, attribution sources, visit statuses, app version |

Therapist, partner and super admin mobile apps come in later phases.

## Run it locally

Needs Node 20+ and Docker Desktop.

```bash
npm install
npm run db:up                         # Postgres 17 + PostGIS on :5434, Redis on :6380
cp apps/api/.env.example apps/api/.env   # then set JWT_ACCESS_SECRET and OTP_SECRET
npm run api:migrate
npm run api:seed                      # cities, Patna zones, and the super admin (see below)
npm run api:seed:demo                 # development only: 3 verified demo physios to book
npm run api:dev                       # http://localhost:4000
npm run admin:dev                     # http://localhost:5174
npm run site:dev                      # http://localhost:5173
npm test                              # API tests against a real Postgres
npm run patient:dev                   # Expo dev server; set EXPO_PUBLIC_API_URL in apps/mobile-patient/.env
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
| GET | `/api/v1/zones?city=Patna` | public | Zones with colour and centre |
| GET / PUT | `/api/v1/patient/profile` | patient | Condition, procedure, preferences |
| GET / POST | `/api/v1/patient/addresses` | patient | Addresses; POST returns the zone |
| POST | `/api/v1/patient/consents` | patient | Record consents |
| POST | `/api/v1/therapists/match` | patient | Top 3 physios (gender rule, zone, radius) |
| GET | `/api/v1/therapists/:id`, `/:id/slots` | signed in | Profile, prices, packages; free slots |
| POST | `/api/v1/bookings/hold` | patient | Hold a slot and create the payment order |
| GET | `/api/v1/bookings` | patient | My bookings |
| POST | `/api/v1/payments/razorpay/verify`, `/webhook` | patient / Razorpay | Confirm payment (idempotent) |
| GET | `/api/v1/notifications` | signed in | In-app notifications |

## Versioning

[Semantic Versioning](https://semver.org): `MAJOR.MINOR.PATCH`, one version for every app and the API.
`0.1.0` Phase 0 · `0.2.0`–`0.6.0` Phases 1–5 · `1.0.0` public launch in Patna.
