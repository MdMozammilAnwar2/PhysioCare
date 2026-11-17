// Scheduling foundations (no double booking at the database level), audit log, app settings.
export async function up({ context: sequelize }) {
  await sequelize.query(`
    CREATE TYPE visit_mode AS ENUM ('home', 'clinic', 'video');
    CREATE TYPE visit_status AS ENUM ('held', 'booked', 'on_the_way', 'checked_in', 'completed', 'cancelled', 'late_cancelled', 'no_show');
    CREATE TYPE calendar_provider AS ENUM ('google', 'outlook', 'calendly', 'ical');

    CREATE TABLE availability_rules (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      therapist_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      weekday smallint NOT NULL CHECK (weekday BETWEEN 0 AND 6),   -- 0 = Sunday
      start_time time NOT NULL,
      end_time time NOT NULL CHECK (end_time > start_time),
      modes visit_mode[] NOT NULL DEFAULT '{home}',
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE leave_periods (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      therapist_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      during tstzrange NOT NULL,
      reason text,
      created_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE calendar_connections (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      therapist_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      provider calendar_provider NOT NULL,
      account_email citext,
      access_token_enc text,                          -- encrypted at rest (app-level key)
      refresh_token_enc text,
      scopes text[],
      ical_secret varchar(64),                        -- for the private one-way iCal feed
      status varchar(16) NOT NULL DEFAULT 'active',   -- active | revoked | error
      last_synced_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (therapist_id, provider)
    );

    CREATE TABLE external_busy_blocks (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      connection_id uuid NOT NULL REFERENCES calendar_connections(id) ON DELETE CASCADE,
      therapist_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      during tstzrange NOT NULL,
      external_id varchar(256),
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX external_busy_blocks_gist ON external_busy_blocks USING gist (therapist_id, during);

    -- A visit row also acts as a slot hold (status 'held' + hold_expires_at).
    CREATE TABLE visits (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      therapist_id uuid NOT NULL REFERENCES users(id),
      patient_id uuid NOT NULL REFERENCES users(id),
      zone_id uuid REFERENCES zones(id),
      mode visit_mode NOT NULL,
      status visit_status NOT NULL DEFAULT 'held',
      during tstzrange NOT NULL,
      hold_expires_at timestamptz,
      checkin_code_hash char(64),
      address_snapshot jsonb,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      -- No physio can have two live visits or holds that overlap, even under concurrent payments.
      CONSTRAINT visits_no_overlap EXCLUDE USING gist (therapist_id WITH =, during WITH &&)
        WHERE (status IN ('held', 'booked', 'on_the_way', 'checked_in'))
    );
    CREATE INDEX visits_patient_idx ON visits (patient_id, lower(during));

    CREATE TABLE scheduling_rules (
      version serial PRIMARY KEY,
      rules jsonb NOT NULL,
      effective_from timestamptz NOT NULL DEFAULT now(),
      created_by uuid REFERENCES users(id),
      created_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE audit_logs (
      id bigserial PRIMARY KEY,
      actor_user_id uuid REFERENCES users(id),
      actor_role varchar(24),
      action varchar(64) NOT NULL,
      target_type varchar(32),
      target_id varchar(64),
      before jsonb,
      after jsonb,
      ip inet,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX audit_logs_target_idx ON audit_logs (target_type, target_id, created_at DESC);

    CREATE TABLE app_settings (
      key varchar(64) PRIMARY KEY,
      value jsonb NOT NULL,
      updated_by uuid REFERENCES users(id),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    INSERT INTO app_settings (key, value) VALUES
      ('maintenance', '{"enabled": false, "message": null}'),
      ('min_app_version', '{"patient": "0.1.0", "therapist": "0.1.0", "partner": "0.1.0", "super_admin": "0.1.0"}');

    INSERT INTO scheduling_rules (rules) VALUES ('{
      "visitMinutes": {"home": 45, "video": 30, "clinic": 40},
      "travelBufferMinutes": 10,
      "bookingWindowDays": 60,
      "minNoticeHours": 3,
      "paymentHoldMinutes": 10,
      "offerHoldMinutes": 24,
      "minDaysBetweenSessions": 1,
      "maxVisitsPerDay": 8,
      "freeRescheduleHours": 3
    }');
  `);
}

export async function down({ context: sequelize }) {
  await sequelize.query(`
    DROP TABLE IF EXISTS app_settings, audit_logs, scheduling_rules, visits, external_busy_blocks, calendar_connections, leave_periods, availability_rules;
    DROP TYPE IF EXISTS calendar_provider; DROP TYPE IF EXISTS visit_status; DROP TYPE IF EXISTS visit_mode;
  `);
}
