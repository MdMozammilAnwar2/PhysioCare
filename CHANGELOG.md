# Changelog

All apps and the API share one version number, following [Semantic Versioning](https://semver.org): `MAJOR.MINOR.PATCH`.

- `0.x` — building towards launch; each phase is a minor version.
- `1.0.0` — public launch in Patna.

## [0.2.0] — Phase 1 · Patient books and pays

### Added
- Patient profile, addresses mapped to zones, consents.
- Therapist profiles, per-mode prices and packages.
- Matching (top 3): verified and accepting physios only, patient's gender preference never broken,
  gender safety rule (woman + male physio only with a named family member present and recorded consent),
  physio's own "female patients only" setting, service radius, personal blocks; ranked by speciality, rating, distance, tier.
- Scheduling engine: availability rules, leave, external busy blocks, live visits and unexpired holds,
  travel time between home visits (3 min/km + 10 min buffer), zone hours (Orange 8 AM–6 PM, Red closed), 3-hour notice, 60-day window, daily cap.
- Booking: slot hold (10 min) → Razorpay order → checkout signature verification or webhook → plan active, visit booked,
  invoice number, notification, attribution credit locked. Idempotent; late payments flag "pick a new time".
- Fake payment provider for development and tests (same signature scheme as Razorpay).
- Website booking flow: sign in with OTP (referral code and UTM captured), About you + consents, home or video,
  area and zone check, top 3 physios with the family-present option, day and time, plan, Razorpay checkout, confirmation, My bookings.
- Patient mobile app (Expo SDK 58, Expo Router): welcome, OTP sign-in with referral code, About you and consents,
  home or video with zone check, top 3 with family-present option, day/time and plan with gender-rule consent,
  confirmation, bookings; status check with maintenance, offline and forced-update screens; tokens in SecureStore.
- All web and mobile apps on React 19.3 (one React version across the monorepo).

### Known gaps
- In-app Razorpay checkout needs a custom Expo development build (react-native-razorpay); until then the app asks
  patients to pay on the website when real keys are set. The development payment simulator works in all apps.
- Drive time is estimated (3 min/km + 10 min); Google Maps distance matrix comes later.
- Zones are centre + radius until they can be drawn in the console.
- Physio-side consent for the gender rule is recorded as needed; the physio app asks for it in Phase 2.
- Public `GET /api/v1/zones`; development-only payment simulator and demo physios (`npm run api:seed:demo`).

## [0.1.0] — Phase 0 · Foundations

### Added
- Monorepo with npm workspaces: `apps/api`, `apps/web-admin`, `apps/web-site`, `packages/tokens`, `packages/shared`.
- Style A (Clean Blue) design tokens and Tailwind preset.
- PostgreSQL schema via migrations: users and roles, OTP, refresh tokens, cities and zones, consents, blocks, attribution (tracked links, link events, attributions), scheduling foundations (availability, leave, calendar connections, slot holds, visits with a no-overlap constraint), audit log, app settings.
- Public `GET /api/v1/status` endpoint used by every app.
- Phone + OTP sign-in (MSG91; console provider in development), JWT access tokens and rotating refresh tokens.
- Onboarding attribution captured at sign-up (referral code, QR, UTM).
- Super admin seeded from server environment only; no API can create a super admin.
