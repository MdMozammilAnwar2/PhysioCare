// Phase 3: earnings ledger with hold, payouts, refunds, incidents, ratings, chat. Money is always integer paise.
export async function up({ context: sequelize }) {
  await sequelize.query(`
    -- Platform fee and TDS rates are business decisions: start at 0 and are set by a super admin (versioned in audit log).
    INSERT INTO app_settings (key, value) VALUES ('money_rules', '{"platformFeePct": 0, "tdsPct": 0, "holdDays": 7, "minPayoutPaise": 50000, "reportWindowDays": 7}')
      ON CONFLICT (key) DO NOTHING;

    CREATE TYPE ledger_status AS ENUM ('held', 'available', 'frozen', 'paid', 'reversed');
    CREATE TABLE payout_batches (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      created_by uuid NOT NULL REFERENCES users(id),
      status varchar(12) NOT NULL DEFAULT 'open',      -- open | closed
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE payouts (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      batch_id uuid NOT NULL REFERENCES payout_batches(id),
      therapist_id uuid NOT NULL REFERENCES users(id),
      amount_paise integer NOT NULL CHECK (amount_paise > 0),
      tds_paise integer NOT NULL DEFAULT 0,
      status varchar(12) NOT NULL DEFAULT 'pending',   -- pending | paid
      method varchar(12),                              -- bank | upi
      reference varchar(64),                           -- UTR / bank reference of the transfer
      paid_by uuid REFERENCES users(id),
      paid_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE ledger_entries (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      therapist_id uuid NOT NULL REFERENCES users(id),
      visit_id uuid NOT NULL UNIQUE REFERENCES visits(id),   -- one earning per completed visit
      plan_id uuid NOT NULL REFERENCES plans(id),
      gross_paise integer NOT NULL,
      fee_paise integer NOT NULL,
      tds_paise integer NOT NULL,
      net_paise integer NOT NULL,
      fee_pct numeric(5,2) NOT NULL,
      tds_pct numeric(5,2) NOT NULL,
      status ledger_status NOT NULL DEFAULT 'held',
      available_at timestamptz NOT NULL,
      payout_id uuid REFERENCES payouts(id),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CHECK (net_paise = gross_paise - fee_paise - tds_paise)
    );
    CREATE INDEX ledger_therapist_idx ON ledger_entries (therapist_id, status);

    CREATE TYPE refund_status AS ENUM ('requested', 'approved', 'paid', 'rejected');
    CREATE TABLE refunds (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      patient_id uuid NOT NULL REFERENCES users(id),
      plan_id uuid NOT NULL REFERENCES plans(id),
      amount_paise integer NOT NULL CHECK (amount_paise > 0),
      reason varchar(32) NOT NULL,                     -- unused_sessions | incident | other
      incident_id uuid,
      status refund_status NOT NULL DEFAULT 'requested',
      refund_to text,                                  -- patient's UPI ID / bank details for the transfer
      reference varchar(64),
      note text,
      decided_by uuid REFERENCES users(id),
      decided_at timestamptz,
      paid_by uuid REFERENCES users(id),
      paid_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    -- At most one open unused-sessions refund per plan.
    CREATE UNIQUE INDEX refunds_one_open_per_plan ON refunds (plan_id) WHERE reason = 'unused_sessions' AND status IN ('requested', 'approved');

    CREATE TYPE incident_status AS ENUM ('open', 'upheld', 'dismissed');
    CREATE TABLE incidents (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      visit_id uuid NOT NULL REFERENCES visits(id),
      reported_by uuid NOT NULL REFERENCES users(id),
      against_user uuid REFERENCES users(id),
      category varchar(32) NOT NULL,                   -- missing_item | behaviour | no_show | hurt | payment | other
      severity varchar(12) NOT NULL DEFAULT 'medium',  -- low | medium | critical
      description text NOT NULL,
      file_ids uuid[] NOT NULL DEFAULT '{}',
      status incident_status NOT NULL DEFAULT 'open',
      decision_note text,
      decided_by uuid REFERENCES users(id),
      decided_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    ALTER TABLE refunds ADD CONSTRAINT refunds_incident_fk FOREIGN KEY (incident_id) REFERENCES incidents(id);

    CREATE TABLE ratings (
      visit_id uuid PRIMARY KEY REFERENCES visits(id),
      patient_id uuid NOT NULL REFERENCES users(id),
      therapist_id uuid NOT NULL REFERENCES users(id),
      stars smallint NOT NULL CHECK (stars BETWEEN 1 AND 5),
      tags text[] NOT NULL DEFAULT '{}',
      comment text,
      created_at timestamptz NOT NULL DEFAULT now()
    );

    -- One conversation per plan (patient ↔ physio). Messages kept for safety reviews.
    CREATE TABLE chat_messages (
      id bigserial PRIMARY KEY,
      plan_id uuid NOT NULL REFERENCES plans(id),
      sender_id uuid NOT NULL REFERENCES users(id),
      body text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX chat_messages_plan_idx ON chat_messages (plan_id, id);
    CREATE TABLE chat_blocked_attempts (
      id bigserial PRIMARY KEY,
      plan_id uuid NOT NULL REFERENCES plans(id),
      sender_id uuid NOT NULL REFERENCES users(id),
      body text NOT NULL,
      reason varchar(32) NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );
  `);
}

export async function down({ context: sequelize }) {
  await sequelize.query(`
    DROP TABLE IF EXISTS chat_blocked_attempts, chat_messages, ratings;
    ALTER TABLE refunds DROP CONSTRAINT IF EXISTS refunds_incident_fk;
    DROP TABLE IF EXISTS incidents, refunds, ledger_entries, payouts, payout_batches;
    DROP TYPE IF EXISTS incident_status; DROP TYPE IF EXISTS refund_status; DROP TYPE IF EXISTS ledger_status;
    DELETE FROM app_settings WHERE key = 'money_rules';
  `);
}
