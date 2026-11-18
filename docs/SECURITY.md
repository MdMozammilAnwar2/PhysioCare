# PhysioCare security summary (v1.0)

What protects patients, physios and the business, and what is knowingly left for later.

## Accounts and sign-in
- Phone + one-time code only (no passwords). Codes are stored as HMAC hashes, expire in 10 minutes, 5 wrong tries
  lock the code, 5 codes per number per 15 minutes, 30 seconds between codes.
- Sign-in calls are also limited per network (30 per 15 minutes) in production.
- Access tokens last 15 minutes; refresh tokens rotate on every use, are stored hashed, and reusing an old one signs
  out the whole device family (stolen-token defence).
- **Super admin can't be created, given, removed or blocked through any API**; it comes only from the server `.env`.
- Blocking signs a person out everywhere immediately; staff can only be blocked by a super admin.
- Every staff action that changes money, people, zones, settings or content is in the audit log.

## Data
- Least exposure: physios see a woman patient's name and address only after accepting the safety consent; the
  website directory never shows phone numbers or locations; outside calendars get only the patient's first name and
  area; patient and physio talk through masked calls and a chat that blocks numbers, UPI IDs and off-app payment.
- Live location is collected only while a physio is on the way or in a session.
- Files are private by default (owner + staff), checked against their real type, kept with a SHA-256 checksum,
  and never deleted (hidden instead). Only staff can publish public website files.
- Calendar tokens and Calendly signing keys are encrypted at rest (AES-256-GCM, `CALENDAR_TOKEN_KEY`).
- Webhooks (Calendly) are signature-checked with a 5-minute replay window.
- Logs never contain request bodies, tokens, codes or full phone numbers; errors return a request id, not details.
- Harassment and safety complaints are visible only to the grievance committee and super admin.

## Server
- Production refuses to start with weak secrets, development SMS, localhost addresses, the development database
  password or a placeholder super admin (`npm run api:check`).
- HTTPS everywhere with automatic certificates; HSTS; strict Content-Security-Policy on the website and console;
  console pages are `noindex` and can't be framed; `X-Content-Type-Options`, referrer and permissions policies.
- Rate limits: 300 requests/minute per IP, 30 sign-ins/15 min per IP, 120 uploads/hour per person.
- JSON bodies capped at 100 KB; every list input has a maximum size; all input validated (zod).
- The database is not exposed to the internet; the API runs as a non-root user; nightly verified backups.
- After-sign-in redirects accept only same-site paths (no open redirects).

## Known and accepted for now (re-check after launch)
| Item | Why it's acceptable now | Plan |
|---|---|---|
| zod 3 advisory (memory use on huge constrained lists) | Bodies are capped at 100 KB and every list has a max | Move to zod 4 (breaking) after launch |
| react-router 6 moderate advisory | The only user-controlled navigation (sign-in `next`) is restricted to same-site paths; no server rendering | Move to React Router 7 after launch |
| picomatch / minimatch advisories | Only used while building, never in the running app | Update build tools with the next Vite upgrade |
| uuid advisory (via Sequelize) | Affects a `buf` option we never use | Comes with the next Sequelize update |
| Rate limits are per server process | One API server at launch | Use Redis-backed limits if you run several API servers |
| Files stored on the server disk | Backed up nightly with the database | Move to S3-compatible storage when storage grows |

Report a security problem to the super admin or the Grievance Officer; never in public channels.
