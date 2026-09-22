/**
 * Thumbnails (spec 1.4). Scraper image URLs are signed, expire and block
 * hotlinking, so at scrape time we download each post's thumbnail, resize it
 * to THUMB_WIDTH (320) and store a WebP copy of our own. Never store or
 * render the source URL.
 *
 * Storage is an interface: put(key, buffer) → public url, remove(prefix).
 *   THUMB_STORAGE=local   server/data/thumbs, served at /thumbs (dev; on a
 *                         host with an ephemeral disk files vanish on deploy
 *                         and the UI shows the neutral tile)
 *   THUMB_STORAGE=s3      any S3-compatible bucket (R2, S3, B2) — needs
 *                         npm i @aws-sdk/client-s3 and S3_* env vars
 *
 * A failed download never fails the report: the post simply has no thumbnail.
 */
const fs = require("fs");
const path = require("path");

const WIDTH = Number(process.env.THUMB_WIDTH || 320);
const QUALITY = Number(process.env.THUMB_QUALITY || 75);
const TIMEOUT = Number(process.env.THUMB_TIMEOUT_MS || 4000);
const CONCURRENCY = Number(process.env.THUMB_CONCURRENCY || 6);
const APP = (process.env.APP_URL || "").replace(/\/$/, "");

// ---- storage adapters
const localStore = {
  name: "local",
  dir: path.join(__dirname, "data", "thumbs"),
  async put(key, buf) { const f = path.join(this.dir, key); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, buf); return `${APP}/thumbs/${key}`; },
  async remove(prefix) { const d = path.join(this.dir, prefix); if (fs.existsSync(d)) fs.rmSync(d, { recursive: true, force: true }); },
};
function s3Store() {
  let S3;
  try { S3 = require("@aws-sdk/client-s3"); } catch { throw new Error("THUMB_STORAGE=s3 needs `npm i @aws-sdk/client-s3` in server/"); }
  const { S3Client, PutObjectCommand, ListObjectsV2Command, DeleteObjectsCommand } = S3;
  const client = new S3Client({ region: process.env.S3_REGION || "auto", endpoint: process.env.S3_ENDPOINT || undefined, forcePathStyle: !!process.env.S3_ENDPOINT, credentials: { accessKeyId: process.env.S3_ACCESS_KEY_ID, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY } });
  const bucket = process.env.S3_BUCKET; const base = (process.env.S3_PUBLIC_BASE || "").replace(/\/$/, "");
  return {
    name: "s3",
    async put(key, buf) { await client.send(new PutObjectCommand({ Bucket: bucket, Key: `thumbs/${key}`, Body: buf, ContentType: "image/webp", CacheControl: "public, max-age=31536000, immutable" })); return `${base}/thumbs/${key}`; },
    async remove(prefix) {
      let token;
      do {
        const list = await client.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: `thumbs/${prefix}`, ContinuationToken: token }));
        if (list.Contents?.length) await client.send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: list.Contents.map((o) => ({ Key: o.Key })) } }));
        token = list.IsTruncated ? list.NextContinuationToken : undefined;
      } while (token);
    },
  };
}
let store = null;
function storage() {
  if (store) return store;
  if (process.env.THUMB_STORAGE === "s3") { try { store = s3Store(); } catch (e) { console.warn(`[Thumbs] ${e.message} — using local storage`); store = localStore; } }
  else store = localStore;
  return store;
}
const enabled = () => process.env.THUMBS_DISABLED !== "true";

async function fetchAndShrink(url) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), TIMEOUT);
  try {
    const res = await fetch(url, { signal: ctl.signal, headers: { "user-agent": "Mozilla/5.0 (compatible; Scalecraft/1.0)", accept: "image/*" } });
    if (!res.ok) throw new Error(`status ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (!buf.length) throw new Error("empty");
    const sharp = require("sharp");
    return await sharp(buf).rotate().resize({ width: WIDTH, height: WIDTH, fit: "cover", position: "attention" }).webp({ quality: QUALITY }).toBuffer();
  } finally { clearTimeout(t); }
}

// Download + store thumbnails for every post that has a source URL, in
// parallel with a per-image timeout. Mutates posts: sets thumbnail_url,
// drops source_thumbnail_url. Returns { stored, failed }.
async function processPosts(posts, prefix) {
  const list = (posts || []).filter((p) => p && p.source_thumbnail_url && p.id);
  let stored = 0, failed = 0;
  if (!enabled() || !list.length) { for (const p of posts || []) delete p.source_thumbnail_url; return { stored, failed, skipped: true }; }
  const st = storage();
  let i = 0;
  const worker = async () => {
    while (i < list.length) {
      const p = list[i++];
      try { const buf = await fetchAndShrink(p.source_thumbnail_url); p.thumbnail_url = await st.put(`${prefix}/${String(p.id).replace(/[^a-zA-Z0-9_-]/g, "")}.webp`, buf); stored++; }
      catch (e) { p.thumbnail_url = null; failed++; if (process.env.THUMB_DEBUG) console.warn(`[Thumbs] ${p.id}: ${e.message}`); }
      delete p.source_thumbnail_url;
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, list.length) }, worker));
  for (const p of posts || []) delete p.source_thumbnail_url;
  return { stored, failed, store: st.name };
}

// Fill thumbnails on a finished report: posts, then the evidence items that
// reference them. Never throws.
async function processReport(reportBody, prefix) {
  try {
    const r = await processPosts(reportBody.posts, prefix);
    const byId = new Map((reportBody.posts || []).map((p) => [String(p.id), p.thumbnail_url || null]));
    for (const d of reportBody.scores?.dimensions || []) for (const e of d.evidence_posts || []) e.thumbnail_url = byId.get(String(e.post_id)) || null;
    reportBody.thumb_prefix = prefix;
    if (!r.skipped) console.log(`[Thumbs] ${prefix}: ${r.stored} stored, ${r.failed} failed (${r.store})`);
  } catch (e) { console.warn("[Thumbs] processing failed:", e.message); }
}
async function remove(prefix) { if (!prefix) return; try { await storage().remove(prefix); } catch (e) { console.warn(`[Thumbs] remove ${prefix} failed:`, e.message); } }

module.exports = { processPosts, processReport, remove, storage, localDir: localStore.dir };
