// Scalecraft runtime config.
// Flip `useMock` to false to talk to the real Growth Engine backend
// (server/routes/growth-engine.js). Everything is under one base path,
// including auth (/auth/login, /auth/signup).
// PRODUCTION CONFIG - REAL DATA ONLY
// useMock MUST be false. If true, entire evaluation is simulated.
// apiBase MUST point to real Railway backend. This is verified in browser console.
window.SCALECRAFT_CONFIG = {
  useMock: false,  // ⚠️ CRITICAL: MUST BE FALSE FOR PRODUCTION
  apiBase: 'https://discerning-wisdom-production-6696.up.railway.app/api/growth-engine/v1',
  pollIntervalMs: 2000,
  supportedPlatforms: ['instagram', 'x']
  // NOTE: mock-api.js is NOT loaded. No fallback to mock data.
  // All evaluation is real: Twitter/Instagram API → Railway backend → LLM → Report
};
