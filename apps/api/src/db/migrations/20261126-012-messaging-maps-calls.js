// Phase 8 · Reaching people: delivery of notifications by push, SMS and WhatsApp; device push tokens;
// message preferences; Google Maps addresses and drive-time cache; masked calls; visit reminders.
export async function up({ context: sequelize }) {
  await sequelize.query(`
    ALTER TABLE notifications ADD COLUMN dispatched_at timestamptz;
    UPDATE notifications SET dispatched_at = created_at;                      -- old notifications are not re-sent
    CREATE INDEX notifications_dispatch_idx ON notifications (created_at) WHERE dispatched_at IS NULL;

    CREATE TABLE notification_deliveries (
      id bigserial PRIMARY KEY,
      notification_id uuid NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
      user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      channel varchar(12) NOT NULL,                 -- push | sms | whatsapp
      status varchar(12) NOT NULL DEFAULT 'pending',-- pending | sent | failed | skipped
      attempts smallint NOT NULL DEFAULT 0,
      next_attempt_at timestamptz NOT NULL DEFAULT now(),
      provider varchar(16),
      provider_ref varchar(200),
      error text,
      sent_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (notification_id, channel)
    );
    CREATE INDEX notification_deliveries_due_idx ON notification_deliveries (next_attempt_at) WHERE status = 'pending';

    CREATE TABLE notification_prefs (
      user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      push boolean NOT NULL DEFAULT true,
      sms boolean NOT NULL DEFAULT true,
      whatsapp boolean NOT NULL DEFAULT true,
      language varchar(8) NOT NULL DEFAULT 'en',
      updated_at timestamptz NOT NULL DEFAULT now()
    );

    ALTER TABLE devices ADD COLUMN last_seen_at timestamptz NOT NULL DEFAULT now(), ADD COLUMN disabled_at timestamptz;
    CREATE UNIQUE INDEX devices_push_token_idx ON devices (push_token) WHERE push_token IS NOT NULL;

    ALTER TABLE addresses ADD COLUMN place_id varchar(300), ADD COLUMN formatted text, ADD COLUMN location_source varchar(12) NOT NULL DEFAULT 'pin';

    CREATE TABLE travel_cache (
      from_key varchar(32) NOT NULL,                -- rounded lat,lng (about 100 m)
      to_key varchar(32) NOT NULL,
      minutes integer NOT NULL,
      meters integer,
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (from_key, to_key)
    );

    CREATE TABLE call_logs (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      visit_id uuid NOT NULL REFERENCES visits(id),
      caller_id uuid NOT NULL REFERENCES users(id),
      callee_id uuid NOT NULL REFERENCES users(id),
      provider varchar(16) NOT NULL,
      provider_ref varchar(200),
      status varchar(16) NOT NULL DEFAULT 'requested', -- requested | ringing | completed | failed | no_answer
      duration_seconds integer,
      error text,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX call_logs_visit_idx ON call_logs (visit_id, created_at DESC);

    ALTER TABLE visits ADD COLUMN reminder_sent_at timestamptz;
  `);
}

export async function down({ context: sequelize }) {
  await sequelize.query(`
    ALTER TABLE visits DROP COLUMN IF EXISTS reminder_sent_at;
    DROP TABLE IF EXISTS call_logs, travel_cache, notification_prefs, notification_deliveries;
    ALTER TABLE addresses DROP COLUMN IF EXISTS place_id, DROP COLUMN IF EXISTS formatted, DROP COLUMN IF EXISTS location_source;
    DROP INDEX IF EXISTS devices_push_token_idx;
    ALTER TABLE devices DROP COLUMN IF EXISTS last_seen_at, DROP COLUMN IF EXISTS disabled_at;
    DROP INDEX IF EXISTS notifications_dispatch_idx;
    ALTER TABLE notifications DROP COLUMN IF EXISTS dispatched_at;
  `);
}
