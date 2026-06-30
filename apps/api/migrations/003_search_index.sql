CREATE TABLE IF NOT EXISTS search_documents (
  id UUID PRIMARY KEY,
  zone_id UUID NOT NULL REFERENCES navigation_zones(id) ON DELETE CASCADE,
  release_id UUID NOT NULL REFERENCES site_releases(id) ON DELETE CASCADE,
  address TEXT NOT NULL,
  category TEXT NOT NULL,
  slug TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  keywords TEXT NOT NULL,
  languages TEXT NOT NULL,
  headings TEXT NOT NULL,
  searchable_text TEXT NOT NULL,
  publisher TEXT NOT NULL,
  age_rating TEXT NOT NULL,
  family_safe BOOLEAN NOT NULL,
  content_cid TEXT NOT NULL,
  release_version TEXT NOT NULL,
  trust_level INTEGER NOT NULL DEFAULT 0,
  availability INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_search_documents_address ON search_documents(address);
CREATE INDEX IF NOT EXISTS idx_search_documents_category_slug ON search_documents(category, slug);
