const express = require("express");
const { requireAuth } = require("../middleware/auth");
const db = require("../db");
const { encrypt } = require("../crypto");

const router = express.Router();
router.use(requireAuth);

function maskTail(secret){
  if(!secret) return null;
  return secret.length > 4 ? `••••${secret.slice(-4)}` : "••••";
}

router.get("/", (req, res) => {
  const rec = db.getApiKeysRecord(req.user.id);
  res.json({
    claude: { configured: !!rec?.claudeKeyEnc, hint: rec?.claudeHint || null, workspaceId: rec?.claudeWorkspaceId || "" },
    gemini: { configured: !!rec?.geminiKeyEnc, hint: rec?.geminiHint || null },
    groq: { configured: !!rec?.groqKeyEnc, hint: rec?.groqHint || null },
  });
});

router.post("/", (req, res) => {
  const { claudeKey, geminiKey, groqKey, claudeWorkspaceId } = req.body || {};
  if(!claudeKey && !geminiKey && !groqKey && claudeWorkspaceId === undefined){
    return res.status(400).json({ error: "Provide at least one key to save." });
  }
  const patch = {};
  if(claudeKey){ patch.claudeKeyEnc = encrypt(claudeKey, process.env.ENCRYPTION_KEY); patch.claudeHint = maskTail(claudeKey); }
  if(geminiKey){ patch.geminiKeyEnc = encrypt(geminiKey, process.env.ENCRYPTION_KEY); patch.geminiHint = maskTail(geminiKey); }
  if(groqKey){ patch.groqKeyEnc = encrypt(groqKey, process.env.ENCRYPTION_KEY); patch.groqHint = maskTail(groqKey); }
  // Not a secret — it's an account/workspace identifier, not a credential —
  // so it's stored in plain text, unlike the keys above.
  if(claudeWorkspaceId !== undefined){ patch.claudeWorkspaceId = claudeWorkspaceId.trim() || null; }
  db.upsertApiKeys(req.user.id, patch);
  const rec = db.getApiKeysRecord(req.user.id);
  res.json({
    claude: { configured: !!rec.claudeKeyEnc, hint: rec.claudeHint || null, workspaceId: rec.claudeWorkspaceId || "" },
    gemini: { configured: !!rec.geminiKeyEnc, hint: rec.geminiHint || null },
    groq: { configured: !!rec.groqKeyEnc, hint: rec.groqHint || null },
  });
});

router.delete("/:which", (req, res) => {
  const which = req.params.which;
  if(which !== "claude" && which !== "gemini" && which !== "groq") return res.status(400).json({ error: "Unknown key." });
  db.deleteApiKey(req.user.id, which);
  res.json({ ok: true });
});

module.exports = router;