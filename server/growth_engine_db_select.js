/**
 * Picks the Growth Engine database backend once, for every module.
 *
 * DATABASE_URL set  → PostgreSQL (Railway, or any hosted Postgres)
 * otherwise         → sql.js file at server/data/growth_engine.db
 *
 * Both modules expose the same interface; nothing else should require
 * either file directly.
 */
module.exports = process.env.DATABASE_URL
  ? require("./growth_engine_db_postgres")
  : require("./growth_engine_db");
