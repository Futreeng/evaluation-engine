const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const geDb = require("./growth_engine_db_select");

const JWT_SECRET = process.env.JWT_SECRET;
const TOKEN_EXPIRY = "7d";

async function generateJWT(userId, email) {
  const token = jwt.sign(
    { id: userId, email },
    JWT_SECRET,
    { expiresIn: TOKEN_EXPIRY }
  );
  return token;
}

async function verifyJWT(token) {
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    return decoded;
  } catch (err) {
    return null;
  }
}

async function signup(email, password, companyName, profile = null) {
  if (!email || !password) {
    throw new Error("Email and password required");
  }

  const existing = await geDb.getUserByEmail(email);
  if (existing) {
    throw new Error("Email already registered");
  }

  const salt = await bcrypt.genSalt(10);
  const passwordHash = await bcrypt.hash(password, salt);

  let user = await geDb.createUser(email, passwordHash, companyName);
  if (profile && (profile.isBusiness !== undefined || profile.niche !== undefined)) { try { user = await geDb.setUserProfile(user.userId, profile); } catch { /* optional */ } }
  // Claim any free reports this email ran before signing up.
  try { await geDb.adoptAnonymousReports(user.userId, email); } catch (err) { console.warn("[Auth] adopt reports failed:", err.message); }

  // Create default entitlement for new user
  await geDb.getOrCreateEntitlement(user.userId);

  const token = await generateJWT(user.userId, email);

  return {
    token,
    user: {
      user_id: user.userId,
      email: user.email,
      company_name: user.companyName,
    },
  };
}

async function login(email, password) {
  if (!email || !password) {
    throw new Error("Email and password required");
  }

  const user = await geDb.getUserByEmail(email);
  if (!user) {
    throw new Error("Invalid email or password");
  }

  const match = await bcrypt.compare(password, user.passwordHash);
  if (!match) {
    throw new Error("Invalid email or password");
  }

  const token = await generateJWT(user.userId, email);

  return {
    token,
    user: {
      user_id: user.userId,
      email: user.email,
      company_name: user.companyName,
    },
  };
}

// Password reset: a random token is emailed; only its sha256 is stored.
// Always resolves (no account enumeration); the caller sends the email.
const crypto = require("crypto");
const RESET_TTL_MS = 60 * 60 * 1000;
async function requestPasswordReset(email) {
  const user = await geDb.getUserByEmail(String(email || "").trim().toLowerCase());
  if (!user) return null;
  const token = crypto.randomBytes(32).toString("hex");
  await geDb.createPasswordReset(user.userId, crypto.createHash("sha256").update(token).digest("hex"), Date.now() + RESET_TTL_MS);
  return { token, email: user.email, userId: user.userId };
}
async function resetPassword(token, newPassword) {
  if (!token || typeof token !== "string" || !/^[a-f0-9]{64}$/.test(token)) throw new Error("This reset link isn't valid.");
  const userId = await geDb.consumePasswordReset(crypto.createHash("sha256").update(token).digest("hex"));
  if (!userId) throw new Error("This reset link has expired or was already used. Request a new one.");
  const salt = await bcrypt.genSalt(10);
  await geDb.updateUserPassword(userId, await bcrypt.hash(newPassword, salt));
  const user = await geDb.getUserById(userId);
  return { token: await generateJWT(user.userId, user.email), user: { user_id: user.userId, email: user.email } };
}

module.exports = {
  generateJWT,
  verifyJWT,
  requestPasswordReset,
  resetPassword,
  signup,
  login,
};
