/**
 * Assay — storage contract, plus an in-memory implementation.
 *
 * A store implements five methods. Anything that can hold rows will do:
 * Postgres, SQLite, a warehouse table, a file. The core never issues SQL, so
 * a host product keeps its own database conventions.
 *
 *   putOffers(rows)                      insert offer rows
 *   markTaken({domain, subject_id, session_id, key, taken_at})
 *   putOutcome(row)                      insert one outcome
 *   observations({domain, strata})       -> [{subject_id, key, taken, delta, strata}]
 *   outcomesWithExternal({domain, externalKey}) -> [{delta, external}]
 *
 * `observations` is the only interesting one: it joins offers to outcomes on
 * subject + session, so each row is one recommendation shown to one subject
 * with the movement that followed. Offers with no outcome yet are dropped —
 * the subject has not been measured again, so they say nothing either way.
 */

class MemoryStore {
  constructor() { this.offers = []; this.outcomes = []; }

  async putOffers(rows) { this.offers.push(...rows); return rows.length; }

  async markTaken({ domain, subject_id, session_id, key, taken_at }) {
    let n = 0;
    for (const o of this.offers) {
      if (o.domain !== domain || o.subject_id !== subject_id || o.key !== key) continue;
      if (session_id && o.session_id && o.session_id !== session_id) continue;
      if (o.taken_at == null) { o.taken_at = taken_at; n++; }
    }
    return n;
  }

  async putOutcome(row) { this.outcomes.push(row); return 1; }

  async observations({ domain, strata = null }) {
    const out = [];
    for (const o of this.offers) {
      if (o.domain !== domain) continue;
      if (strata != null && o.strata !== strata) continue;
      // The outcome that closed this offer: same subject, same session where
      // one is recorded, measured after the offer was made.
      const r = this.outcomes.find((x) =>
        x.domain === domain && x.subject_id === o.subject_id &&
        (!o.session_id || !x.session_id || x.session_id === o.session_id) &&
        x.created_at >= o.created_at);
      if (!r) continue;
      out.push({
        subject_id: o.subject_id, key: o.key, strata: o.strata,
        taken: o.taken_at != null, delta: r.delta, arm: o.arm, position: o.position,
      });
    }
    return out;
  }

  async outcomesWithExternal({ domain, externalKey }) {
    return this.outcomes
      .filter((r) => r.domain === domain)
      .map((r) => {
        let meta = {};
        try { meta = r.meta ? JSON.parse(r.meta) : {}; } catch { /* absent is fine */ }
        return { delta: r.delta, external: Number(meta[externalKey]) };
      })
      .filter((r) => Number.isFinite(r.external));
  }
}

/**
 * Schema for a SQL-backed store. Two tables, no foreign keys to the host —
 * Assay is meant to be liftable into its own database without dragging the
 * product's schema with it.
 */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS assay_offers (
  id          TEXT PRIMARY KEY,
  domain      TEXT NOT NULL,
  batch_id    TEXT,
  subject_id  TEXT NOT NULL,
  session_id  TEXT,
  key         TEXT NOT NULL,
  position    INTEGER,
  arm         TEXT,
  strata      TEXT,
  score_at    DOUBLE PRECISION,
  taken_at    BIGINT,
  meta        TEXT,
  created_at  BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_assay_offers_lookup ON assay_offers (domain, subject_id, key);
CREATE INDEX IF NOT EXISTS idx_assay_offers_strata ON assay_offers (domain, strata);

CREATE TABLE IF NOT EXISTS assay_outcomes (
  id          TEXT PRIMARY KEY,
  domain      TEXT NOT NULL,
  subject_id  TEXT NOT NULL,
  session_id  TEXT,
  before      DOUBLE PRECISION,
  after       DOUBLE PRECISION,
  delta       DOUBLE PRECISION,
  days        INTEGER,
  meta        TEXT,
  created_at  BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_assay_outcomes_subject ON assay_outcomes (domain, subject_id);
`;

module.exports = { MemoryStore, SCHEMA };
