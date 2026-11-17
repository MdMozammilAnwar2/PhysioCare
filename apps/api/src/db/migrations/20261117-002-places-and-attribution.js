// Cities, zones, partners, attribution (tracked links, link events, attributions).
export async function up({ context: sequelize }) {
  await sequelize.query(`
    CREATE TYPE city_status AS ENUM ('planned', 'recruiting', 'live');
    CREATE TYPE zone_color AS ENUM ('green', 'blue', 'yellow', 'orange', 'red');

    CREATE TABLE cities (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      name varchar(80) NOT NULL UNIQUE,
      state varchar(80) NOT NULL DEFAULT 'Bihar',
      status city_status NOT NULL DEFAULT 'planned',
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE zones (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      city_id uuid NOT NULL REFERENCES cities(id) ON DELETE CASCADE,
      name varchar(80) NOT NULL,
      color zone_color NOT NULL DEFAULT 'blue',
      pin_codes text[] NOT NULL DEFAULT '{}',
      boundary jsonb,                                 -- GeoJSON polygon
      reason text,
      review_on date,
      updated_by uuid REFERENCES users(id),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (city_id, name)
    );

    CREATE TABLE zone_changes (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      zone_id uuid NOT NULL REFERENCES zones(id) ON DELETE CASCADE,
      from_color zone_color,
      to_color zone_color NOT NULL,
      reason text NOT NULL,
      changed_by uuid REFERENCES users(id),
      created_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE partner_orgs (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      name varchar(160) NOT NULL,
      type varchar(24) NOT NULL,                      -- hospital | clinic | doctor | gym | pharmacy | lab
      city_id uuid REFERENCES cities(id),
      status varchar(16) NOT NULL DEFAULT 'pending',  -- pending | approved | suspended
      pan_last4 varchar(4),
      gstin varchar(15),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE partner_members (
      partner_id uuid NOT NULL REFERENCES partner_orgs(id) ON DELETE CASCADE,
      user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      access varchar(16) NOT NULL,                    -- owner | staff | wallet
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (partner_id, user_id)
    );

    CREATE TYPE link_type AS ENUM ('hospital_qr', 'partner_permanent_qr', 'friend_link', 'physio_link', 'campaign');

    CREATE TABLE tracked_links (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      code citext NOT NULL UNIQUE,
      type link_type NOT NULL,
      owner_user_id uuid REFERENCES users(id),
      owner_partner_id uuid REFERENCES partner_orgs(id),
      referred_by_user_id uuid REFERENCES users(id),  -- e.g. the doctor who created a hospital QR
      single_use boolean NOT NULL DEFAULT false,
      used_at timestamptz,
      expires_at timestamptz,
      active boolean NOT NULL DEFAULT true,
      meta jsonb,                                     -- procedure, surgery date, campaign name, utm defaults
      created_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE link_events (
      id bigserial PRIMARY KEY,
      link_id uuid REFERENCES tracked_links(id),
      code citext,
      event varchar(16) NOT NULL,                     -- scan | click | install | signup | first_paid
      user_id uuid REFERENCES users(id),
      device_id varchar(128),
      ip inet,
      utm jsonb,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX link_events_link_idx ON link_events (link_id, event);
    CREATE INDEX link_events_device_idx ON link_events (device_id, created_at DESC);

    CREATE TABLE attributions (
      user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      first_source varchar(32) NOT NULL,
      first_link_id uuid REFERENCES tracked_links(id),
      first_utm jsonb,
      credited_user_id uuid REFERENCES users(id),
      credited_partner_id uuid REFERENCES partner_orgs(id),
      last_source varchar(32),
      last_link_id uuid REFERENCES tracked_links(id),
      last_touch_at timestamptz,
      self_reported text,
      flagged boolean NOT NULL DEFAULT false,
      flag_reason text,
      locked_at timestamptz,                          -- set at first paid session; credit can't change after
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
  `);
}

export async function down({ context: sequelize }) {
  await sequelize.query(`
    DROP TABLE IF EXISTS attributions, link_events, tracked_links, partner_members, partner_orgs, zone_changes, zones, cities;
    DROP TYPE IF EXISTS link_type; DROP TYPE IF EXISTS zone_color; DROP TYPE IF EXISTS city_status;
  `);
}
