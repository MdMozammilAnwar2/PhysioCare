# Changelog

All apps and the API share one version number, following [Semantic Versioning](https://semver.org): `MAJOR.MINOR.PATCH`.

- `0.x` — building towards launch; each phase is a minor version.
- `1.0.0` — public launch in Patna.

## [0.3.0] — Phase 2 · Therapist and the visit

### Added (apps)
- **Admin console**: role-based navigation; verification queue and physio review (profile, signed agreement,
  document viewer for images/PDF/video, approve/reject each document, verify or send back with a note);
  payments to confirm (UPI UTR + screenshot, cash; approve/reject); live visits with SOS banner, acknowledge,
  resolve and map links, refreshing every 15 s.
- **Therapist app** (`apps/mobile-therapist`, Expo SDK 58): OTP sign-in as a physio; onboarding (profile, what
  you treat, languages, start area and service radius, female-patients-only); six documents (selfie with the
  front camera); partner agreement v2.1 signature and submit; verification status with rejected-document notes;
  hours and prices; schedule with consent requests (accept/decline) and visits; visit screen with directions,
  "I'm on the way", check-in code (+ family-present confirmation), "nobody present", session notes, cash
  received, and a hold-to-send SOS. Location is shared every 60 s only while on the way or in session.

### Added (API)
- Therapist onboarding: profile and service area, six required documents (stored in the file store),
  partner agreement v2.1 signature, submit for review.
- Admin verification: queue, therapist detail with documents and agreement, approve or reject each document
  (reason required), verify only when every document is approved. Audit-logged; the physio is notified.
- Therapist practice: weekly hours (several blocks per day, per visit type) and prices.
- Visit lifecycle: on the way → check-in with the patient's 4-digit code (derived, never stored; shown to the
  patient only on the visit day; locked after 5 wrong tries) → live location (only during a visit) → complete with
  session notes (pain, measurements, exercises, notes, home plan). Patients can read their notes.
- Gender safety consent: a male physio must accept before visiting a woman patient (name and address hidden until
  he does); declining cancels the visit and voids the payment; at check-in he must confirm the family member is
  present, or report "nobody present" (visit moved free).
- SOS from the physio (with location); ops live screen of visits in progress and open SOS, acknowledge
  (response time logged) and resolve with a note.

## [0.2.1] — Payments: Cash + UPI-QR · File storage

### Changed
- Payments no longer use Razorpay. Two methods: **Cash** at the visit and **UPI** by scanning PhysioConnect's QR.
  - Picking a method confirms the booking at once; the payment stays `pending` with a reference like `PC-7K3M9Q`.
  - UPI: the patient sees a QR for the exact amount (also an "Open UPI app" link), pays, then sends the UPI
    reference (UTR) and/or a screenshot → `submitted`. A UTR can be used only once.
  - Cash: the physio marks "cash received" → `submitted`.
  - Ops / finance / super admin approve or reject in a queue; approval issues the invoice number, notifies the patient
    and locks referral credit. Every decision is in the audit log.
  - UPI stays off until `PAYMENT_UPI_ID` is set and `npm run api:seed` is run.
- Website and patient app: "How will you pay?" step, payment page with QR, reference, UTR and screenshot upload,
  payment status on My bookings.

### Added
- **File storage API** (`/api/v1/files`): upload (multipart), list, metadata, view/download, hide.
  Files are kept permanently (hide, never delete), with owner, purpose, size and SHA-256 checksum.
  Content is checked against the claimed type (JPG, PNG, WEBP, HEIC, PDF up to 15–25 MB; MP4, MOV up to 200 MB).
  Private by default (owner + staff); only staff can publish public files (website images and videos).
  Local disk now (`STORAGE_DIR`), S3-compatible storage can be added behind the same interface.

### Removed
- Razorpay checkout, webhook, development payment simulator and their settings.

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
