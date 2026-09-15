const express = require("express");
const { requireAuth } = require("../middleware/auth");
const db = require("../db");

const router = express.Router();
router.use(requireAuth);

router.get("/", (req, res) => {
  res.json(db.listSessions(req.user.id));
});

router.post("/", (req, res) => {
  const { name } = req.body || {};
  const session = db.createSession(req.user.id, name);
  res.json(session);
});

router.get("/:id", (req, res) => {
  const session = db.getSession(req.user.id, req.params.id);
  if(!session) return res.status(404).json({ error: "Session not found." });
  res.json(session);
});

router.put("/:id", (req, res) => {
  const { name, turns, dialogue, settings } = req.body || {};
  const patch = {};
  if(name !== undefined) patch.name = name;
  if(turns !== undefined) patch.turns = turns;
  if(dialogue !== undefined) patch.dialogue = dialogue;
  if(settings !== undefined) patch.settings = settings;
  const session = db.updateSession(req.user.id, req.params.id, patch);
  if(!session) return res.status(404).json({ error: "Session not found." });
  res.json(session);
});

router.delete("/:id", (req, res) => {
  const ok = db.deleteSession(req.user.id, req.params.id);
  if(!ok) return res.status(404).json({ error: "Session not found." });
  res.json({ ok: true });
});

module.exports = router;
