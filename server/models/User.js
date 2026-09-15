const { v4: uid } = require("uuid");
const crypto = require("crypto");

// User model for Futreeng Growth Engine
// Handles user creation, authentication, tier management

class User {
  constructor(db) {
    this.db = db;
  }

  // Create new user with email and password
  async create(email, password) {
    const id = uid();
    const passwordHash = crypto.createHash("sha256").update(password).digest("hex");

    return new Promise((resolve, reject) => {
      this.db.run(
        `INSERT INTO users (id, email, passwordHash, tier) VALUES (?, ?, ?, ?)`,
        [id, email, passwordHash, "free"],
        function(err) {
          if (err) reject(err);
          else resolve({ id, email, tier: "free" });
        }
      );
    });
  }

  // Find user by email
  async findByEmail(email) {
    return new Promise((resolve, reject) => {
      this.db.get(
        `SELECT * FROM users WHERE email = ?`,
        [email],
        (err, row) => {
          if (err) reject(err);
          else resolve(row || null);
        }
      );
    });
  }

  // Find user by ID
  async findById(id) {
    return new Promise((resolve, reject) => {
      this.db.get(
        `SELECT * FROM users WHERE id = ?`,
        [id],
        (err, row) => {
          if (err) reject(err);
          else resolve(row || null);
        }
      );
    });
  }

  // Verify password
  verifyPassword(password, passwordHash) {
    const hash = crypto.createHash("sha256").update(password).digest("hex");
    return hash === passwordHash;
  }

  // Update tier (when user subscribes)
  async updateTier(userId, tier) {
    return new Promise((resolve, reject) => {
      this.db.run(
        `UPDATE users SET tier = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ?`,
        [tier, userId],
        function(err) {
          if (err) reject(err);
          else resolve({ id: userId, tier });
        }
      );
    });
  }

  // Get user's tier
  async getTier(userId) {
    const user = await this.findById(userId);
    return user ? user.tier : null;
  }
}

module.exports = User;
