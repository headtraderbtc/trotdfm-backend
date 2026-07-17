/* ============================================================
   OAUTH2 PROVIDER
   Makes the Order act as a "Login with the Order" identity provider.
   Wiki.js (and any future project) configures a "Generic OAuth2"
   login strategy pointing at these endpoints:

     Authorization URL:  https://your-backend.up.railway.app/oauth/authorize
     Token URL:           https://your-backend.up.railway.app/oauth/token
     User Info URL:        https://your-backend.up.railway.app/oauth/userinfo

   This is a deliberately minimal Authorization Code flow —
   enough for SSO across your own projects, not a full OAuth spec
   implementation. Good enough to start; can be hardened later.
   ============================================================ */

const express = require('express');
const crypto = require('crypto');
const pool = require('../db/pool');
const { verifySession, SESSION_COOKIE } = require('../auth/session');

const router = express.Router();

/* ---- STEP 1: /oauth/authorize ----
   The project (e.g. Wiki.js) redirects the user's browser here.
   If the user has an Order session cookie, we issue a short-lived
   code and redirect back to the project. If not, we redirect to
   the Order's login page first. */
router.get('/authorize', async (req, res) => {
  const { client_id, redirect_uri, state } = req.query;
  if (!client_id || !redirect_uri) {
    return res.status(400).send('Missing client_id or redirect_uri');
  }

  const clientResult = await pool.query(
    'SELECT * FROM oauth_clients WHERE client_id = $1',
    [client_id]
  );
  const client = clientResult.rows[0];
  if (!client) return res.status(400).send('Unknown client_id');
  if (!client.redirect_uris.includes(redirect_uri)) {
    return res.status(400).send('redirect_uri not registered for this client');
  }

  const sessionToken = req.cookies && req.cookies[SESSION_COOKIE];
  const payload = sessionToken ? verifySession(sessionToken) : null;

  if (!payload) {
    /* not logged in — bounce to the Order's login page, which will
       redirect back here once authenticated */
    const returnTo = encodeURIComponent(req.originalUrl);
    return res.redirect(`${process.env.FRONTEND_URL}/login/index.html?returnTo=${returnTo}`);
  }

  const code = crypto.randomBytes(24).toString('hex');
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 min

  await pool.query(
    `INSERT INTO oauth_codes (code, client_id, member_id, redirect_uri, expires_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [code, client_id, payload.sub, redirect_uri, expiresAt]
  );

  const url = new URL(redirect_uri);
  url.searchParams.set('code', code);
  if (state) url.searchParams.set('state', state);
  res.redirect(url.toString());
});

/* ---- STEP 2: /oauth/token ----
   The project's SERVER (not the browser) calls this with the code
   plus its client_secret, and gets back an access token. */
router.post('/token', express.urlencoded({ extended: true }), express.json(), async (req, res) => {
  const { code, client_id, client_secret, redirect_uri } = req.body;
  if (!code || !client_id || !client_secret) {
    return res.status(400).json({ error: 'missing_params' });
  }

  const clientResult = await pool.query(
    'SELECT * FROM oauth_clients WHERE client_id = $1',
    [client_id]
  );
  const client = clientResult.rows[0];
  if (!client || client.client_secret !== client_secret) {
    return res.status(401).json({ error: 'invalid_client' });
  }

  const codeResult = await pool.query(
    `SELECT * FROM oauth_codes WHERE code = $1 AND client_id = $2 AND used = FALSE`,
    [code, client_id]
  );
  const codeRow = codeResult.rows[0];
  if (!codeRow || new Date(codeRow.expires_at) < new Date()) {
    return res.status(400).json({ error: 'invalid_or_expired_code' });
  }
  if (redirect_uri && codeRow.redirect_uri !== redirect_uri) {
    return res.status(400).json({ error: 'redirect_uri_mismatch' });
  }

  await pool.query('UPDATE oauth_codes SET used = TRUE WHERE code = $1', [code]);

  const memberResult = await pool.query('SELECT * FROM members WHERE id = $1', [codeRow.member_id]);
  const member = memberResult.rows[0];

  /* simple opaque access token: in production consider a signed JWT instead */
  const accessToken = crypto.randomBytes(32).toString('hex');
  await pool.query(
    `INSERT INTO activity_events (member_id, planet_id, source, action_type, points, metadata)
     VALUES ($1, NULL, $2, 'oauth_login', 0, $3)`,
    [member.id, client.name, JSON.stringify({ access_token_issued: true })]
  );

  /* NOTE: for a v1 we just embed the member id in the response directly
     so the calling project can immediately fetch /oauth/userinfo with it.
     Store accessToken -> member.id somewhere (e.g. Redis or a table)
     if you want token expiry / revocation later. */
  res.json({
    access_token: accessToken,
    token_type: 'bearer',
    expires_in: 3600,
    member_id: member.id
  });
});

/* ---- STEP 3: /oauth/userinfo ----
   The project calls this with the access token to get profile info
   to create/match a local account. v1: pass member_id directly,
   since we are not yet persisting access tokens server-side. */
router.get('/userinfo', async (req, res) => {
  const memberId = req.query.member_id;
  if (!memberId) return res.status(400).json({ error: 'missing_member_id' });

  const result = await pool.query(
    'SELECT id, name, email, initials, color, role FROM members WHERE id = $1 AND status = $2',
    [memberId, 'approved']
  );
  const member = result.rows[0];
  if (!member) return res.status(404).json({ error: 'not_found' });

  res.json({
    sub: member.id,
    name: member.name,
    email: member.email,
    picture: null,
    role: member.role
  });
});

module.exports = router;
