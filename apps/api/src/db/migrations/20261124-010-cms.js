// Phase 6 · Website CMS: pages made of blocks (home, services, conditions, about, FAQ, blog, legal),
// every save kept as a revision, and site-wide settings (contact details, navigation, announcement).
export async function up({ context: sequelize }) {
  await sequelize.query(`ALTER TYPE app_role ADD VALUE IF NOT EXISTS 'content_editor'`);
  await sequelize.query(`
    CREATE TABLE cms_pages (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      slug varchar(160) NOT NULL UNIQUE,            -- the URL path without the leading slash; '' is the home page
      kind varchar(16) NOT NULL DEFAULT 'page',     -- page | service | condition | blog | legal | city
      title varchar(200) NOT NULL,
      summary text,                                  -- used on cards and lists
      blocks jsonb NOT NULL DEFAULT '[]',
      seo jsonb NOT NULL DEFAULT '{}',               -- { title, description, imageFileId, noindex }
      status varchar(12) NOT NULL DEFAULT 'draft',   -- draft | published | archived
      published_blocks jsonb,                        -- what the public sees (draft edits don't go live until published)
      published_title varchar(200),
      published_summary text,
      published_seo jsonb,
      published_at timestamptz,
      sort_order integer NOT NULL DEFAULT 0,
      cover_file_id uuid REFERENCES files(id),
      updated_by uuid REFERENCES users(id),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX cms_pages_kind_idx ON cms_pages (kind, status, sort_order);
    CREATE TABLE cms_revisions (
      id bigserial PRIMARY KEY,
      page_id uuid NOT NULL REFERENCES cms_pages(id) ON DELETE CASCADE,
      title varchar(200) NOT NULL,
      summary text,
      blocks jsonb NOT NULL,
      seo jsonb NOT NULL,
      action varchar(16) NOT NULL,                   -- saved | published | unpublished | restored
      created_by uuid REFERENCES users(id),
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX cms_revisions_page_idx ON cms_revisions (page_id, id DESC);
  `);
}

export async function down({ context: sequelize }) {
  await sequelize.query(`DROP TABLE IF EXISTS cms_revisions, cms_pages; DELETE FROM app_settings WHERE key = 'site';`);
}
