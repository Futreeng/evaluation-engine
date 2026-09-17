// Scalecraft runtime config.
// Flip `useMock` to false to talk to the real Growth Engine backend
// (server/routes/growth-engine.js). Everything is under one base path,
// including auth (/auth/login, /auth/signup).
window.SCALECRAFT_CONFIG = {
  useMock: false,
  apiBase: '/api/growth-engine/v1',
  pollIntervalMs: 2000,
  // Platforms the backend's validateEvaluationRequest accepts today.
  // Others still render in the form but are marked "soon" and can't be submitted.
  supportedPlatforms: ['instagram', 'x'],
  // Mock-only knobs
  mock: {
    queuedMs: 3000,        // time spent "queued" before running
    stageMs: 2200,         // per-dimension stage duration
    failIfHandleIncludes: 'private' // e.g. @sunrise_private → simulates a private profile
  }
};
