const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const db = require("../db");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

const COOKIE_OPTS = {
  httpOnly: true,
  sameSite: "lax",
  secure: process.env.NODE_ENV === "production",
  maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
};

function issueSession(res, user){
  const token = jwt.sign({ sub: user.id, email: user.email }, process.env.JWT_SECRET, { expiresIn: "30d" });
  res.cookie("convergence_session", token, COOKIE_OPTS);
}

router.post("/register", async (req, res) => {
  const { email, password } = req.body || {};
  if(!email || !password || password.length < 8){
    return res.status(400).json({ error: "Email and a password of at least 8 characters are required." });
  }
  try{
    const passwordHash = await bcrypt.hash(password, 12);
    const user = db.createUser(email.trim().toLowerCase(), passwordHash);
    issueSession(res, user);
    res.json({ email: user.email });
  }catch(err){
    res.status(409).json({ error: err.message });
  }
});

router.post("/login", async (req, res) => {
  const { email, password } = req.body || {};
  if(!email || !password) return res.status(400).json({ error: "Email and password are required." });
  const user = db.getUserByEmail(email.trim());
  if(!user) return res.status(401).json({ error: "Incorrect email or password." });
  const ok = await bcrypt.compare(password, user.passwordHash);
  if(!ok) return res.status(401).json({ error: "Incorrect email or password." });
  issueSession(res, user);
  res.json({ email: user.email });
});

router.post("/logout", (req, res) => {
  res.clearCookie("convergence_session", COOKIE_OPTS);
  res.json({ ok: true });
});

router.get("/me", requireAuth, (req, res) => {
  res.json({ email: req.user.email });
});

module.exports = router;