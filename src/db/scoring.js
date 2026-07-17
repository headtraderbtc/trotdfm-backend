/* ============================================================
   CONTRIBUTION SCORING
   Defines how many points each kind of action is worth.
   Any connected project (Wiki.js, genealogy tool, ZeroDominus, etc.)
   reports an action_type via POST /api/events, and this map decides
   how many points it's worth.

   Tune these freely — they're the dial that controls how fast
   planets grow and how members rank.
   ============================================================ */

const POINT_VALUES = {
  /* ---- small actions (1-2 pts) ---- */
  comment:        1,
  vote:           1,
  minor_edit:     2,
  match_played:   2,

  /* ---- medium actions (5-10 pts) ---- */
  page_created:   8,
  record_added:   6,
  article_published: 8,
  match_won:      6,
  tournament_entry: 5,

  /* ---- large actions (25+ pts) ---- */
  moon_approved:    30,   // a new sub-project they created gets approved
  comet_approved:   40,   // a new planet-level proposal gets approved
  project_led:      25,   // marked as lead contributor on a milestone

  /* fallback for unrecognized action types from a connected project */
  default:        1
};

function pointsFor(actionType) {
  return POINT_VALUES[actionType] !== undefined
    ? POINT_VALUES[actionType]
    : POINT_VALUES.default;
}

module.exports = { POINT_VALUES, pointsFor };
