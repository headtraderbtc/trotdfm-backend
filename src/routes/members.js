const express = require('express');
const pool = require('../db/pool');
const { hashPassword, verifyPassword, signSession, attachMember, requireMember, requireAdmin, SESSION_COOKIE } = require('../auth/session');
const { sendApplicationReceived, sendMembershipDecision } = require('../email/mailer');

const router = express.Router();

/* ---- POST /api/members/apply ----
   Public: submit a membership application (the "Join the Order" form) */
router.post('/apply', async (req, res) => {
  const { name, email, interest, referral, password } = req.body;
  if (!name || !email || !interest) {
    return res.status(400).json({ error: 'name, email, and interest are required' });
  }

  const existing = await pool.query('SELECT id FROM members WHERE email = $1', [email]);
  if (existing.rows.length > 0) {
    return res.status(409).json({ error: 'An application or account with this email already exists' });
  }

  const passwordHash = password ? await hashPassword(password) : null;
  const initials = name.trim().split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();

  const result = await pool.query(
    `INSERT INTO members (name, email, password_hash, initials, interest, referral, status)
     VALUES ($1, $2, $3, $4, $5, $6, 'pending')
     RETURNING id, name, email, status, created_at`,
    [name, email, passwordHash, initials, interest, referral || null]
  );

  const member = result.rows[0];
  await sendApplicationReceived(member);
  res.json({ member });
});

/* ---- POST /api/members/login ----
   Public: log in with email + password, sets session cookie */
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'email and password required' });

  const result = await pool.query('SELECT * FROM members WHERE email = $1', [email]);
  const member = result.rows[0];
  if (!member || member.status !== 'approved') {
    return res.status(401).json({ error: 'Invalid credentials or account not yet approved' });
  }

  const ok = await verifyPassword(password, member.password_hash);
  if (!ok) return res.status(401).json({ error: 'Invalid credentials' });

  const token = signSession(member);
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    domain: process.env.COOKIE_DOMAIN || undefined, // e.g. ".theorder.com" for cross-subdomain SSO
    maxAge: 30 * 24 * 60 * 60 * 1000
  });
  res.json({ member: { id: member.id, name: member.name, email: member.email, role: member.role } });
});

/* ---- POST /api/members/logout ---- */
router.post('/logout', (req, res) => {
  res.clearCookie(SESSION_COOKIE);
  res.json({ ok: true });
});

/* ---- GET /api/members/me ----
   Returns the currently logged-in member, or 401 */
router.get('/me', attachMember, requireMember, async (req, res) => {
  res.json({ member: req.member });
});

/* ---- GET /api/members/pending ----
   Admin only: list pending applications for the admin review page */
router.get('/pending', attachMember, requireAdmin, async (req, res) => {
  const result = await pool.query(
    `SELECT id, name, email, interest, referral, status, created_at
     FROM members ORDER BY created_at DESC`
  );
  res.json({ members: result.rows });
});

/* ---- POST /api/members/:id/decision ----
   Admin only: approve or reject a pending application */
router.post('/:id/decision', attachMember, requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { approved } = req.body; // boolean
  const status = approved ? 'approved' : 'rejected';

  const result = await pool.query(
    `UPDATE members SET status = $1 WHERE id = $2 RETURNING *`,
    [status, id]
  );
  const member = result.rows[0];
  if (!member) return res.status(404).json({ error: 'not found' });

  await sendMembershipDecision(member, approved);
  res.json({ member: { id: member.id, status: member.status } });
});

/* ---- GET /api/members/:id/contributions ----
   Public: a member's contribution score + breakdown, for the profile/rank view */
router.get('/:id/contributions', async (req, res) => {
  const { id } = req.params;

  const totalResult = await pool.query(
    `SELECT COALESCE(SUM(points), 0) AS total FROM activity_events WHERE member_id = $1`,
    [id]
  );
  const byPlanetResult = await pool.query(
    `SELECT planet_id, SUM(points) AS points
     FROM activity_events
     WHERE member_id = $1 AND planet_id IS NOT NULL
     GROUP BY planet_id
     ORDER BY points DESC`,
    [id]
  );
  const rankResult = await pool.query(`
    SELECT rank FROM (
      SELECT member_id, RANK() OVER (ORDER BY SUM(points) DESC) AS rank
      FROM activity_events
      GROUP BY member_id
    ) ranked WHERE member_id = $1
  `, [id]);

  res.json({
    total: Number(totalResult.rows[0].total),
    byPlanet: byPlanetResult.rows,
    rank: rankResult.rows[0] ? Number(rankResult.rows[0].rank) : null
  });
});

/* ---- GET /api/members/leaderboard ----
   Public: top contributors across the whole Order */
router.get('/leaderboard', async (req, res) => {
  const result = await pool.query(`
    SELECT m.id, m.name, m.initials, m.color, COALESCE(SUM(e.points), 0) AS total
    FROM members m
    LEFT JOIN activity_events e ON e.member_id = m.id
    WHERE m.status = 'approved'
    GROUP BY m.id
    ORDER BY total DESC
    LIMIT 20
  `);
  res.json({ leaderboard: result.rows });
});

module.exports = router;
