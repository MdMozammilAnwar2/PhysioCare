// Phase 2: therapist documents and verification, visit lifecycle, session notes, live location, SOS.
export async function up({ context: sequelize }) {
  await sequelize.query(`
    CREATE TYPE document_type AS ENUM ('aadhaar_pan', 'selfie', 'degree', 'council_registration', 'police_verification', 'bank_proof');
    CREATE TYPE document_status AS ENUM ('pending', 'approved', 'rejected');

    CREATE TABLE therapist_documents (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      therapist_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type document_type NOT NULL,
      file_id uuid NOT NULL REFERENCES files(id),
      status document_status NOT NULL DEFAULT 'pending',
      expires_on date,                                -- e.g. police verification
      review_note text,
      reviewed_by uuid REFERENCES users(id),
      reviewed_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    -- The newest upload of each type is the current one; older rows stay for history.
    CREATE INDEX therapist_documents_current_idx ON therapist_documents (therapist_id, type, created_at DESC);

    ALTER TABLE therapist_profiles
      ADD COLUMN submitted_at timestamptz,
      ADD COLUMN verified_at timestamptz,
      ADD COLUMN verified_by uuid REFERENCES users(id),
      ADD COLUMN review_note text;

    CREATE TYPE physio_consent AS ENUM ('not_needed', 'pending', 'accepted', 'declined');
    ALTER TABLE visits
      ADD COLUMN physio_consent physio_consent NOT NULL DEFAULT 'not_needed',
      ADD COLUMN physio_consent_at timestamptz,
      ADD COLUMN checkin_attempts smallint NOT NULL DEFAULT 0,
      ADD COLUMN on_the_way_at timestamptz,
      ADD COLUMN checked_in_at timestamptz,
      ADD COLUMN completed_at timestamptz,
      ADD COLUMN family_present_confirmed boolean,
      ADD COLUMN cancel_reason varchar(48);

    CREATE TABLE session_notes (
      visit_id uuid PRIMARY KEY REFERENCES visits(id) ON DELETE CASCADE,
      therapist_id uuid NOT NULL REFERENCES users(id),
      pain_score smallint CHECK (pain_score BETWEEN 0 AND 10),
      measurements jsonb NOT NULL DEFAULT '{}',       -- e.g. {"knee_flexion": 95, "knee_extension": -2}
      exercises jsonb NOT NULL DEFAULT '[]',          -- [{"name": "Mini squats", "dose": "3 x 12"}]
      notes text,
      home_plan text,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );

    -- Physio location is stored only while a visit is in progress (safety), never otherwise.
    CREATE TABLE visit_locations (
      id bigserial PRIMARY KEY,
      visit_id uuid NOT NULL REFERENCES visits(id) ON DELETE CASCADE,
      lat double precision NOT NULL,
      lng double precision NOT NULL,
      recorded_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX visit_locations_visit_idx ON visit_locations (visit_id, recorded_at DESC);

    CREATE TYPE sos_status AS ENUM ('open', 'acknowledged', 'resolved');
    CREATE TABLE sos_events (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      visit_id uuid REFERENCES visits(id),
      raised_by uuid NOT NULL REFERENCES users(id),
      lat double precision,
      lng double precision,
      status sos_status NOT NULL DEFAULT 'open',
      acknowledged_by uuid REFERENCES users(id),
      acknowledged_at timestamptz,
      resolved_by uuid REFERENCES users(id),
      resolved_at timestamptz,
      resolution_note text,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX sos_events_open_idx ON sos_events (status, created_at) WHERE status <> 'resolved';
  `);
}

export async function down({ context: sequelize }) {
  await sequelize.query(`
    DROP TABLE IF EXISTS sos_events, visit_locations, session_notes;
    DROP TYPE IF EXISTS sos_status;
    ALTER TABLE visits DROP COLUMN IF EXISTS physio_consent, DROP COLUMN IF EXISTS physio_consent_at, DROP COLUMN IF EXISTS checkin_attempts,
      DROP COLUMN IF EXISTS on_the_way_at, DROP COLUMN IF EXISTS checked_in_at, DROP COLUMN IF EXISTS completed_at,
      DROP COLUMN IF EXISTS family_present_confirmed, DROP COLUMN IF EXISTS cancel_reason;
    DROP TYPE IF EXISTS physio_consent;
    ALTER TABLE therapist_profiles DROP COLUMN IF EXISTS submitted_at, DROP COLUMN IF EXISTS verified_at, DROP COLUMN IF EXISTS verified_by, DROP COLUMN IF EXISTS review_note;
    DROP TABLE IF EXISTS therapist_documents;
    DROP TYPE IF EXISTS document_status; DROP TYPE IF EXISTS document_type;
  `);
}
