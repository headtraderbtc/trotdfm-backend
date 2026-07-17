/* ============================================================
   THE ROYAL ORDER OF THE DARK FORCE OF MATTER
   Database migration — run once to set up tables on Railway Postgres
   Usage: npm run migrate   (reads DATABASE_URL from env)
   ============================================================ */

const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('railway')
    ? { rejectUnauthorized: false }
    : false
});

const SCHEMA = `

-- ============ MEMBERS (the central Order identity) ============
CREATE TABLE IF NOT EXISTS members (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT,                          -- null if invited but not yet activated
  initials      TEXT,
  color         TEXT DEFAULT '#a06de0',
  role          TEXT DEFAULT 'member',          -- member | admin
  status        TEXT DEFAULT 'pending',         -- pending | approved | rejected
  interest      TEXT,
  referral      TEXT,
  created_at    TIMESTAMPTZ DEFAULT now()
);

-- ============ PLANETS (founding + approved divisions) ============
CREATE TABLE IF NOT EXISTS planets (
  id            TEXT PRIMARY KEY,               -- slug, e.g. 'heritage'
  name          TEXT NOT NULL,
  description   TEXT,
  color         TEXT DEFAULT '#7b5ea7',
  glow          TEXT DEFAULT '#a07fd0',
  orbit_radius  INT  DEFAULT 130,
  angle         REAL DEFAULT 0,
  sub_url       TEXT,
  created_at    TIMESTAMPTZ DEFAULT now()
);

-- ============ MOONS (sub-projects within a planet) ============
CREATE TABLE IF NOT EXISTS moons (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  planet_id     TEXT REFERENCES planets(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  description   TEXT,
  url           TEXT,
  created_by    UUID REFERENCES members(id),
  created_at    TIMESTAMPTZ DEFAULT now()
);

-- ============ PLANET CONTRIBUTORS (many-to-many) ============
CREATE TABLE IF NOT EXISTS planet_contributors (
  planet_id   TEXT REFERENCES planets(id) ON DELETE CASCADE,
  member_id   UUID REFERENCES members(id) ON DELETE CASCADE,
  PRIMARY KEY (planet_id, member_id)
);

-- ============ COMETS (proposed new worlds, pending review) ============
CREATE TABLE IF NOT EXISTS comets (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  proposed_by   UUID REFERENCES members(id),
  name          TEXT NOT NULL,
  division      TEXT,                           -- closest planet id, or 'none'
  description   TEXT,
  contributors  TEXT,                            -- free text names, v1
  status        TEXT DEFAULT 'pending',          -- pending | approved | rejected
  angle         REAL DEFAULT 0,
  orbit_radius  INT  DEFAULT 240,
  created_at    TIMESTAMPTZ DEFAULT now(),
  reviewed_at   TIMESTAMPTZ
);

-- ============ ACTIVITY EVENTS (raw log from every connected project) ============
CREATE TABLE IF NOT EXISTS activity_events (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id     UUID REFERENCES members(id) ON DELETE CASCADE,
  planet_id     TEXT REFERENCES planets(id),
  source        TEXT NOT NULL,                  -- e.g. 'wiki', 'genealogy', 'zerodominus'
  action_type   TEXT NOT NULL,                  -- e.g. 'page_created', 'record_added', 'match_won'
  points        INT  NOT NULL DEFAULT 1,
  metadata      JSONB,
  created_at    TIMESTAMPTZ DEFAULT now()
);

-- ============ OAUTH CLIENTS (projects allowed to authenticate via the Order) ============
CREATE TABLE IF NOT EXISTS oauth_clients (
  client_id      TEXT PRIMARY KEY,
  client_secret  TEXT NOT NULL,
  name           TEXT NOT NULL,                  -- e.g. 'Wiki.js Knowledge Planet'
  redirect_uris  TEXT[] NOT NULL,
  created_at     TIMESTAMPTZ DEFAULT now()
);

-- ============ OAUTH AUTHORIZATION CODES (short-lived) ============
CREATE TABLE IF NOT EXISTS oauth_codes (
  code         TEXT PRIMARY KEY,
  client_id    TEXT REFERENCES oauth_clients(client_id),
  member_id    UUID REFERENCES members(id),
  redirect_uri TEXT NOT NULL,
  expires_at   TIMESTAMPTZ NOT NULL,
  used         BOOLEAN DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_activity_member   ON activity_events(member_id);
CREATE INDEX IF NOT EXISTS idx_activity_planet    ON activity_events(planet_id);
CREATE INDEX IF NOT EXISTS idx_activity_created   ON activity_events(created_at);
CREATE INDEX IF NOT EXISTS idx_comets_status       ON comets(status);
CREATE INDEX IF NOT EXISTS idx_members_status      ON members(status);

`;

const SEED = `

INSERT INTO planets (id, name, description, color, glow, orbit_radius, angle, sub_url) VALUES
  ('heritage',  'Heritage',  'Genealogy, ancestry & civil records',        '#7b5ea7', '#a07fd0', 115, 25,  'heritage/index.html'),
  ('knowledge', 'Knowledge', 'Wiki, library & doctrine',                   '#3a7abf', '#5da0e8', 152, 100, 'knowledge/index.html'),
  ('games',     'Games',     'ZeroDominus, chess & strategy',              '#bf5a3a', '#e07850', 132, 185, 'games/index.html'),
  ('research',  'Research',  'AI, consciousness & philosophy',             '#3a9e7a', '#55c99a', 168, 265, 'research/index.html'),
  ('education', 'Education', 'Learning systems & curriculum',              '#888070', '#aaa090', 108, 335, 'education/index.html')
ON CONFLICT (id) DO NOTHING;

`;

async function migrate() {
  const client = await pool.connect();
  try {
    console.log('Running schema migration...');
    await client.query('CREATE EXTENSION IF NOT EXISTS pgcrypto;'); // for gen_random_uuid()
    await client.query(SCHEMA);
    console.log('Schema created.');
    await client.query(SEED);
    console.log('Founding planets seeded.');
    console.log('Migration complete.');
  } catch (err) {
    console.error('Migration failed:', err);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();
