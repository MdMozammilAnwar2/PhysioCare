# PhysioCare launch guide (v1.0 · Patna)

Everything needed to put PhysioCare live on your own domain, in order. Commands run on the server unless it says
"your computer". `npm run api:check` tells you at any time what is still missing.

---

## 1. Server and domain (day 1)

1. **Server:** one Linux server in India (Ubuntu 24.04, 2 vCPU, 4 GB RAM, 80 GB disk is plenty for launch),
   e.g. AWS Mumbai (ap-south-1), DigitalOcean/Linode Bangalore, or E2E Networks. Keeping data in India suits the
   DPDP Act.
2. **Install Docker:** `curl -fsSL https://get.docker.com | sh`
3. **Firewall:** allow only ports 22 (SSH, preferably from your IP only), 80 and 443.
4. **DNS** at your domain provider — three **A records** pointing to the server's IP:
   | Name | Example | Used for |
   |---|---|---|
   | `@` (and `www`) | `physiocare.in` | Website |
   | `admin` | `admin.physiocare.in` | Staff console |
   | `api` | `api.physiocare.in` | Apps, QR codes, webhooks, calendar links |

## 2. Secrets and settings

On the server:
```bash
git clone https://github.com/MdMozammilAnwar2/PhysioCare.git && cd PhysioCare
cp deploy/.env.example deploy/.env          # domains, database password, certificate email
cp apps/api/.env.example deploy/api.env     # every API setting
openssl rand -hex 32                        # run 4 times: JWT_ACCESS_SECRET, OTP_SECRET, CALENDAR_TOKEN_KEY, POSTGRES_PASSWORD
```
Edit `deploy/.env` (domains, `POSTGRES_PASSWORD`, `ACME_EMAIL`) and `deploy/api.env`. The minimum to start:

| Setting | Value |
|---|---|
| `JWT_ACCESS_SECRET`, `OTP_SECRET`, `CALENDAR_TOKEN_KEY` | three different random strings (never change `CALENDAR_TOKEN_KEY` later) |
| `SMS_PROVIDER` / `MSG91_AUTH_KEY` / `MSG91_OTP_TEMPLATE_ID` | `msg91` and your DLT-approved OTP template |
| `PUBLIC_API_URL` | `https://api.physiocare.in` — **printed on every QR code; set before printing** |
| `SITE_URL` | `https://physiocare.in/` |
| `CORS_ORIGINS` | `https://physiocare.in,https://admin.physiocare.in` |
| `SUPER_ADMIN_PHONE` / `SUPER_ADMIN_NAME` | your real number and name |

`DATABASE_URL`, `STORAGE_DIR` and `WEB_SITE_DIST` are set by Docker; leave them out of `api.env`.

## 3. Start

```bash
docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env up -d --build
docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env exec api node scripts/check.js   # launch check
docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env exec api node scripts/seed.js    # cities, zones, website pages, super admin
```
- The API **refuses to start** in production while a blocker remains (weak secrets, development SMS, localhost
  addresses, default database password, placeholder super admin). `docker compose … logs api` shows what to fix.
- HTTPS certificates are issued automatically on the first visit to each domain (DNS must point to the server first).
- Never run `seed-demo` on the server; it refuses in production.
- Open `https://admin.physiocare.in`, sign in with `SUPER_ADMIN_PHONE`, then **Staff & roles** to add your team.

## 4. Apps (Play Store and App Store)

On your computer, once per app (`apps/mobile-patient`, `apps/mobile-therapist`, `apps/mobile-admin`):
```bash
npm i -g eas-cli && eas login
eas init                      # creates the EAS project id (needed for push notifications)
# edit eas.json: set EXPO_PUBLIC_API_URL to https://api.<your-domain> in both profiles
eas build --profile preview --platform android     # installable test APK to try on phones
eas build --profile production --platform all      # store builds
eas submit --profile production --platform android # needs google-play-service-account.json
eas submit --profile production --platform ios
```
Then set `PUSH_PROVIDER=expo` in `deploy/api.env`.

**Store listings need:** privacy policy URL (`https://<domain>/legal/privacy`), support email, screenshots,
Play "Data safety" form (phone number, name, address/location, health info you choose to share, photos you upload;
data encrypted in transit; account deletion on request through the Grievance Officer), and a test account for the
reviewers (create one in Staff & roles or as a patient with a number you control).

| App | Name | Who installs it |
|---|---|---|
| `mobile-patient` | PhysioCare | Patients |
| `mobile-therapist` | PhysioCare Partner | Physiotherapists |
| `mobile-admin` | PhysioCare Admin | Your staff only — publish as an internal/unlisted app |

