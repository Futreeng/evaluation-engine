// Scalecraft runtime config.
// Flip `useMock` to false once the Growth Engine backend is bootable —
// everything else in the app talks to the real /api/growth-engine/v1 contract.
window.SCALECRAFT_CONFIG = {
  useMock: true,
  apiBase: '/api/growth-engine/v1',
  // Convergence-style auth endpoint; expected to return { token } (or { access_token }).
  authLoginPath: '/api/auth/login',
  pollIntervalMs: 2000,
  // Mock-only knobs
  mock: {
    queuedMs: 3000,        // time spent "queued" before running
    stageMs: 2200,         // per-dimension stage duration
    failIfHandleIncludes: 'private' // e.g. @sunrise_private → simulates a private profile
  }
};
