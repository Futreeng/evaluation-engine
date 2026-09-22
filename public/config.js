// Scalecraft runtime config.
//
// Mock mode (sample data, no backend) is OFF by default. Turn it on with
// `?mock=1` on the URL (sticks for the tab; `?mock=0` turns it off), or list a
// hostname in `mockHosts` for a permanently-mock demo deploy. The query switch
// is only honoured on localhost and *.vercel.app so a customer on the real
// product can't wander into sample data. Everything is under one base path,
// including auth (/auth/login, /auth/signup).
(function () {
  var host = location.hostname;
  var mockHosts = ['scalecraft-demo.vercel.app'];
  var devHost = host === 'localhost' || host === '127.0.0.1' || /\.vercel\.app$/.test(host);
  var useMock = mockHosts.indexOf(host) !== -1;
  if (devHost) {
    var q = new URLSearchParams(location.search).get('mock');
    try {
      if (q === '1') sessionStorage.setItem('sc_mock', '1');
      else if (q === '0') sessionStorage.removeItem('sc_mock');
      if (sessionStorage.getItem('sc_mock') === '1') useMock = true;
    } catch (e) { if (q === '1') useMock = true; }
  }

  window.SCALECRAFT_CONFIG = {
    useMock: useMock,
    // Real customer quotes only. Empty → the pricing page shows no quote card.
    // Each: { quote, name, meta } e.g. { quote: '…', name: 'Ava', meta: '@ava · Fitness · 41 → 58' }
    testimonials: [],
    // Same origin when Express serves this folder (local dev, Render). A
    // Vercel-hosted copy has no backend of its own, so it talks to Render.
    apiBase: /\.vercel\.app$/.test(host)
      ? 'https://scalecraft.onrender.com/api/growth-engine/v1'
      : '/api/growth-engine/v1',
    pollIntervalMs: 2000,
    // Platforms the backend's validateEvaluationRequest accepts today.
    // Others still render in the form but are marked "soon" and can't be submitted.
    supportedPlatforms: ['instagram', 'tiktok'],
    // Roast mode (spec 2.1) — the button on every report. Server has its own ROAST_ENABLED.
    roast: true,
    // Mock-only knobs
    mock: {
      queuedMs: 3000,        // time spent "queued" before running
      stageMs: 2200,         // per-dimension stage duration
      failIfHandleIncludes: 'private' // e.g. @sunrise_private → simulates a private profile
    }
  };

  // The mock API only ships when it's on: app.js reads window.scalecraftMockFetch
  // at call time, so it has to be parsed before app.js — hence document.write.
  if (useMock) document.write('<script src="mock-api.js?v=8"><\/script>');
})();
