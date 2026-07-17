const express = require('express');
const pool = require('../db/pool');
const { attachMember, requireMember, requireAdmin } = require('../auth/session');
const { sendCometDecision } = require('../email/mailer');
const { pointsFor } = require('../db/scoring');

const router = express.Router();

/* ---- POST /api/comets ----
   Logged-in members: propose a new world. Spawns a comet pending review. */
router.post('/', attachMember, requireMember, async (req, res) => {
  const { name, division, description, contributors } = req.body;
  if (!name || !description) {
    return res.status(400).json({ error: 'name and description are required' });
  }

  const angle = Math.floor(Math.random() * 360);
  const orbitRadius = 220 + Math.floor(Math.random() * 60);

  const result = await pool.query(
    `INSERT INTO comets (proposed_by, name, division, description, contributors, angle, orbit_radius, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending')
     RETURNING *`,
    [req.member.sub, name, division || null, description, contributors || null, angle, orbitRadius]
  );

  res.json({ comet: result.rows[0] });
});

/* ---- GET /api/comets/approved ----
   Public: comets currently in orbit, for the homepage to render */
router.get('/approved', async (req, res) => {
  const result = await pool.query(
    `SELECT id, name, description, angle, orbit_radius, proposed_by
     FROM comets WHERE status = 'approved' ORDER BY created_at ASC`
  );
  res.json({ comets: result.rows });
});

/* ---- GET /api/comets ----
   Admin only: full list including pending, for the admin review page */
router.get('/', attachMember, requireAdmin, async (req, res) => {
  const result = await pool.query(`
    SELECT c.*, m.name AS proposer_name, m.email AS proposer_email
    FROM comets c
    LEFT JOIN members m ON m.id = c.proposed_by
    ORDER BY c.created_at DESC
  `);
  res.json({ comets: result.rows });
});

/* ---- POST /api/comets/:id/decision ----
   Admin only: approve or reject a comet. Approving awards points
   to the proposer and (optionally) creates a moon under a planet. */
router.post('/:id/decision', attachMember, requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { approved } = req.body;
  const status = approved ? 'approved' : 'rejected';

  const result = await pool.query(
    `UPDATE comets SET status = $1, reviewed_at = now() WHERE id = $2 RETURNING *`,
    [status, id]
  );
  const comet = result.rows[0];
  if (!comet) return res.status(404).json({ error: 'not found' });

  if (approved && comet.proposed_by) {
    await pool.query(
      `INSERT INTO activity_events (member_id, planet_id, source, action_type, points, metadata)
       VALUES ($1, $2, 'order_admin', 'comet_approved', $3, $4)`,
      [comet.proposed_by, comet.division !== 'none' ? comet.division : null, pointsFor('comet_approved'), JSON.stringify({ comet_id: comet.id, comet_name: comet.name })]
    );
  }

  if (comet.proposed_by) {
    const proposerResult = await pool.query('SELECT email FROM members WHERE id = $1', [comet.proposed_by]);
    const proposerEmail = proposerResult.rows[0] && proposerResult.rows[0].email;
    if (proposerEmail) await sendCometDecision(comet, proposerEmail, approved);
  }

  res.json({ comet });
});

module.exports = router;
