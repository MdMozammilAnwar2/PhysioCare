// Phase 1: patient profiles, addresses, therapist profiles and prices, plans, payments, notifications.
export async function up({ context: sequelize }) {
  await sequelize.query(`
    CREATE TYPE gender_pref AS ENUM ('female', 'male', 'any');
    CREATE TYPE verification_status AS ENUM ('applied', 'under_review', 'verified', 'suspended');
    CREATE TYPE plan_status AS ENUM ('pending', 'active', 'completed', 'expired', 'refunded', 'cancelled');
    CREATE TYPE payment_status AS ENUM ('created', 'paid', 'failed', 'refunded');

    CREATE TABLE patient_profiles (
      user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      condition_category varchar(32),                 -- after_surgery | back_neck | sports | neuro | elderly | child
      procedure varchar(120),
      surgery_date date,
      preferred_gender gender_pref NOT NULL DEFAULT 'any',
      best_times text[] NOT NULL DEFAULT '{}',        -- morning | afternoon | evening
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE addresses (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      label varchar(40) NOT NULL DEFAULT 'Home',
      line1 varchar(200) NOT NULL,
      landmark varchar(120),
      pin_code varchar(6),
      lat double precision NOT NULL,
      lng double precision NOT NULL,
      zone_id uuid REFERENCES zones(id),
      is_default boolean NOT NULL DEFAULT false,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX addresses_user_idx ON addresses (user_id);

    -- Zone centre + radius until drawn polygons arrive (Phase 5).
    ALTER TABLE zones ADD COLUMN center_lat double precision, ADD COLUMN center_lng double precision, ADD COLUMN radius_km numeric(5,2);

    CREATE TABLE therapist_profiles (
      user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      qualification varchar(16),                      -- BPT | MPT
      years_experience smallint,
      bio text,
      specialisations text[] NOT NULL DEFAULT '{}',
      languages text[] NOT NULL DEFAULT '{hi}',
      home_lat double precision,
      home_lng double precision,
      service_radius_km numeric(5,2) NOT NULL DEFAULT 6,
      verification_status verification_status NOT NULL DEFAULT 'applied',
      accepting boolean NOT NULL DEFAULT true,
      tier varchar(16) NOT NULL DEFAULT 'silver',
      rating numeric(3,2),
      female_patients_only boolean NOT NULL DEFAULT false,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE therapist_prices (
      therapist_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      mode visit_mode NOT NULL,
      price_paise integer NOT NULL CHECK (price_paise > 0),
      PRIMARY KEY (therapist_id, mode)
    );

    CREATE TABLE packages (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      therapist_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name varchar(80) NOT NULL,
      mode visit_mode NOT NULL,
      sessions smallint NOT NULL CHECK (sessions > 1),
      price_paise integer NOT NULL CHECK (price_paise > 0),
      validity_days smallint NOT NULL DEFAULT 45,
      active boolean NOT NULL DEFAULT true,
      created_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE plans (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      patient_id uuid NOT NULL REFERENCES users(id),
      therapist_id uuid NOT NULL REFERENCES users(id),
      package_id uuid REFERENCES packages(id),
      mode visit_mode NOT NULL,
      sessions_total smallint NOT NULL,
      price_paise integer NOT NULL,
      valid_until timestamptz,
      status plan_status NOT NULL DEFAULT 'pending',
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE payments (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      patient_id uuid NOT NULL REFERENCES users(id),
      plan_id uuid NOT NULL REFERENCES plans(id),
      amount_paise integer NOT NULL,
      currency char(3) NOT NULL DEFAULT 'INR',
      provider varchar(16) NOT NULL,
      provider_order_id varchar(64) NOT NULL UNIQUE,
      provider_payment_id varchar(64) UNIQUE,
      status payment_status NOT NULL DEFAULT 'created',
      invoice_no varchar(24) UNIQUE,
      raw jsonb,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE SEQUENCE invoice_seq;

    ALTER TABLE visits
      ADD COLUMN plan_id uuid REFERENCES plans(id),
      ADD COLUMN address_id uuid REFERENCES addresses(id),
      ADD COLUMN family_member jsonb;                 -- {name, relation} when the gender rule requires it

    CREATE TABLE notifications (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type varchar(48) NOT NULL,
      title varchar(160) NOT NULL,
      body text,
      data jsonb,
      read_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX notifications_user_idx ON notifications (user_id, created_at DESC);
  `);
}

export async function down({ context: sequelize }) {
  await sequelize.query(`
    DROP TABLE IF EXISTS notifications;
    ALTER TABLE visits DROP COLUMN IF EXISTS plan_id, DROP COLUMN IF EXISTS address_id, DROP COLUMN IF EXISTS family_member;
    DROP SEQUENCE IF EXISTS invoice_seq;
    DROP TABLE IF EXISTS payments, plans, packages, therapist_prices, therapist_profiles, addresses, patient_profiles;
    ALTER TABLE zones DROP COLUMN IF EXISTS center_lat, DROP COLUMN IF EXISTS center_lng, DROP COLUMN IF EXISTS radius_km;
    DROP TYPE IF EXISTS payment_status; DROP TYPE IF EXISTS plan_status; DROP TYPE IF EXISTS verification_status; DROP TYPE IF EXISTS gender_pref;
  `);
}
