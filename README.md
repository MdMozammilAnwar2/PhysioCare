# PhysioCare by Healthtropic

Verified physiotherapy at home in Patna: zone-aware booking, safety rules for every visit, cash and UPI payments,
video sessions, referrals and partners, and a full staff console.
Version **1.0.0 · Patna launch**. See [CHANGELOG.md](CHANGELOG.md), [docs/LAUNCH.md](docs/LAUNCH.md) and
[docs/SECURITY.md](docs/SECURITY.md).

## Apps

| Path | App | Who uses it |
| --- | --- | --- |
| `apps/web-site` | Website: content from the CMS, booking, bookings, plans, refunds, chat, coins, partner portal, complaints | Patients, doctors and hospitals |
| `apps/web-admin` | Staff console: dashboard, live visits & SOS, verification, payments, money, partners, website CMS, zones, users & blocks, grievances, messages, calendar, settings, audit log | Staff (by role) |
| `apps/mobile-patient` | **PhysioCare** app (Expo SDK 58) | Patients |
| `apps/mobile-therapist` | **PhysioCare Partner** app | Physiotherapists |
| `apps/mobile-admin` | **PhysioCare Admin** app: SOS, live visits, approvals | Staff on the go |
| `apps/api` | REST API (Node 24, Express, PostgreSQL via Sequelize), migrations, tests | Everything above |
| `packages/tokens` | Brand: colours, Plus Jakarta Sans, the Care Cross logo (`brand.js`), Tailwind preset | All apps |
| `packages/shared` | Roles, CMS block definitions, shared constants, app version | All apps |
| `deploy/` | Production: Dockerfile, Caddy (HTTPS), docker compose, nightly backups | The server |

## Run it on your computer

Needs Node 20+ and Docker Desktop.

```bash
npm install
npm run db:up                  # PostgreSQL on :5434
cp apps/api/.env.example apps/api/.env
npm run api:migrate
npm run api:seed               # cities, Patna zones, starter website, super admin from SUPER_ADMIN_PHONE
npm run api:seed:demo          # development only: demo physios, staff, patient and partner sign-ins
npm run api:dev                # http://localhost:4000
npm run site:dev               # http://localhost:5173
npm run admin:dev              # http://localhost:5174
npm run patient:dev            # Expo; set EXPO_PUBLIC_API_URL in each app's .env
npm run therapist:dev
npm run admin-app:dev
npm test                       # API tests against a real PostgreSQL
npm run api:check              # what's still missing before launch
npm run brand                  # regenerate every logo, icon, splash and share image
```

Sign in with any demo number (e.g. `9000000011` ops admin, `9000000021` patient, `9000000001` physio). In
development no SMS is sent: the code is shown on the sign-in screen and printed in the API terminal.

## Configuration

Every setting and business constant lives in each app's `.env` (start from `.env.example`). Settings also editable in
the console (fees, coins, scheduling, website, maintenance…) take their first value from `.env` when you run
`npm run api:seed`. Services switch on when their keys are added: MSG91 (SMS/WhatsApp), Expo push, Google Maps,
Google Calendar, Calendly, Exotel (masked calls), Jitsi (video).

## Super admin

No sign-up, API or screen can create, give, remove or block a super admin. Set `SUPER_ADMIN_PHONE` on the server and
run the seed; the account then signs in with OTP and gives staff roles in Staff & roles.

## Go live

Follow [docs/LAUNCH.md](docs/LAUNCH.md): server and DNS, secrets, `docker compose -f deploy/docker-compose.prod.yml up -d`,
app store builds with EAS, the business checklist, backups, monitoring and the go-live test.
