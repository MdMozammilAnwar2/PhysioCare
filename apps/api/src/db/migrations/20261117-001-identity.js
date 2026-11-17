// Identity: users, roles, OTP, refresh tokens, devices, consents, blocks.
export async function up({ context: sequelize }) {
  await sequelize.query(`
    CREATE EXTENSION IF NOT EXISTS pgcrypto;
    CREATE EXTENSION IF NOT EXISTS citext;
    CREATE EXTENSION IF NOT EXISTS btree_gist;

    CREATE TYPE user_status AS ENUM ('active', 'blocked', 'deleted');
    CREATE TYPE app_role AS ENUM ('patient', 'therapist', 'partner_owner', 'partner_staff', 'partner_wallet',
      'ops_admin', 'finance', 'city_coordinator', 'super_admin');

    CREATE TABLE users (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      phone varchar(16) NOT NULL UNIQUE,              -- E.164, e.g. +919876543210
      name varchar(120),
      gender varchar(16),
      birth_year smallint,
      email citext,
      preferred_language varchar(8) NOT NULL DEFAULT 'en',
      status user_status NOT NULL DEFAULT 'active',
      last_login_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE user_roles (
      user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role app_role NOT NULL,
      scope_city_id uuid,                             -- city coordinators / city-scoped ops
      granted_by uuid REFERENCES users(id),
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (user_id, role)
    );

    CREATE TABLE otp_requests (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      phone varchar(16) NOT NULL,
      code_hash char(64) NOT NULL,                    -- HMAC-SHA256, never the code itself
      purpose varchar(24) NOT NULL DEFAULT 'login',
      attempts smallint NOT NULL DEFAULT 0,
      expires_at timestamptz NOT NULL,
      consumed_at timestamptz,
      ip inet,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX otp_requests_phone_created_idx ON otp_requests (phone, created_at DESC);

    CREATE TABLE refresh_tokens (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash char(64) NOT NULL UNIQUE,
      family_id uuid NOT NULL,                        -- rotation chain; reuse revokes the family
      expires_at timestamptz NOT NULL,
      revoked_at timestamptz,
      replaced_by uuid,
      device_info jsonb,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX refresh_tokens_family_idx ON refresh_tokens (family_id);

    CREATE TABLE devices (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      platform varchar(16) NOT NULL,                  -- android | ios | web
      app varchar(24) NOT NULL,                       -- patient | therapist | partner | super_admin | web
      app_version varchar(16),
      push_token text,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE consents (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      document varchar(48) NOT NULL,                  -- terms | privacy | code_of_conduct | gender_safety | partner_agreement | surgeon_sharing
      version varchar(16) NOT NULL,
      accepted boolean NOT NULL,
      method varchar(16) NOT NULL,                    -- app_otp | web_otp | checkbox
      subject_id uuid,                                -- e.g. the patient a gender-safety consent is about
      meta jsonb,
      ip inet,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX consents_user_doc_idx ON consents (user_id, document, created_at DESC);

    CREATE TABLE blocks (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      reason_code varchar(48) NOT NULL,
      note text NOT NULL,
      ends_at timestamptz,                            -- null = permanent or until review
      until_review boolean NOT NULL DEFAULT false,
      conditions jsonb,                               -- conditions applied on unblock
      blocked_by uuid NOT NULL REFERENCES users(id),
      lifted_at timestamptz,
      lifted_by uuid REFERENCES users(id),
      lift_note text,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX blocks_user_active_idx ON blocks (user_id) WHERE lifted_at IS NULL;

    -- Personal blocks: a physio blocks a patient, or a patient blocks a physio. No platform-wide effect.
    CREATE TABLE personal_blocks (
      blocker_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      blocked_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      reason_code varchar(48),
      note text,
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (blocker_id, blocked_id)
    );
  `);
}

export async function down({ context: sequelize }) {
  await sequelize.query(`
    DROP TABLE IF EXISTS personal_blocks, blocks, consents, devices, refresh_tokens, otp_requests, user_roles, users;
    DROP TYPE IF EXISTS app_role; DROP TYPE IF EXISTS user_status;
  `);
}
