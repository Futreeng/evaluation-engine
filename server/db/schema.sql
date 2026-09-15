-- Futreeng Growth Engine Database Schema
-- SQLite (MVP) / Postgres-compatible

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  passwordHash TEXT NOT NULL,
  stripeCustomerId TEXT,
  tier TEXT DEFAULT 'free' CHECK(tier IN ('free', 'growth', 'business')),
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS socialProfiles (
  id TEXT PRIMARY KEY,
  userId TEXT NOT NULL,
  handle TEXT NOT NULL,
  platform TEXT NOT NULL CHECK(platform IN ('instagram', 'tiktok', 'x', 'facebook', 'linkedin')),
  category TEXT NOT NULL CHECK(category IN ('boutique_fitness', 'fitness', 'food_beverage', 'retail', 'professional_services')),
  businessName TEXT,
  businessMetricsJson TEXT, -- JSON string
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE(userId, handle, platform)
);

CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  userId TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('audit', 'refresh', 'competitor_analysis', 'reconciliation')),
  status TEXT DEFAULT 'queued' CHECK(status IN ('queued', 'processing', 'complete', 'failed')),
  profileId TEXT,
  inputJson TEXT NOT NULL, -- JSON string: {handle, platform, category, businessMetrics}
  resultJson TEXT, -- JSON string, null until complete
  error TEXT,
  convergenceSessionId TEXT, -- references Convergence session for audit tracking
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  startedAt DATETIME,
  completedAt DATETIME,
  FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (profileId) REFERENCES socialProfiles(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS audits (
  id TEXT PRIMARY KEY,
  profileId TEXT NOT NULL,
  jobId TEXT NOT NULL,
  overallScore INTEGER CHECK(overallScore >= 0 AND overallScore <= 100),
  scoresJson TEXT NOT NULL, -- JSON: {authenticity, engagement, growth, consistency, categoryAverage, recommendations}
  growthPathJson TEXT, -- JSON: {phases: [{range, visibleAction, locked}]}
  competitorAnalysisJson TEXT, -- JSON, optional
  businessReconciliationJson TEXT, -- JSON, optional (Tier2)
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  auditedAt DATETIME,
  expiresAt DATETIME, -- for refresh scheduling
  FOREIGN KEY (profileId) REFERENCES socialProfiles(id) ON DELETE CASCADE,
  FOREIGN KEY (jobId) REFERENCES jobs(id) ON DELETE CASCADE,
  UNIQUE(jobId)
);

CREATE TABLE IF NOT EXISTS contentCalendar (
  id TEXT PRIMARY KEY,
  profileId TEXT NOT NULL,
  taskDate DATE NOT NULL,
  task TEXT NOT NULL,
  contentPrompt TEXT,
  contentGenerated TEXT, -- filled after user runs prompt
  status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'drafted', 'published')),
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (profileId) REFERENCES socialProfiles(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS convergenceSessions (
  id TEXT PRIMARY KEY,
  userId TEXT NOT NULL,
  jobId TEXT,
  mode TEXT NOT NULL, -- 'audit', 'calendar', 'competitor', etc.
  status TEXT DEFAULT 'active',
  turnsJson TEXT, -- JSON array of turns
  exportedAt DATETIME,
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (jobId) REFERENCES jobs(id) ON DELETE SET NULL
);

-- Indexes for performance
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_socialProfiles_userId ON socialProfiles(userId);
CREATE INDEX idx_jobs_userId_status ON jobs(userId, status);
CREATE INDEX idx_jobs_profileId ON jobs(profileId);
CREATE INDEX idx_audits_profileId ON audits(profileId);
CREATE INDEX idx_audits_jobId ON audits(jobId);
CREATE INDEX idx_contentCalendar_profileId_date ON contentCalendar(profileId, taskDate);
CREATE INDEX idx_convergenceSessions_userId ON convergenceSessions(userId);
