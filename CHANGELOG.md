# Changelog

All apps and the API share one version number, following [Semantic Versioning](https://semver.org): `MAJOR.MINOR.PATCH`.

- `0.x` — building towards launch; each phase is a minor version.
- `1.0.0` — public launch in Patna.

## [0.7.0] — Phase 6 · Website and CMS · PhysioCare brand

### Brand
- **Renamed to PhysioCare by Healthtropic** everywhere users see it (website, console, apps, SMS-facing text, QR share
  text, starter content). The physio app is **PhysioCare Partner**. Internal package and database names are unchanged.
- **Logo "Care Cross in Motion"** drawn as SVG (`packages/tokens/brand.js`) with the four approved versions
  (full colour, reversed on Indigo, on dark, one colour). `npm run brand` regenerates every file from it:
  website and console favicons (SVG + 16/32 px with thicker strokes), Apple touch icon, PWA icons and manifests;
  patient app icon on Indigo and Partner app icon on Ink, Android adaptive foreground (inside the 66% safe zone),
  background and monochrome icons, splash screens, in-app marks.
- **Colours**: Indigo #5146D9 (primary), Lavender #8B7FF0, Ink #1F1A4D (text, dark surfaces), Mist #EFEDFD, applied
  through the shared tokens to both web apps, both mobile apps and the QR codes.
- **Font**: Plus Jakarta Sans on the website, console and both apps (apps load it before the splash screen hides).
- Logo in the website header and dark footer, console sidebar and sign-in, and the apps' welcome screens.

### Added (API)
- **Website CMS**: pages built from blocks (hero, text with simple formatting, image, video/YouTube, cards, steps,
  numbers, FAQ, testimonials, call to action, notice, and live lists of physios, service areas, pages and the
  Grievance Officer). Draft → publish (visitors only see published content), every save kept as a version and
  restorable, take offline, archive (super admin). Addresses used by the app can't be taken by pages.
- **Site settings**: name, tagline, support phone, WhatsApp, email, hours, address, announcement bar, header menu,
  footer columns, social links (starting values from `SITE_*` in `.env`).
- Public: `GET /api/v1/public/site`, `/public/page?path=`, `/public/pages?kind=`, `/public/physios` and
  `/public/physios/:id` (verified physios only; never phone, address or location), `/sitemap.xml`, `/robots.txt`.
- New **content editor** staff role (website only; no access to people or money data).
- Starter website (28 pages, published by `npm run api:seed` when missing): home, services and 7 service pages,
  conditions and 8 condition pages, how it works, about, FAQ, Patna, join as a physio, blog, and legal drafts
  (terms, privacy, refunds & cancellation, patient consent) marked **for legal review**.

### Added (apps)
- **Website**: every page now comes from the CMS (home included); physio directory with filters and profiles with
  reviews; menu from site settings with a mobile menu; announcement bar; footer with contact details and links;
  page titles, descriptions, social preview images and canonical links; draft preview for staff (`/preview`).
- **Console**: Website pages (list, editor with forms generated from the block definitions, image/video upload,
  search preview, versions) and Website settings.

### Fixed
- Photo attachments on "Report a problem" and complaints were refused by the file store (unknown purpose).

## [0.6.0] — Phase 5 · Control: super admin, blocks, zones, grievances

### Configuration
- **Every constant now lives in `.env`** (see each app's `.env.example`). API: OTP and tokens, check-in tries,
  slot step, drive time per km, zone hours per colour (`ZONE_HOURS_GREEN=07:00-20:00`, `closed`), coin rate,
  partner QR limit, same-device sign-up limit, Grievance Officer details and time limits, and the starting values
  of every console-editable setting (fees, TDS, holds, coins, rewards, scheduling, maintenance, app versions).
  `npm run api:seed` writes missing settings from `.env`; `SETTINGS_FROM_ENV=overwrite` makes `.env` win.
  Web apps: dev port, API address, status-check and chat refresh. Mobile apps: API address, status-check,
  chat refresh, location interval. Tests always use the built-in defaults.

### Added (API)
- **Blocks**: ops/city coordinators block patients, physios and partners with a reason and optional number of days;
  only a super admin can block staff; a super admin can't be blocked or block themselves. Blocking signs the person
  out everywhere and stops a physio taking new bookings. Timed blocks end by themselves. Unblock needs a note.
- **Personal blocks**: a physio can block a patient (and a patient a physio) they've had a booking with; they are never
  matched again; staff see every personal block.
- **Staff & roles** (super admin): give ops admin, finance, city coordinator or grievance committee by phone number;
  remove a role (signs them out). Super admin can't be given or removed through the API.
- **Zones**: add zones (centre + radius), change colour or area with a required reason, review date, full history.
  Only a super admin can turn a zone Red.
- **Platform settings** (super admin): maintenance mode with message, minimum app versions, scheduling rules
  (saved as a new version).
- **Audit log viewer** (super admin) with action filter.
- **Dashboard**: today's visits, queues needing action (SOS, verification, payments, incidents, refunds, partners,
  grievances and overdue ones, blocked), money (collected 7/30 days, outstanding, payouts, refunds, partner rewards
  due), growth, and a 14-day trend.
- **Grievance redressal**: public Grievance Officer details (`GET /api/v1/public/grievance-officer`, Dr Gunjan);
  anyone signed in files a complaint and gets a ticket (`GRV-2026-00001`), acknowledged within 24 h and resolved within
  15 days (from `.env`). Staff acknowledge, assign, add internal notes or replies, send to the committee, resolve or close.
  Harassment and safety complaints are visible only to the new **grievance committee** role and the super admin.

### Added (apps)
- **Admin console**: Dashboard (new home), Users (search, filter, detail with block/unblock and history), Blocked
  accounts (incl. physio ↔ patient blocks), Staff & roles, Zones, Grievances (list with due times, detail with timeline),
  Platform settings, Audit log. Scrollable sidebar.
- **Website**: Complaints & Grievance Officer page (`/grievance`), complaint thread with replies; footer links.
- **Patient app**: Complaints & Grievance Officer screen.
- **Physio app**: "Block this patient" on the visit screen.

## [0.5.0] — Phase 4 · Growth: partners, referrals and coins

### Added (API)
- **Partners** (doctors, hospitals, clinics, pathology labs, physiotherapists, pharmacies, gyms, others): apply from
  the website or be added by staff; ops approve, reject or suspend (QR codes stop working when suspended).
  Approval creates the main QR; partners can create up to 50 labelled QRs (e.g. "OPD reception").
- **Tracked links** `/r/:code`: every QR scan or link click is logged, then redirects to the website with the code,
  which is credited at sign-up (first valid source wins, locked at the first paid visit).
- **Coins** (10 coins = ₹1): welcome coins for anyone who joins through a link or QR; referrer coins when a friend's
  first visit is paid (once per friend); coins pay up to a set % of a booking (the physio still earns on the full
  price); coins come back if the booking is cancelled before it happens, and pro rata with a refund. Super admin can
  adjust a patient's coins with a reason (audit-logged). Flagged sign-ups get nothing.
- **Partner rewards**: a fixed amount per new patient's first paid visit (default or per partner); finance records the
  transfer reference and the partner is notified.
- Growth rules (super admin): welcome coins, referrer coins, max coin %, default partner reward.
  Defaults: 500, 1,000, 20%, ₹100.
- Attribution report: sign-ups and paying patients by source, top partners, top patient referrers, coins issued/redeemed.
- New settings: `PUBLIC_API_URL` (QR codes point here) and `SITE_URL` (where `/r/:code` sends people).

### Added (apps)
- **Admin console**: Partners (review, add directly, detail with QR codes to download, scans/sign-ups/paid per QR,
  approve with a custom reward, suspend, mark rewards paid), Where patients come from, Coins & rewards.
- **Website**: Refer & coins (balance, history, share via WhatsApp), "Use coins" at payment, partner portal at
  `/partner` (sign in, apply, QR codes to print, results, rewards, payout details).
- **Patient app**: Refer & coins screen, "Use coins" at payment.

## [0.4.0] — Phase 3 · Money and trust

### Added (apps)
- **Admin console**: Incidents (uphold with optional refund, or dismiss and unfreeze), Refunds (approve, reject,
  mark paid with the transfer reference), Payouts (build the weekly batch, mark each paid by bank/UPI with a reference),
  TDS report per physio and period with CSV download, Fees, TDS & holds (editable by super admin only).
- **Therapist app**: Earnings screen with available, on hold, frozen, paid and TDS totals, payouts and per-visit entries.
- **Website and patient app**: rate a completed visit (stars, tags, comment); report a problem with photos;
  My plans with sessions used and refund of unused sessions; messages with the physio per plan (refreshes every 5 s).
- `GET /bookings` now returns `plan_id` and `rated`.

### Added (API)
- Money rules (super admin only, audit-logged): platform fee %, TDS %, hold days, minimum payout, report window.
  Start at 0% fee and 0% TDS until the business decides; earnings keep the rates they were created with.
- Earnings ledger: one entry per completed visit once its payment is confirmed (either order). Package price is
  spread evenly; the last session takes the rounding remainder. Fee on gross, TDS on gross − fee, net = the rest.
- 7-day hold → available; physio wallet (available, on hold, frozen, paid, TDS, entries, payouts).
- Payouts: finance builds a batch (everyone with at least the minimum available), pays each physio by bank/UPI
  outside the app and records the reference; frozen earnings can't be paid out. TDS report per physio and period.
- Refunds of unused sessions: pro-rata estimate, request with refund-to details, ops/finance approve (future
  visits cancelled, plan ends) or reject, finance records the transfer reference. One open request per plan.
- Incidents within the report window freeze that visit's earning; upheld → reversed (+ optional refund), dismissed → unfrozen.
- Ratings on completed visits (stars, tags, comment); physio average updates.
- Chat per plan between patient and physio; phone numbers, UPI IDs, emails and off-app payment words are blocked
  and the attempt is logged for leakage review.

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
