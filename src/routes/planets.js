const express = require('express');
const pool = require('../db/pool');
const { pointsFor } = require('../db/scoring');

const router = express.Router();

/* ---- GET /api/planets ----
   Public: all founding planets with computed size/activity status,
   used by the homepage to render the universe. */
router.get('/', async (req, res) => {
  const planetsResult = await pool.query('SELECT * FROM planets ORDER BY angle ASC');
  const planets = planetsResult.rows;

  const activityResult = await pool.query(`
    SELECT planet_id, MAX(created_at) AS last_activity
    FROM activity_events
    WHERE planet_id IS NOT NULL
    GROUP BY planet_id
  `);
  const lastActivityMap = {};
  activityResult.rows.forEach(r => { lastActivityMap[r.planet_id] = r.last_activity; });

  const contributorsResult = await pool.query(`
    SELECT planet_id, COUNT(DISTINCT member_id) AS count
    FROM planet_contributors GROUP BY planet_id
  `);
  const contributorCountMap = {};
  contributorsResult.rows.forEach(r => { contributorCountMap[r.planet_id] = Number(r.count); });

  const enriched = planets.map(p => ({
    id: p.id,
    name: p.name,
    description: p.description,
    color: p.color,
    glow: p.glow,
    orbitRadius: p.orbit_radius,
    angle: p.angle,
    subUrl: p.sub_url,
    lastActivity: lastActivityMap[p.id] || null,
    contributorCount: contributorCountMap[p.id] || 0
  }));

  res.json({ planets: enriched });
});

/* ---- GET /api/planets/:id/moons ----
   Public: sub-projects (moons) under a planet */
router.get('/:id/moons', async (req, res) => {
  const result = await pool.query(
    'SELECT * FROM moons WHERE planet_id = $1 ORDER BY created_at ASC',
    [req.params.id]
  );
  res.json({ moons: result.rows });
});

/* ---- POST /api/events ----
   Called by CONNECTED PROJECTS (Wiki.js, genealogy tool, ZeroDominus)
   whenever a member does something worth tracking. This is the single
   integration point every project needs to call.

   Auth: a project-specific API key, passed as a Bearer token, checked
   against the oauth_clients table (reusing client_secret as the key
   for simplicity — swap for a dedicated api_keys table if you want
   separate rotation later).

   Body:
   {
     "member_id": "...",
     "planet_id": "knowledge",
     "action_type": "page_created",
     "metadata": { "page_title": "..." }
   }
*/
router.post('/events', async (req, res) => {
  const authHeader = req.headers.authorization || '';
  const apiKey = authHeader.replace('Bearer ', '').trim();
  if (!apiKey) return res.status(401).json({ error: 'missing api key' });

  const clientResult = await pool.query(
    'SELECT * FROM oauth_clients WHERE client_secret = $1',
    [apiKey]
  );
  const client = clientResult.rows[0];
  if (!client) return res.status(401).json({ error: 'invalid api key' });

  const { member_id, planet_id, action_type, metadata } = req.body;
  if (!member_id || !action_type) {
    return res.status(400).json({ error: 'member_id and action_type are required' });
  }

  const points = pointsFor(action_type);

  const result = await pool.query(
    `INSERT INTO activity_events (member_id, planet_id, source, action_type, points, metadata)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [member_id, planet_id || null, client.name, action_type, points, metadata ? JSON.stringify(metadata) : null]
  );

  /* ensure this member shows up as a contributor on the planet */
  if (planet_id) {
    await pool.query(
      `INSERT INTO planet_contributors (planet_id, member_id)
       VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [planet_id, member_id]
    );
  }

  res.json({ event: result.rows[0], points_awarded: points });
});

module.exports = router;
