// Phase 5 · Control: grievance redressal (IT Rules 2021 / Consumer Protection (E-Commerce) Rules 2020),
// a grievance committee role, and zone change details.
export async function up({ context: sequelize }) {
  await sequelize.query(`ALTER TYPE app_role ADD VALUE IF NOT EXISTS 'grievance_committee'`);
  await sequelize.query(`
    CREATE SEQUENCE grievance_seq;
    CREATE TABLE grievances (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      ticket_no varchar(24) NOT NULL UNIQUE,
      complainant_id uuid NOT NULL REFERENCES users(id),
      category varchar(24) NOT NULL,          -- service | safety | harassment | privacy | payment | refund | physio_conduct | app | other
      description text NOT NULL,
      visit_id uuid REFERENCES visits(id),
      against_user_id uuid REFERENCES users(id),
      file_ids uuid[] NOT NULL DEFAULT '{}',
      status varchar(16) NOT NULL DEFAULT 'open', -- open | acknowledged | in_review | resolved | rejected
      committee boolean NOT NULL DEFAULT false,  -- sensitive (harassment, safety): only the committee and super admin see it
      assigned_to uuid REFERENCES users(id),
      ack_due_at timestamptz NOT NULL,
      resolve_due_at timestamptz NOT NULL,
      acknowledged_at timestamptz,
      resolved_at timestamptz,
      resolution text,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX grievances_status_idx ON grievances (status, resolve_due_at);
    CREATE INDEX grievances_complainant_idx ON grievances (complainant_id, created_at DESC);
    CREATE TABLE grievance_events (
      id bigserial PRIMARY KEY,
      grievance_id uuid NOT NULL REFERENCES grievances(id) ON DELETE CASCADE,
      actor_id uuid REFERENCES users(id),
      kind varchar(16) NOT NULL,             -- created | acknowledged | note | reply | assigned | escalated | resolved | rejected
      body text,
      public boolean NOT NULL DEFAULT false, -- shown to the complainant
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX grievance_events_idx ON grievance_events (grievance_id, id);
  `);
}

export async function down({ context: sequelize }) {
  await sequelize.query(`DROP TABLE IF EXISTS grievance_events, grievances; DROP SEQUENCE IF EXISTS grievance_seq;`);
}
