const jwt = require("jsonwebtoken");

// JWT Authentication Middleware
// Verifies bearer tokens, attaches user to request

const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRE = process.env.JWT_EXPIRE || "7d";

// Generate JWT token for authenticated user
function generateToken(userId, tier = "free") {
  if (!JWT_SECRET) {
    throw new Error("JWT_SECRET environment variable not set");
  }

  return jwt.sign(
    {
      userId,
      tier,
      iat: Math.floor(Date.now() / 1000),
    },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRE }
  );
}

// Verify JWT token and extract claims
function verifyToken(token) {
  if (!JWT_SECRET) {
    throw new Error("JWT_SECRET environment variable not set");
  }

  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (err) {
    if (err.name === "TokenExpiredError") {
      throw new Error("Token expired");
    }
    if (err.name === "JsonWebTokenError") {
      throw new Error("Invalid token");
    }
    throw err;
  }
}

// Express middleware: extract and verify token from Authorization header
function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    return res.status(401).json({ error: "No authorization header" });
  }

  const [scheme, token] = authHeader.split(" ");

  if (scheme !== "Bearer") {
    return res.status(401).json({ error: "Invalid authorization scheme" });
  }

  if (!token) {
    return res.status(401).json({ error: "No token provided" });
  }

  try {
    const decoded = verifyToken(token);
    req.user = {
      id: decoded.userId,
      tier: decoded.tier,
      iat: decoded.iat,
      exp: decoded.exp,
    };
    next();
  } catch (err) {
    return res.status(401).json({ error: err.message });
  }
}

// Middleware: Require specific tier
function requireTier(tier) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const tiers = ["free", "growth", "business"];
    const requiredIndex = tiers.indexOf(tier);
    const userIndex = tiers.indexOf(req.user.tier);

    if (userIndex < requiredIndex) {
      return res.status(403).json({
        error: `This feature requires ${tier} tier or higher`,
        currentTier: req.user.tier,
        requiredTier: tier,
      });
    }

    next();
  };
}

// Optional auth: attach user if token present, but don't require it
function optionalAuth(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    req.user = null;
    return next();
  }

  const [scheme, token] = authHeader.split(" ");

  if (scheme !== "Bearer" || !token) {
    req.user = null;
    return next();
  }

  try {
    const decoded = verifyToken(token);
    req.user = {
      id: decoded.userId,
      tier: decoded.tier,
      iat: decoded.iat,
      exp: decoded.exp,
    };
  } catch (err) {
    req.user = null;
  }

  next();
}

module.exports = {
  generateToken,
  verifyToken,
  authMiddleware,
  requireTier,
  optionalAuth,
};
