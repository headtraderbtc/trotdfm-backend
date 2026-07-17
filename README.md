# The Order Backend

Central identity, contribution tracking, and admin API for The Royal Order of
The Dark Force of Matter. One account, many worlds.

## What this does

- **Membership**: applications, admin approval, login/session cookies.
- **Comets**: propose-a-new-world flow, admin approve/reject, awards points on approval.
- **Contribution scoring**: every connected project (Wiki.js, the genealogy tool,
  ZeroDominus, future projects) reports activity to `POST /api/events`. Points
  are summed per member and per planet, driving both the universe map (planet
  size/glow) and member rank/leaderboard.
- **OAuth2 provider**: lets other projects offer "Login with the Order" instead
  of separate accounts. Wiki.js supports this out of the box via its
  "Generic OAuth2" login strategy in admin settings.
- **Email**: application received, membership approved/rejected, comet
  approved/rejected. Pluggable SMTP — works with Gmail, Outlook, SendGrid,
  Mailgun, or anything else. Leave SMTP env vars blank to skip sending emails
  during early testing; everything else still works.

## Deploying on Railway

1. Create a new Railway project, add this repo (or push this folder to a new
   GitHub repo and connect it).
2. Add a **Postgres** database to the project (Railway → New → Database →
   Postgres). Railway automatically sets `DATABASE_URL` for you.
3. Set the other environment variables from `.env.example` in Railway's
   Variables tab — at minimum `JWT_SECRET` and `FRONTEND_URL`.
4. Deploy. Then run the migration once, either via Railway's one-off command
   feature or by running locally with `DATABASE_URL` pointed at Railway's DB:

   ```
   npm install
   npm run migrate
   ```

   This creates all tables and seeds the five founding planets.

5. Your backend is now live at something like
   `https://trotdfm-backend-production.up.railway.app`.

## Connecting the frontend (the universe homepage)

The static site (the HTML/CSS/JS universe you already have) needs to call this
API instead of using `localStorage`. The endpoints it needs:

```
GET    /api/planets                  homepage: planet list + activity for sizing
GET    /api/comets/approved          homepage: comets currently in orbit
POST   /api/members/apply            join page: submit application
POST   /api/comets                   propose page: submit a new world (requires login)
GET    /api/members/pending          admin page: list applications
POST   /api/members/:id/decision     admin page: approve/reject application
GET    /api/comets                   admin page: list all comets
POST   /api/comets/:id/decision      admin page: approve/reject comet
GET    /api/members/leaderboard      for a future "top contributors" page
GET    /api/members/:id/contributions for a member's own profile/rank
```

All these expect/return JSON. Update the `fetch` calls in `join/index.html`,
`propose/index.html`, `admin/index.html`, and `js/universe.js` to point at your
Railway backend URL instead of `localStorage`.

## Connecting other projects (Wiki.js, genealogy tool, ZeroDominus)

### A. Single sign-on (let members log in once)

1. Register the project as an OAuth client by inserting a row into
   `oauth_clients` (no UI for this yet — run via `psql` or a one-off script):

   ```sql
   INSERT INTO oauth_clients (client_id, client_secret, name, redirect_uris)
   VALUES (
     'wikijs',
     'generate-a-long-random-secret-here',
     'Wiki.js Knowledge Planet',
     ARRAY['https://wiki.yourorder.com/login/callback']
   );
   ```

2. In Wiki.js admin → Login → add a "Generic OAuth2" strategy:
   - Authorization URL: `https://your-backend.up.railway.app/oauth/authorize`
   - Token URL: `https://your-backend.up.railway.app/oauth/token`
   - User Info URL: `https://your-backend.up.railway.app/oauth/userinfo`
   - Client ID / Secret: the values you inserted above.

### B. Reporting contribution events

Whenever something point-worthy happens in a connected project (a wiki page is
published, a genealogy record is added, a game is won), that project's server
calls:

```
POST https://your-backend.up.railway.app/api/events
Authorization: Bearer <client_secret from oauth_clients>
Content-Type: application/json

{
  "member_id": "the member's Order UUID",
  "planet_id": "knowledge",
  "action_type": "page_created",
  "metadata": { "page_title": "Founding of the Order" }
}
```

The point values for each `action_type` live in `src/db/scoring.js` — tune
them there. Unrecognized action types default to 1 point so nothing breaks if
a project sends something new before you've assigned it a value.

## Project structure

```
src/
  server.js          entry point
  db/
    pool.js          shared Postgres connection
    migrate.js        schema + seed data
    scoring.js         point values per action type
  auth/
    session.js         password hashing, JWT sessions, middleware
  email/
    mailer.js           pluggable SMTP sending + templates
  routes/
    members.js          signup/login/admin approval/leaderboard
    comets.js            propose/approve/reject new worlds
    planets.js           planet data + the /api/events integration point
    oauth.js             OAuth2 provider for SSO across projects
```

## Security notes for before going fully live

- Set a strong, random `JWT_SECRET`.
- The OAuth2 implementation here is intentionally minimal (good enough for
  trusted, self-built projects). If you ever let third parties build against
  it, harden token storage/expiry and add PKCE.
- Consider rate-limiting `/api/members/apply` and `/api/comets` to prevent
  spam submissions once the site is public.