## 5. Business checklist before the first patient

| # | Item | Where |
|---|---|---|
| 1 | **Legal pages reviewed by a lawyer** (terms, privacy, refunds, patient consent) | Console › Website pages › Legal |
| 2 | **Grievance Officer** email (and phone) — legally required to be public | `GRIEVANCE_OFFICER_EMAIL` in `api.env` |
| 3 | **UPI ID** patients pay to | `PAYMENT_UPI_ID` → run seed again |
| 4 | **Platform fee and TDS** — confirm the TDS section and rate with your CA | Console › Fees, TDS & holds |
| 5 | **Support phone, WhatsApp, email** | Console › Website settings |
| 6 | **DLT**: register the entity, sender id (`MSG91_SENDER_ID`) and templates (see below) | MSG91 + `MSG91_FLOW_*` |
| 7 | **WhatsApp** Business number and Meta-approved templates | `WHATSAPP_PROVIDER=msg91` |
| 8 | **Google Maps key** (Places New, Geocoding, Distance Matrix; restrict to the server IP) | `MAPS_PROVIDER=google` |
| 9 | **Exotel** account + KYC + ExoPhone for masked calls | `CALL_PROVIDER=exotel` |
| 10 | **Google Calendar** OAuth client (redirect `https://api.<domain>/api/v1/calendar/google/callback`) | `GOOGLE_CLIENT_ID/SECRET` |
| 11 | **Zones**: check every Patna zone's colour and radius | Console › Zones |
| 12 | **First physios verified**, hours and prices set | Console › Verification |
| 13 | **Partner QR codes printed** (only after `PUBLIC_API_URL` is final) | Console › Partners |
| 14 | Coins and partner reward amounts | Console › Coins & rewards |

**Suggested DLT templates** (variables `{#var#}` map to `##name##`, `##title##`, `##body##`):
- OTP: `{#var#} is your PhysioCare code. It expires in 10 minutes. Do not share it. -Healthtropic`
- `booking_confirmed`: `Hi {#var#}, {#var#}. {#var#} -PhysioCare`
- `physio_on_the_way`, `visit_reminder`, `payment_verified`, `refund_paid`: same pattern.

## 6. Backups

- The `backup` service saves the database and uploaded files every night at `BACKUP_HOUR` (IST) into the `backups`
  volume and keeps `BACKUP_KEEP_DAYS` days. Each dump is read back after writing to catch broken backups.
- **Copy backups off the server** (a server failure would take them too), e.g. nightly with rclone to Backblaze B2,
  AWS S3 (Mumbai) or Google Drive:
  `docker run --rm -v physiocare_backups:/backups -v ~/.config/rclone:/config/rclone rclone/rclone copy /backups remote:physiocare-backups`
- Backup now: `docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env exec backup sh /backup.sh now`
- **Restore drill (do it once before launch):**
  `docker compose … exec backup sh /backup.sh restore /backups/db_YYYY-MM-DD_HHMM.dump` (asks you to type RESTORE).
  Files: `tar -xzf files_….tar.gz -C /data` inside the api container's `/data`.

## 7. Monitoring

- **Uptime:** add `https://api.<domain>/api/v1/status` to a free monitor (UptimeRobot, Better Stack) with SMS/email
  alerts. It reports the database, maintenance mode and version.
- **Logs:** `docker compose … logs -f api` — one JSON line per request with a request id. When a user reports an
  error, the message they see includes the same request id.
- **Messages:** Console › Messages shows failed SMS/WhatsApp/push and calls.
- **Safety:** every SOS reaches all ops admins and super admins by push and SMS; keep at least one person on duty with
  the PhysioCare Admin app during visit hours.

## 8. Updates

```bash
git pull
docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env up -d --build   # migrations run on start
```
Take a backup first (`… exec backup sh /backup.sh now`). Use Console › Platform settings › Maintenance mode for
longer work, and Minimum app versions to make old apps update.

## 9. Go-live test (30 minutes, with two phones)

1. Patient signs up on the website with a real number (SMS arrives), books a home visit, pays by UPI, uploads proof.
2. Ops confirms the payment in the console; patient gets SMS/WhatsApp/push.
3. Physio (Partner app) gets the booking, taps **I’m on the way**, checks in with the patient's code, ends with notes.
4. Patient rates the visit, reports a test problem; ops sees it in Incidents.
5. Physio holds **SOS** → the Admin app rings, ops acknowledges and resolves.
6. Share a website page on WhatsApp → the preview shows the right title and image.
7. Scan a partner QR → lands on the website; sign up → partner sees it.
