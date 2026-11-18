// Phase 4 · Growth: partners (doctors, hospitals, labs, physios…), their links and QR codes,
// patient referral, coins (10 coins = ₹1) and partner rewards.
export async function up({ context: sequelize }) {
  await sequelize.query(`
    INSERT INTO app_settings (key, value) VALUES ('growth_rules', '{"welcomeCoins": 500, "referrerCoins": 1000, "maxCoinPct": 20, "partnerRewardPaise": 10000}')
      ON CONFLICT (key) DO NOTHING;

    ALTER TABLE partner_orgs
      ADD COLUMN contact_name varchar(120),
      ADD COLUMN phone varchar(16),
      ADD COLUMN address text,
      ADD COLUMN registration_no varchar(64),             -- medical council / hospital / lab registration
      ADD COLUMN payout_to varchar(200),                  -- UPI ID or bank account + IFSC
      ADD COLUMN reward_paise integer,                    -- overrides the default partner reward when set
      ADD COLUMN decided_by uuid REFERENCES users(id),
      ADD COLUMN decided_at timestamptz,
      ADD COLUMN decision_note text;
    CREATE INDEX partner_orgs_status_idx ON partner_orgs (status, created_at DESC);

    -- One row per coin movement. Balance = sum(delta). The same reason + ref can only happen once per user.
    CREATE TABLE coin_entries (
      id bigserial PRIMARY KEY,
      user_id uuid NOT NULL REFERENCES users(id),
      delta integer NOT NULL CHECK (delta <> 0),
      reason varchar(24) NOT NULL,                        -- welcome | referral | redeem | redeem_return | refund_return | adjust
      ref_id uuid,
      note text,
      created_by uuid REFERENCES users(id),
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX coin_entries_user_idx ON coin_entries (user_id, id DESC);
    CREATE UNIQUE INDEX coin_entries_once ON coin_entries (user_id, reason, ref_id) WHERE ref_id IS NOT NULL AND reason IN ('welcome', 'referral', 'redeem', 'redeem_return', 'refund_return');

    ALTER TABLE payments
      ADD COLUMN coins_used integer NOT NULL DEFAULT 0,
      ADD COLUMN coin_discount_paise integer NOT NULL DEFAULT 0;

    ALTER TABLE refunds ADD COLUMN coins_back integer NOT NULL DEFAULT 0;

    -- Partner reward: one per referred patient, earned on that patient's first confirmed payment.
    CREATE TABLE partner_rewards (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      partner_id uuid NOT NULL REFERENCES partner_orgs(id),
      patient_id uuid NOT NULL UNIQUE REFERENCES users(id),
      payment_id uuid NOT NULL REFERENCES payments(id),
      link_id uuid REFERENCES tracked_links(id),
      amount_paise integer NOT NULL CHECK (amount_paise >= 0),
      status varchar(12) NOT NULL DEFAULT 'earned',       -- earned | paid | reversed
      reference varchar(64),
      paid_by uuid REFERENCES users(id),
      paid_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX partner_rewards_partner_idx ON partner_rewards (partner_id, status);
  `);
}

export async function down({ context: sequelize }) {
  await sequelize.query(`
    DROP TABLE IF EXISTS partner_rewards, coin_entries;
    ALTER TABLE refunds DROP COLUMN IF EXISTS coins_back;
    ALTER TABLE payments DROP COLUMN IF EXISTS coins_used, DROP COLUMN IF EXISTS coin_discount_paise;
    ALTER TABLE partner_orgs DROP COLUMN IF EXISTS contact_name, DROP COLUMN IF EXISTS phone, DROP COLUMN IF EXISTS address,
      DROP COLUMN IF EXISTS registration_no, DROP COLUMN IF EXISTS payout_to, DROP COLUMN IF EXISTS reward_paise,
      DROP COLUMN IF EXISTS decided_by, DROP COLUMN IF EXISTS decided_at, DROP COLUMN IF EXISTS decision_note;
    DROP INDEX IF EXISTS partner_orgs_status_idx;
    DELETE FROM app_settings WHERE key = 'growth_rules';
  `);
}
