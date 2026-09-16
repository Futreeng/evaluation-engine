const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const geDb = require("./growth_engine_db");

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

async function signup(email, password, companyName) {
  if (!email || !password) {
    throw new Error("Email and password required");
  }

  const existing = await geDb.getUserByEmail(email);
  if (existing) {
    throw new Error("Email already registered");
  }

  const salt = await bcrypt.genSalt(10);
  const passwordHash = await bcrypt.hash(password, salt);

  const user = await geDb.createUser(email, passwordHash, companyName);

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

module.exports = {
  generateJWT,
  verifyJWT,
  signup,
  login,
};
