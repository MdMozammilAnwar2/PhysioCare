// Phase 7 · Calendars and video: Google Calendar and Calendly connections, private calendar feeds,
// visits pushed to outside calendars, and video visit rooms.
export async function up({ context: sequelize }) {
  await sequelize.query(`
    ALTER TABLE calendar_connections
      ADD COLUMN external_calendar_id varchar(256),   -- Google calendar id (primary) or Calendly user URI
      ADD COLUMN webhook_id varchar(256),             -- Calendly webhook subscription URI
      ADD COLUMN webhook_secret_enc text,             -- Calendly signing key (encrypted)
      ADD COLUMN last_error text,
      ADD COLUMN token_expires_at timestamptz;

    -- Events found in outside calendars: one row per event, replaced on every sync.
    CREATE UNIQUE INDEX external_busy_blocks_event_idx ON external_busy_blocks (connection_id, external_id) WHERE external_id IS NOT NULL;
    ALTER TABLE external_busy_blocks ADD COLUMN source varchar(16) NOT NULL DEFAULT 'sync'; -- sync | webhook

    -- Private subscribe-link calendar feeds (any calendar app). One secret per person; rotating it breaks the old link.
    CREATE TABLE calendar_feeds (
      user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      secret varchar(64) NOT NULL UNIQUE,
      created_at timestamptz NOT NULL DEFAULT now(),
      last_fetched_at timestamptz
    );

    -- Each visit remembers the event it created in each connected calendar, so changes update the same event.
    ALTER TABLE visits
      ADD COLUMN calendar_events jsonb NOT NULL DEFAULT '{}',  -- { connectionId: externalEventId }
      ADD COLUMN calendar_synced_at timestamptz,
      ADD COLUMN video_started_at timestamptz,
      ADD COLUMN patient_joined_at timestamptz,
      ADD COLUMN physio_joined_at timestamptz;
  `);
}

export async function down({ context: sequelize }) {
  await sequelize.query(`
    ALTER TABLE visits DROP COLUMN IF EXISTS calendar_events, DROP COLUMN IF EXISTS calendar_synced_at, DROP COLUMN IF EXISTS video_started_at,
      DROP COLUMN IF EXISTS patient_joined_at, DROP COLUMN IF EXISTS physio_joined_at;
    DROP TABLE IF EXISTS calendar_feeds;
    ALTER TABLE external_busy_blocks DROP COLUMN IF EXISTS source;
    DROP INDEX IF EXISTS external_busy_blocks_event_idx;
    ALTER TABLE calendar_connections DROP COLUMN IF EXISTS external_calendar_id, DROP COLUMN IF EXISTS webhook_id,
      DROP COLUMN IF EXISTS webhook_secret_enc, DROP COLUMN IF EXISTS last_error, DROP COLUMN IF EXISTS token_expires_at;
  `);
}
