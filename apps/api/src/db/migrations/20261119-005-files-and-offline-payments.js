// Files (permanent artifact store) + payments switch to Cash and UPI-QR with proof and verification.
export async function up({ context: sequelize }) {
  await sequelize.query(`
    CREATE TYPE file_visibility AS ENUM ('public', 'private');

    CREATE TABLE files (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      owner_user_id uuid REFERENCES users(id),
      purpose varchar(32) NOT NULL DEFAULT 'general',  -- payment_proof | website_media | document | exercise_video | avatar | general
      visibility file_visibility NOT NULL DEFAULT 'private',
      original_name varchar(255) NOT NULL,
      mime_type varchar(100) NOT NULL,
      size_bytes bigint NOT NULL,
      sha256 char(64) NOT NULL,
      storage_driver varchar(16) NOT NULL,             -- local | s3
      storage_key varchar(512) NOT NULL UNIQUE,
      linked_type varchar(32),                         -- payment | visit | therapist | cms_page ...
      linked_id varchar(64),
      hidden_at timestamptz,                           -- files are never deleted, only hidden
      hidden_by uuid REFERENCES users(id),
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX files_owner_idx ON files (owner_user_id, created_at DESC);
    CREATE INDEX files_linked_idx ON files (linked_type, linked_id);

    ALTER TYPE payment_status ADD VALUE IF NOT EXISTS 'pending';
    ALTER TYPE payment_status ADD VALUE IF NOT EXISTS 'submitted';
    ALTER TYPE payment_status ADD VALUE IF NOT EXISTS 'rejected';

    ALTER TABLE payments
      ALTER COLUMN provider_order_id DROP NOT NULL,
      ADD COLUMN method varchar(8),                    -- cash | upi
      ADD COLUMN reference varchar(24) UNIQUE,         -- shown to the patient and put in the UPI note, e.g. PC-7K3M9Q
      ADD COLUMN utr varchar(32),                      -- UPI transaction reference from the patient
      ADD COLUMN proof_file_id uuid REFERENCES files(id),
      ADD COLUMN submitted_by uuid REFERENCES users(id),
      ADD COLUMN submitted_at timestamptz,
      ADD COLUMN verified_by uuid REFERENCES users(id),
      ADD COLUMN verified_at timestamptz,
      ADD COLUMN review_note text;
    CREATE UNIQUE INDEX payments_utr_unique ON payments (utr) WHERE utr IS NOT NULL;

    INSERT INTO app_settings (key, value) VALUES ('payment_upi', '{"upiId": null, "payeeName": "PhysioConnect"}')
      ON CONFLICT (key) DO NOTHING;
  `);
}

export async function down({ context: sequelize }) {
  await sequelize.query(`
    DELETE FROM app_settings WHERE key = 'payment_upi';
    DROP INDEX IF EXISTS payments_utr_unique;
    ALTER TABLE payments DROP COLUMN IF EXISTS method, DROP COLUMN IF EXISTS reference, DROP COLUMN IF EXISTS utr,
      DROP COLUMN IF EXISTS proof_file_id, DROP COLUMN IF EXISTS submitted_by, DROP COLUMN IF EXISTS submitted_at,
      DROP COLUMN IF EXISTS verified_by, DROP COLUMN IF EXISTS verified_at, DROP COLUMN IF EXISTS review_note;
    DROP TABLE IF EXISTS files;
    DROP TYPE IF EXISTS file_visibility;
  `);
}
