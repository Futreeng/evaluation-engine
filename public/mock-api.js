// Scalecraft mock API — serves the @sunrisefitnessbk sample from the design
// through the same routes as the real Growth Engine backend, so app.js needs
// no branches. Installed as window.scalecraftMockFetch(path, init) → Response-like.
(function () {
  const cfg = window.SCALECRAFT_CONFIG || {};
  const M = cfg.mock || {};
  const QUEUED_MS = M.queuedMs ?? 3000;
  const STAGE_MS = M.stageMs ?? 2200;
  const FAIL_KEY = (M.failIfHandleIncludes || 'private').toLowerCase();

  const STAGES = ['finding', 'reading', 'scoring', 'writing'];

  const CATEGORY_NAMES = { fitness_creator: 'Fitness', food_cooking: 'Food & Cooking', lifestyle_vlog: 'Lifestyle & Vlog', other: 'Other', boutique_fitness: 'Boutique Fitness', retail: 'Retail' };

  const cal = slots => Array.from({ length: 28 }, (_, i) => slots.includes(i % 7));

  function sampleReport(handle, platform, category) {
    const catName = CATEGORY_NAMES[category] || 'Boutique Fitness';
    return {
      report_id: 'rpt_' + Math.random().toString(36).slice(2, 10),
      tier: 'social_snapshot',
      generated_at: Date.now(), refresh_due_at: Date.now() + 7 * 86400000,
      narrative: null, raw_personas: { gap_auditor: '' }, data_confidence: 'high',
      data_window: "Based on your last 12 posts. We can't see saves, reach or story views.", tz: 'America/New_York', email: 'maya@sunrisefitness.co',
      competitor_handles: [], competitors: null,
      scores: {
        overall: 47,
        category_avg: 61,
        category_top_quartile: 78,
        category_sample_size: 1284,
        summary: "Posting Consistency and Engagement Quality are driving most of the gap.",
        method: 'deterministic-v1', niche_known: true, creator: true,
        dimensions: [
          {
            label: 'Posting Consistency', score: 35, category_avg: 58, evidence_posts: [{ post_id: 'm1', thumbnail_url: null, permalink: 'https://www.instagram.com/', type: 'image', posted_at: '2026-08-02T14:00:00Z', caption: 'Class schedule for August', metric: '19-day gap after this' }, { post_id: 'm2', thumbnail_url: null, permalink: 'https://www.instagram.com/', type: 'reel', posted_at: '2026-09-15T12:00:00Z', caption: 'Coach on camera', metric: 'last post, 6 days ago' }],
            explanation: "You posted 14 times in the last 90 days with a 19-day silence through August. Studios that hold three posts a week stay in the feed of people who already follow them; gaps reset that and the algorithm treats you like a new account. This isn't about posting more — it's about posting on the same days."
          },
          {
            label: 'Content Mix', score: 52, category_avg: 63, evidence_posts: [{ post_id: 'm3', thumbnail_url: null, permalink: 'https://www.instagram.com/', type: 'image', posted_at: '2026-09-01T12:00:00Z', caption: 'Week 36 timetable', metric: '9 of 14 are images · 41 likes · 2 comments' }, { post_id: 'm4', thumbnail_url: null, permalink: 'https://www.instagram.com/', type: 'reel', posted_at: '2026-09-10T12:00:00Z', caption: 'Deadlift cue that fixes your back', metric: 'only 2 reels · 2.1k views' }],
            explanation: "Nine of your 14 posts are class schedules. Members already know the schedule. There's almost no coach point-of-view, no member results, and nothing from behind the front desk — the three things that make a stranger trust a studio before they ever walk in."
          },
          {
            label: 'Engagement Quality', score: 58, category_avg: 60, evidence_posts: [{ post_id: 'm4', thumbnail_url: null, permalink: 'https://www.instagram.com/', type: 'reel', posted_at: '2026-09-10T12:00:00Z', caption: 'Deadlift cue that fixes your back', metric: '2.1k views · 3.4× your median' }, { post_id: 'm5', thumbnail_url: null, permalink: 'https://www.instagram.com/', type: 'carousel', posted_at: '2026-08-21T12:00:00Z', caption: 'Member results, 12 weeks', metric: '96 likes · 11 comments · 2.0× your median' }],
            explanation: "Comments average 2.1 per post and roughly 70% come from the same six accounts — loyal, but not new. Saves and shares, the two signals that put you in front of people within a few miles of the studio, are low for your follower count.",
            evidence: "1.9% engagement rate vs 2.4% target; comments are 3.1% of interactions; video views per post ≈ 11% of followers"
          },
          {
            label: 'Profile Clarity', score: 44, category_avg: 64, evidence_posts: [],
            explanation: "Your bio reads “Move well. Live well.” It doesn't say the neighborhood, what a first class costs, or how to book one. The link goes to your homepage instead of a trial offer. A visitor decides in about four seconds whether you're near them and affordable."
          }
        ]
      },
      growth_path: {
        unlocked_steps: 3,
        total_steps: 15,
        phases: [
          {
            range: '1-30', label: 'Show up on a schedule',
            visible_action: 'Pick three fixed posting days — Mon, Wed, Sat — and publish at 7:15am.',
            detail: 'Your engagement peaks between 6:30 and 8am on weekdays; class-goers check their phones before the commute. Hold the same three days for four weeks even when the post is one photo and a caption.',
            locked: {
              count: 4, teaser: '4 specific moves + your weeks 1–4 calendar',
              items: [
                { meta: 'MOVE 02 · BIO REWRITE · 12 WORDS · NEIGHBORHOOD + PRICE', w1: '94%', w2: '61%' },
                { meta: 'MOVE 03 · STORY CADENCE · MON + THU · 2 FRAMES EACH', w1: '88%', w2: '44%' },
                { meta: 'MOVE 04 · HIGHLIGHT COVERS · 3 · FIRST CLASS / COACHES / SCHEDULE', w1: '97%', w2: '72%' }
              ],
              calendar_label: 'WEEKS 1–4 · 12 POST SLOTS', calendar: cal([0, 2, 5])
            }
          },
          {
            range: '31-60', label: 'Give people a reason to trust you',
            visible_action: 'Replace two schedule posts a week with a 20-second coach explainer.',
            detail: 'One coach, one movement cue, filmed on a phone, no editing. Your two most-saved posts of the last year are both coach-on-camera — that format already works for you; you just stopped using it.',
            locked: {
              count: 4, teaser: '4 specific moves + your weeks 5–8 calendar',
              items: [
                { meta: 'MOVE 05 · REELS SCRIPT · 20 SEC · 3 BEATS', w1: '91%', w2: '57%' },
                { meta: 'MOVE 06 · MEMBER STORY · 1 ASK · 4-LINE DM TEMPLATE', w1: '84%', w2: '68%' },
                { meta: 'MOVE 07 · COMMENT WINDOW · 20 MIN/DAY · 8:30PM', w1: '96%', w2: '39%' }
              ],
              calendar_label: 'WEEKS 5–8 · 12 POST SLOTS', calendar: cal([1, 3, 5])
            }
          },
          {
            range: '61-90', label: 'Turn attention into first classes',
            visible_action: 'Point your link at a $15 first-class page with the address above the fold.',
            detail: 'Right now the link goes to your homepage and the address sits in the footer. Anyone who found you through a reel has to work to learn whether you are a reasonable walk from their apartment.',
            locked: {
              count: 4, teaser: '4 specific moves + your weeks 9–12 calendar',
              items: [
                { meta: 'MOVE 08 · OFFER PAGE · 4 BLOCKS · HEADLINE COPY INCLUDED', w1: '89%', w2: '64%' },
                { meta: 'MOVE 09 · LOCAL TAGS · 6 ACCOUNTS WITHIN 1.2 MI', w1: '93%', w2: '48%' },
                { meta: 'MOVE 10 · RETENTION DM · 2 TEMPLATES · DAY 7 + DAY 21', w1: '86%', w2: '70%' }
              ],
              calendar_label: 'WEEKS 9–12 · 12 POST SLOTS', calendar: cal([0, 3, 6])
            }
          }
        ]
      },
      business: { handle, platform, category, business_name: '', followers: 12640167 },
      best_times: { tz: 'America/New_York', confident: true, sample: 27, metric: 'likes and comments', windows: [{ day: 'Thu', start_hour: 18, end_hour: 21, label: 'Thu 6pm–9pm', n: 3, vs_avg: 2.22, explanation: 'Your Thu 6pm–9pm posts average 2.22× your usual likes and comments (3 posts).' }, { day: 'Fri', start_hour: 18, end_hour: 21, label: 'Fri 6pm–9pm', n: 4, vs_avg: 1.78, explanation: 'Your Fri 6pm–9pm posts average 1.78× your usual likes and comments (4 posts).' }], best_days: [{ day: 'Fri', n: 5, vs_avg: 2.04 }, { day: 'Thu', n: 5, vs_avg: 1.99 }], note: 'From your last 27 posts, in America/New York. Windows need at least 2 posts and 1.15× your median to count.' },
      post_insights: {
        sample: 12, avg_engagement: 96,
        note: 'Your top three are all coach-on-camera reels posted before 8am on weekdays. The bottom three are class-schedule graphics posted on Fridays with no caption beyond the times.',
        patterns: { best_format: { format: 'reel', posts: 4, avg_engagement: 168, vs_avg: 1.75 }, best_day: { day: 'Wed', avg_engagement: 151 } },
        top: [
          { date: '2026-09-03T11:40:00Z', format: 'reel', weekday: 'Wed', likes: 214, comments: 19, views: 3980, engagement: 233, url: 'https://www.instagram.com/', pinned: false, vs_avg: 2.43, caption: 'Coach Dana on the one hip-hinge cue that fixes most deadlifts. 20 seconds, no music.' },
          { date: '2026-08-13T11:15:00Z', format: 'reel', weekday: 'Wed', likes: 171, comments: 12, views: 2860, engagement: 183, url: 'https://www.instagram.com/', pinned: false, vs_avg: 1.91, caption: 'What 6:15am looks like from the front desk. Same eight faces, every week.' },
          { date: '2026-07-29T12:02:00Z', format: 'carousel', weekday: 'Tue', likes: 122, comments: 9, views: 0, engagement: 131, url: 'https://www.instagram.com/', pinned: false, vs_avg: 1.36, caption: 'Maya’s first pull-up, six months in. Swipe for the week-one video.' }
        ],
        bottom: [
          { date: '2026-08-29T20:10:00Z', format: 'static', weekday: 'Fri', likes: 31, comments: 0, views: 0, engagement: 31, url: 'https://www.instagram.com/', pinned: false, vs_avg: 0.32, caption: 'This week’s schedule ⬇️ Mon 6:15 / 7:30 / 12:00 / 6:00 · Tue 6:15 / 7:30…' },
          { date: '2026-08-08T19:45:00Z', format: 'static', weekday: 'Fri', likes: 36, comments: 1, views: 0, engagement: 37, url: 'https://www.instagram.com/', pinned: false, vs_avg: 0.39, caption: 'Schedule for the week of Aug 11. Book via the link in bio.' },
          { date: '2026-07-18T21:00:00Z', format: 'static', weekday: 'Fri', likes: 44, comments: 2, views: 0, engagement: 46, url: 'https://www.instagram.com/', pinned: false, vs_avg: 0.48, caption: 'Labor Day hours: closed Monday. Regular schedule resumes Tuesday.' }
        ]
      },
      upsell: {
        cta_label: 'Unlock your full Growth Plan',
        target_tier: 'growth_plan',
        unlock_count: 12,
        monthly_price: 12,
        one_time_price: 15
      }
    };
  }

  const LIM = { social_snapshot: { post_regens_per_week: null, post_reviews_per_week: null, written_posts_per_week: null, competitor_handles: null, rescore_days: null, platforms: 1 }, growth_plan: { post_regens_per_week: 10, post_reviews_per_week: 7, written_posts_per_week: 6, competitor_handles: 5, rescore_days: 7, platforms: 1 }, growth_plan_pro: { post_regens_per_week: 25, post_reviews_per_week: 20, written_posts_per_week: 12, competitor_handles: 10, rescore_days: 3, platforms: 99 }, maintenance: { post_regens_per_week: null, post_reviews_per_week: null, written_posts_per_week: null, competitor_handles: null, rescore_days: 7, platforms: 1 } };
  let foundersTaken = 212;
  const PRICING = {
    audience: 'creators',
    support_email: 'hello@futreeng.com',
    discount: { annual: '2 months free', note: "Annual is 10 months' price for 12" },
    refund: 'Not useful in the first 7 days? Reply to any email and we refund it.',
    business_checkout_enabled: false,
    variant: 'control',
    pause: { months: [1, 2, 3] },
    maintenance: { tier: 'maintenance', name: 'Maintenance', description: 'Keep the weekly rescore and your score history. No plan, no written posts, no reviews, no Monday move.', monthlyPrice: 5, annualPrice: null, features: ['Re-scored every week', 'Score history and trend', 'Levels and milestones kept', 'No moves, calendar, posts or reviews'], cta: 'Switch to Maintenance', hidden: true, limits: LIM.maintenance },
    get founders() { return { cap: 400, taken: foundersTaken, left: Math.max(0, 400 - foundersTaken), monthlyPrice: 12, annualPrice: 108, tier: 'growth_plan' }; },
    limits: LIM,
    one_time: [],
    tiers: [
      { tier: 'social_snapshot', name: 'Snapshot', description: 'See where your account stands and why.', monthlyPrice: 0, annualPrice: 0, note: 'No card, ever', features: ['One free Snapshot per handle', 'Your score, the four dimensions, and the posts behind each one', 'Best time to post', 'The first move of each phase', 'Roast mode, all heat levels, with the roast card', 'The score card and share page'], cta: 'Score my account', limits: LIM.social_snapshot },
      { tier: 'growth_plan', name: 'Growth Plan', description: 'Your full plan, posts written for you every week, and a score that moves.', monthlyPrice: 19, annualPrice: 190, popular: true, features: ['Your full plan: every move, plus the 12-week posting calendar', 'Posts written for you every week — 6, with hooks, captions and scripts', 'See your score move every week — history and change emails', '48-hour reviews of every new post', 'The Monday move', 'Levels, streaks with freezes, personal records and milestone cards', "What's working in your niche, weekly", 'Competitor comparison, up to 5 handles', 'One platform'], cta: 'Start Growth Plan', limits: LIM.growth_plan },
      { tier: 'growth_plan_pro', name: 'Pro', description: 'Every platform you’re on, rescored every 3 days, with double the writing.', monthlyPrice: 39, annualPrice: 390, features: ['Everything in Growth Plan', 'All supported platforms scored under one plan', 'Rescores every 3 days instead of weekly', '12 written posts per week', 'Competitor comparison, up to 10 handles', 'Higher fair-use limits'], cta: 'Start Pro', limits: LIM.growth_plan_pro }
    ],
    business: [
      { tier: 'business_growth', name: 'Business Growth Plan', description: 'Scored against your category; the plan is written for bookings.', monthlyPrice: 39, annualPrice: 390, features: ['Everything in Growth Plan', 'Category benchmarks for businesses', 'Moves written for bookings, not followers'], cta: 'Start Business Growth Plan' },
      { tier: 'business_evaluator', name: 'Business Evaluator', description: 'The plan answers to the P&L, not just the feed.', monthlyPrice: 99, annualPrice: 990, features: ['Everything in Business Growth Plan', 'Margin-aware recommendations', 'Action plan checklist with owners and dates', 'Rescores every 3 days'], cta: 'Start Business Evaluator' }
    ]
  };

  // Score bands + milestone thresholds, same shape as GET /levels.
  const LEVELS = { levels: [['Rookie', 0, 39], ['Rising', 40, 54], ['Consistent', 55, 69], ['Established', 70, 84], ['Elite', 85, 100]].map(([name, min, max], i) => ({ name, min, max, rank: i + 1 })), milestones: { followers: 1000, score: 70, streak_weeks: 4 }, min_n: 10 };
  const levelFor = sc => { const l = LEVELS.levels.filter(x => sc >= x.min).pop() || LEVELS.levels[0]; const n = LEVELS.levels.find(x => x.min > l.min) || null; return { name: l.name, rank: l.rank, of: LEVELS.levels.length, min: l.min, max: l.max, next: n ? { name: n.name, min: n.min, points_away: n.min - sc } : null }; };

  // ---- in-memory state ----
  const jobs = new Map();
  const reports = new Map();
  let savedContext = null;
  let mockGoal = { goal: null, goal_target: null };
  const mockPrefs = { weekly_score: true, monday_move: true, milestones: true, post_reviews: true, product_news: false, paused: false };
  let entitlement = { account_id: 'acct_mock', current_tier: 'social_snapshot' };
  let queueDepth = 2;

  function jobView(job) {
    const t = Date.now() - job.started;
    if (job.fail) {
      if (t < QUEUED_MS + STAGE_MS) return running(job, t);
      return { status: 'failed', stage: 'failed', error: `${cap(job.platform)} returned the profile as private, so there are no public posts for us to score. Nothing was charged and nothing was saved.`, error_code: 'PROFILE_PRIVATE', ref: job.ref };
    }
    if (t < QUEUED_MS) {
      const ahead = Math.max(0, Math.ceil((QUEUED_MS - t) / (QUEUED_MS / queueDepth)));
      return { status: 'queued', stage: 'queued', queue_position: ahead, eta_seconds: Math.ceil((QUEUED_MS - t) / 1000) + 15 };
    }
    if (t < QUEUED_MS + STAGE_MS * STAGES.length) return running(job, t);
    if (!job.report) {
      job.report = sampleReport(job.handle, job.platform, job.category);
      job.report.plan_context = job.plan_context || null;
      job.report.scores.level = levelFor(job.report.scores.overall);
      if (job.paid || entitlement.current_tier !== 'social_snapshot') { job.report.tier = 'growth_plan'; job.report.growth_path.phases.forEach((p, i) => { p.moves = (p.locked.items || []).map((it, k) => ({ n: i * 5 + k + 2, title: it.meta.replace(/^MOVE \d+ · /, '').split(' · ')[0], action: it.meta.split(' · ').slice(1).join(' · '), why: '', how: ['Open Instagram → your profile → Edit profile.', 'Make the change described above; keep the wording in your own voice.', 'Post or save, then check it from a logged-out browser.'], example: k === 0 ? 'Coach on camera, one cue per reel.\nNew class times every Monday → link below.' : null, done_when: 'You can see the change on your public profile.', time: k === 0 ? '20 min, once' : '10 min per post, ongoing' })); p.opener = { how: ['Pick the two days you already post most.', 'Put them in your calendar as recurring reminders.', 'Film both reels in one session on Sunday.'], example: null, done_when: 'Two reels published on the fixed days this week.', time: '1 hour this week' }; p.locked = { count: 0, teaser: '' }; p.calendar_weeks = Array.from({ length: 4 }, (_, w) => ({ week: i * 4 + w + 1, phase: i + 1, slots: ['Mon', 'Wed', 'Sat'].map((d, k) => ({ day: d, format: k === 1 ? 'carousel' : 'reel', source: ['new', 'archive', 'no_camera'][(w + k) % 3], angle: ['Coach on camera, one cue', 'Member result, before/after', 'Front desk at 6:15am'][k], prompt: k === 0 ? 'One cue per reel; end on the class time.' : null })) })); if (job.oneTime && i === 2) { p.moves = []; p.opener = null; p.locked = { count: 4, teaser: 'Days 61–90 unlock with the Growth Plan' }; p.not_included = true; } }); const nWeeks = job.oneTime ? 8 : 12; job.report.calendar = { posting_days: ['Mon', 'Wed', 'Sat'], posting_time: '7:15am', weeks: Array.from({ length: nWeeks }, (_, w) => ({ week: w + 1, phase: Math.floor(w / 4) + 1, slots: ['Mon', 'Wed', 'Sat'].map((d, k) => ({ day: d, format: k === 1 ? 'carousel' : 'reel', source: ['new', 'archive', 'no_camera'][(w + k) % 3], angle: 'Coach on camera, one cue', prompt: 'Film in one take; open with the cue in the first two seconds.' })) })) }; job.report.plan_days = job.oneTime ? 60 : 90; job.report.scores.category_percentile = { n: 1284, beats_pct: 31 }; job.report.moments = [{ kind: 'rank_up', key: 'rank_rising', title: "You're Rising now", line: 'Rookie → Rising · 39 → 47', from: 'Rookie', to: 'Rising', score: 47, at: Date.now() }, { kind: 'record', key: 'record_m4', title: 'New personal record', line: '233 likes + comments · beat your previous best of 183', score: 47, at: Date.now(), post: { id: 'm4', permalink: 'https://www.instagram.com/', caption: 'Deadlift cue that fixes your back', posted_at: '2026-09-10T12:00:00Z', type: 'reel' } }]; job.report.moments_seen = [{ key: 'rank_rising', at: Date.now() }, { key: 'record_m4', at: Date.now() }]; job.report.streak = { weeks: 3, best: 3, freezes: 1, planned_days: 3, posted_days: 3, visible: true, evaluated_at: Date.now(), last: 'on_plan', history: [] }; job.report.offers = { annual: { tier: 'growth_plan', monthly: 12, annual: 108, saves: 36, at: Date.now() } }; job.report.badges = [{ key: 'first_1k', title: 'First 1k followers', earned_at: Date.now() - 20 * 86400000 }, { key: 'first_3x', title: 'A post at 3× your average', earned_at: Date.now() - 6 * 86400000 }]; job.report.quest = { key: 'q_reel_2', title: 'Post 2 reels this week', target: { kind: 'posts_of_type', type: 'reel', n: 2 }, started_at: Date.now() - 2 * 86400000, ends_at: Date.now() + 5 * 86400000, progress: 1, done: false, week: 1 }; job.report.quest_history = [{ key: 'q0', title: 'Post on 3 different days this week', progress: 3, n: 3, done: true, ended_at: Date.now() - 2 * 86400000 }]; job.report.post_reviews = [{ post_id: 'n1', posted_at: new Date(Date.now() - 3 * 86400000).toISOString(), type: 'reel', caption: 'Coach Dana: the one cue that fixes most deadlifts. 20 seconds, no music.', permalink: 'https://www.instagram.com/', metrics: { likes: 214, comments: 19, views: 3980, vs_avg: 2.4, vs_same_format: 1.4 }, review: { performance: 'Strong: 2.4× your average engagement, and 1.4× your reel average.', likely_reason: 'Coach on camera with a one-line cue as the opener, posted Wednesday 7am — your best window.', next: 'Repeat the format next Wednesday: one cue, one coach, under 20 seconds, question in the first line.', source: 'model' }, reviewed_at: Date.now() - 86400000 }, { post_id: 'n2', posted_at: new Date(Date.now() - 6 * 86400000).toISOString(), type: 'image', caption: 'This week’s schedule ⬇️ Mon 6:15 / 7:30 / 12:00 / 6:00', permalink: 'https://www.instagram.com/', metrics: { likes: 28, comments: 0, views: null, vs_avg: 0.3, vs_same_format: 0.9 }, review: { performance: 'Below your average (0.3×).', likely_reason: 'Schedule graphics run cold for you (0.9× your image average) and it went up Friday 8pm, outside your best window.', next: 'Put the schedule in a story highlight; use the feed slot for a coach reel in your Wednesday window.', source: 'rules' }, reviewed_at: Date.now() - 4 * 86400000 }]; job.report.history = { runs: 4, previous: { report_id: 'rpt_prev', overall: 44, followers: 12598000, generated_at: Date.now() - 7 * 86400000 }, delta_overall: 3, delta_followers: 42167, delta_dimensions: [{ label: 'Posting Consistency', delta: 4 }, { label: 'Content Mix', delta: 2 }, { label: 'Engagement Quality', delta: 1 }, { label: 'Profile Clarity', delta: 0 }], moves_done_since: ['p1m2', 'p1m3'], series: [[28, 39, 12401000], [21, 41, 12455000], [14, 41, 12510000], [7, 44, 12598000], [0, 47, 12640167]].map(([d, overall, followers]) => ({ generated_at: Date.now() - d * 86400000, overall, followers })) }; job.report.next_posts = [{ n: 1, written_at: Date.now(), day: 'Thu', time: '7pm', format: 'reel', hook: 'One cue that fixes 90% of deadlifts', caption: 'Hips back, not down.\nSlow on the way down, fast on the way up.\nSave this for your next session.', script: 'Open on the bar, no talking, 2 seconds.\nCoach: "Most people bend their knees first. Don\'t."\nShow the hip hinge from the side, twice.\nCoach: "Hips back. Shins stay still."\nOne clean rep at speed.\nEnd card: Thursdays 6:30am — first class free.', why: 'Your Sept 10 deadlift reel did 3.4× your usual; this is the same format on your strongest window.', source: 'new' }, { n: 2, written_at: Date.now(), day: 'Fri', time: '7pm', format: 'carousel', hook: '12 weeks, one member, no filter', caption: 'Week 1 → week 12.\nNo diet plan. Three classes a week.\nAsk her how it felt: link in bio.', script: 'Slide 1: week-1 photo, date in the corner.\nSlide 2: week-12 photo, same spot, same light.\nSlide 3: her words, one sentence.\nSlide 4: what she did each week, three lines.\nSlide 5: first class free, Thursday.', why: 'Member-result carousels average 2.0× your median and you have none this month.', source: 'archive' }, { n: 3, written_at: Date.now(), day: 'Thu', time: '7pm', format: 'reel', hook: 'What the front desk hears every Monday', caption: 'You don\'t need to be fit to start.\nYou need a Tuesday.', script: 'Talk to camera at the desk, one take.\nSay the three things people ask before their first class.\nAnswer each in one sentence.\nEnd: "Tuesday 6:30. Come early, we\'ll show you around."', why: 'Talk-to-camera is your best-performing format and nothing in the last 14 posts shows a face.', source: 'no_camera' }]; job.report.plan_started_at = Date.now() - (job.rerun ? 27 * 86400000 : 0); job.report.plan_context = job.plan_context || null; if (job.oneTime) job.report.one_time_unlock = { of: null, payment_id: 'pay_mock', days: 60 }; }
      reports.set(job.report.report_id, job.report);
    }
    return { status: 'complete', stage: 'complete', resultPayload: job.report };
  }
  function running(job, t) {
    const idx = Math.min(STAGES.length - 1, Math.floor((t - QUEUED_MS) / STAGE_MS));
    const within = ((t - QUEUED_MS) % STAGE_MS) / STAGE_MS;
    const pct = Math.round(((idx + within) / STAGES.length) * 100);
    return {
      status: 'running', stage: STAGES[idx], step: idx + 1, total_steps: STAGES.length, percent: pct,
      elapsed_seconds: Math.floor((t - QUEUED_MS) / 1000),
      stats: idx >= 1 ? { posts_found: 47, window_days: 90, longest_gap_days: 19 } : null,
      note: idx >= 1 ? 'Bio and link checked: no city, no price, no booking path.' : null
    };
  }
  const cap = s => s ? s[0].toUpperCase() + s.slice(1) : s;

  function json(status, body) {
    return {
      ok: status >= 200 && status < 300, status,
      json: async () => body, text: async () => JSON.stringify(body)
    };
  }
  const delay = ms => new Promise(r => setTimeout(r, ms));

  window.scalecraftMockFetch = async function (url, init = {}) {
    await delay(180 + Math.random() * 220);
    const base = cfg.apiBase || '/api/growth-engine/v1';
    const path = url.startsWith(base) ? url.slice(base.length) : url;
    const method = (init.method || 'GET').toUpperCase();
    const body = init.body ? JSON.parse(init.body) : {};
    let m;

    if (method === 'POST' && path === '/evaluate/social-snapshot') {
      const handle = String(body.handle || '').replace(/^@/, '').trim();
      if (!handle || !body.platform || !body.category || !body.email) return json(400, { error: 'handle, platform, category and email are required', code: 'INVALID_HANDLE' });
      const paid = entitlement.current_tier !== 'social_snapshot' && (init.headers || {}).Authorization;
      const prior = [...jobs.values()].find(j => !j.paid && !j.fail && j.report && j.handle === handle.toLowerCase() && j.platform === body.platform);
      const priorEmail = !paid && [...jobs.values()].find(j => !j.paid && !j.fail && j.report && j.email === body.email);
      if (!paid && !prior && priorEmail) return json(402, { error: 'That email has already had its free Snapshot. Open your report, or start a Growth Plan to score more accounts.', code: 'FREE_LIMIT_REACHED', report_id: priorEmail.report.report_id, generated_at: priorEmail.report.generated_at, upgrade_tier: 'growth_plan' });
      if (!paid && prior) return json(402, { error: `@${handle} has already been scored for free. Open that report, or start a Growth Plan to score it again and watch it change.`, code: 'FREE_LIMIT_REACHED', report_id: prior.report.report_id, generated_at: prior.report.generated_at, upgrade_tier: 'growth_plan' });
      const id = 'job_' + Math.random().toString(36).slice(2, 10);
      jobs.set(id, { paid: !!paid,
        id, handle, platform: body.platform, category: body.category, email: body.email, plan_context: body.plan_context || (paid ? savedContext : null),
        started: Date.now(), fail: handle.toLowerCase().includes(FAIL_KEY),
        ref: (Math.random().toString(16).slice(2, 4) + '-' + Math.floor(1000 + Math.random() * 9000)).toUpperCase()
      });
      return json(202, { job_id: id, status: 'queued' });
    }
    if (method === 'GET' && (m = path.match(/^\/job\/([^/?]+)/))) {
      const job = jobs.get(m[1]);
      return job ? json(200, jobView(job)) : json(404, { error: 'Job not found' });
    }
    if (method === 'GET' && (m = path.match(/^\/reports\/([^/?]+)/))) {
      const r = reports.get(m[1]);
      return r ? json(200, { reportId: r.report_id, accountId: 'usr_mock', tier: r.tier, business: { handle: r.business.handle, platform: r.business.platform, category: r.business.category }, generatedAt: r.generated_at, refreshDueAt: r.refresh_due_at || null, reportBody: r, createdAt: r.generated_at, updatedAt: r.generated_at }) : json(404, { error: 'Report not found' });
    }
    if (method === 'GET' && (path === '/account/reports' || path === '/reports')) return json(200, { reports: [...reports.values()].map(r => ({ reportId: r.report_id, accountId: 'usr_mock', tier: r.tier, business: { handle: r.business.handle, platform: r.business.platform, category: r.business.category }, generatedAt: r.generated_at, refreshDueAt: r.refresh_due_at || null, reportBody: r, createdAt: r.generated_at, updatedAt: r.generated_at })) });
    if (method === 'GET' && path === '/entitlements') return json(200, entitlement);
    if (method === 'GET' && path === '/health') return json(200, { status: 'ok', timestamp: new Date().toISOString(), apis: {}, db: 'ok', mock: true });
    if (method === 'POST' && path === '/waitlist') return json(200, { ok: true, platform: body.platform, promo: null }); // was: { code: 'FOUNDER50', description: 'First month free, then $12/mo' } : null });
    if (method === 'DELETE' && path === '/account') { entitlement = { account_id: 'acct_mock', current_tier: 'social_snapshot' }; return json(200, { deleted: true, reports: reports.size }); }
    if (method === 'POST' && (m = path.match(/^\/reports\/([^/]+)\/unlock$/))) { const r = reports.get(m[1]); if (!r) return json(404, { error: 'Report not found' }); const id = 'job_' + Math.random().toString(36).slice(2, 10); jobs.set(id, { id, handle: r.business.handle, platform: r.business.platform, category: r.business.category, email: 'x', started: Date.now() - QUEUED_MS, fail: false, paid: true, oneTime: true, ref: 'MOCK', plan_context: body.plan_context || savedContext }); return json(200, { job_id: id, status: 'queued', tier: 'growth_plan', one_time: true, payment: { id: 'pay_mock', amount: '$15.00' } }); }
    if (method === 'PUT' && path === '/account/plan-context') { savedContext = body.plan_context || null; return json(200, { plan_context: savedContext }); }
    if (method === 'GET' && path.startsWith('/account/plan-context')) return json(200, { plan_context: savedContext });
    if (method === 'POST' && (m = path.match(/^\/reports\/([^/]+)\/competitors$/))) {
      const r = reports.get(m[1]); if (!r) return json(404, { error: 'Report not found' });
      if (entitlement.current_tier === 'social_snapshot') return json(402, { error: 'Competitor comparison is part of the Growth Plan.', code: 'UPGRADE_REQUIRED', required_tier: 'growth_plan', status: 402 });
      const handles = (body.handles || []).map(x => String(x).replace(/^@/, '').trim()).filter(Boolean).slice(0, 5);
      if (!handles.length) return json(400, { error: 'Provide 1–5 competitor handles', code: 'INVALID_HANDLES' });
      const metrics = (f, e) => ({ posts_per_week: 3.2, longest_gap_days: 6, video_share: 0.6, engagement_rate: e, comments_per_post: 9, followers: f, bio_location: true, bio_price: false, bio_cta: true, booking_link: true, highlights: 4 });
      const comps = handles.map((hn, i) => ({ handle: hn, followers: 8000 + i * 3100, ok: true, overall: 58 + i * 7, dimensions: r.scores.dimensions.map(d => ({ label: d.label, score: Math.min(95, d.score + 10 + i * 5) })), metrics: metrics(8000 + i * 3100, 0.031 + i * 0.004), does_differently: ['Posts a reel every Tuesday and Thursday', 'Bio names the neighbourhood and a price'] }));
      const you = { handle: r.business.handle, overall: r.scores.overall, dimensions: r.scores.dimensions.map(d => ({ label: d.label, score: d.score })), metrics: metrics(r.business.followers, 0.0189) };
      const rank = { position: [you.overall, ...comps.map(c => c.overall)].sort((a, b) => b - a).indexOf(you.overall) + 1, of: comps.length + 1 };
      r.competitor_handles = handles; r.competitors = { generated_at: Date.now(), you, competitors: comps, rank };
      return json(200, r.competitors);
    }
    if (method === 'POST' && (m = path.match(/^\/reports\/([^/]+)\/goal$/))) { const r = reports.get(m[1]); if (!r) return json(404, { error: 'Report not found' }); r.goal = body.goal; r.goal_target = body.goal === 'followers' ? Number(body.goal_target) || null : null; mockGoal = { goal: r.goal, goal_target: r.goal_target }; return json(200, mockGoal); }
    if (method === 'POST' && (m = path.match(/^\/reports\/([^/]+)\/roast$/))) {
      const r = reports.get(m[1]); if (!r) return json(404, { error: 'Report not found' });
      const heat = ['mild', 'medium', 'extra_crispy'].includes(body.heat) ? body.heat : 'medium';
      if (r.roast && body.reroast && Date.now() < r.roast.reroast_after) return json(429, { error: 'Roast me again opens 30 days after the last one.', code: 'REROAST_TOO_SOON', status: 429 });
      const L = { mild: ["Fourteen posts in 90 days — your feed has the posting rhythm of a sourdough starter someone forgot about.", "Nine of those fourteen are class schedules. Your followers know the timetable. They came for the humans.", "A 19-day silence through August. The algorithm filed you under 'seasonal business'.", "Your best post was a deadlift cue at 3.4× your average — the one time a coach spoke, people listened.", "The bio says 'Move well. Live well.' Nothing about where you are, what it costs, or how to book. Well.", "Two reels out of fourteen. You have a room full of coaches and you post like a print shop."],
        medium: ["Fourteen posts in ninety days. That's not a content strategy, that's a group chat that went quiet.", "Nine class-schedule graphics. Your grid is a bus timetable with better fonts.", "Nineteen days of silence in August. Instagram assumed you'd closed and started showing your members the gym across the street.", "The deadlift-cue reel did 3.4× your average. One coach, one sentence, 20 seconds. You've made it twice.", "'Move well. Live well.' is the bio. No neighbourhood, no price, no link. The most confident way to tell nobody anything.", "Friday-night schedule posts average 31 likes. Friday night. Schedules. Read that back."],
        extra_crispy: ["Fourteen posts in ninety days. Somewhere a corporate LinkedIn page is posting more often than your gym and it's embarrassed for you.", "Nine schedule graphics. Members already know the schedule. Strangers don't care. So who exactly was this for.", "A 19-day gap in August. Your account didn't go quiet, it was pronounced.", "Your top post — a 20-second deadlift cue — did 3.4× your average and you followed it with a timetable. That's a hostage refusing rescue.", "Bio: 'Move well. Live well.' No place, no price, no link. Six words, zero information, a personal best.", "Two reels. Two. There are fourteen coaches in that building and the camera is scared of all of them."] }[heat];
      r.roast = { heat, heat_label: { mild: 'Mild', medium: 'Medium', extra_crispy: 'Extra Crispy' }[heat], lines: L.map(t => ({ text: t, fact: '' })), closer: "Okay, here's how we fix it", first_move: { action: r.growth_path.phases[0].visible_action, why: r.growth_path.phases[0].detail }, overall: r.scores.overall, handle: r.business.handle, generated_at: Date.now(), previous: r.roast ? { generated_at: r.roast.generated_at, overall: r.roast.overall } : null, reroast_after: Date.now() + 30 * 86400000 };
      return json(200, { roast: r.roast });
    }
    if (method === 'POST' && (m = path.match(/^\/reports\/([^/]+)\/share$/))) { if (body.kind === 'moment') { const r = reports.get(m[1]); if (!r || !(r.moments || []).some(x => x.key === body.moment_key)) return json(404, { error: "That moment isn't on this report", code: 'NO_MOMENT' }); } return json(200, { share_id: 'mock1', url: location.origin + '/s/mock1', png: { story: '', square: '' } }); }
    if (method === 'POST' && (m = path.match(/^\/reports\/([^/]+)\/posts\/regenerate$/))) { const r = reports.get(m[1]); if (!r || !r.next_posts) return json(404, { error: 'Report not found' }); const lim = (LIM[entitlement.current_tier] || {}).post_regens_per_week; if (lim == null) return json(402, { error: 'Post writing is part of Growth.', code: 'UPGRADE_REQUIRED', required_tier: 'growth_plan', status: 402 }); entitlement.regens = (entitlement.regens || 0) + 1; if (entitlement.regens > lim) { const up = entitlement.current_tier === 'growth_plan' ? 'growth_plan_pro' : null; return json(429, { error: `That's ${lim} of ${lim} post rewrites this week. It resets Monday${up ? ', or Pro raises it to 25' : ''}.`, code: 'LIMIT_REACHED', used: lim, limit: lim, resets_at: Date.now() + 3 * 86400000, upgrade: up, status: 429 }); } const i = Number(body.index) || 0; const p = { ...r.next_posts[i], hook: r.next_posts[i].hook + ' (rewritten)', written_at: Date.now() }; r.next_posts[i] = p; return json(200, { post: p, index: i }); }
    if (method === 'POST' && (m = path.match(/^\/reports\/([^/]+)\/checkin$/))) { const r = reports.get(m[1]); if (!r) return json(404, { error: 'Report not found' }); if (r.one_time_unlock) return json(402, { error: 'Check-ins and plan updates are part of the Growth Plan subscription.', code: 'UPGRADE_REQUIRED', status: 402 }); r.checkins = { ...(r.checkins || {}), [body.nudge ? 'nudge_' + body.nudge : 'p' + body.phase]: { at: Date.now(), changed: !!body.changed } }; if (body.nudge) r.nudge = null; if (!body.changed) return json(200, { ok: true, checkins: r.checkins }); if (body.plan_context) savedContext = body.plan_context; const id = 'job_' + Math.random().toString(36).slice(2, 10); jobs.set(id, { id, handle: r.business.handle, platform: r.business.platform, category: r.business.category, email: 'x', started: Date.now() - QUEUED_MS, fail: false, paid: true, rerun: true, ref: 'MOCK', plan_context: savedContext }); return json(200, { ok: true, checkins: r.checkins, job_id: id, status: 'queued', tier: 'growth_plan' }); }
    if (method === 'GET' && (m = path.match(/^\/reports\/([^/]+)\/path$/))) { const r = reports.get(m[1]); if (!r) return json(404, { error: 'Report not found' }); return json(200, window.ScalecraftPath.build(r, {})); }
    if (method === 'POST' && (m = path.match(/^\/reports\/([^/]+)\/path\/([^/]+)$/))) { const r = reports.get(m[1]); if (!r) return json(404, { error: 'Report not found' }); Object.assign(r, window.ScalecraftPath.apply(r, m[2], body.status, { reason: body.reason || null })); return json(200, window.ScalecraftPath.build(r, {})); }
    if (method === 'POST' && (m = path.match(/^\/reports\/([^/]+)\/moves$/))) { const r = reports.get(m[1]); if (!r) return json(404, { error: 'Report not found' }); r.moves_done = r.moves_done || {}; if (body.done) r.moves_done[body.key] = Date.now(); else delete r.moves_done[body.key]; return json(200, { moves_done: r.moves_done }); }
    if (method === 'GET' && path === '/billing/pricing') return json(200, PRICING);
    if (method === 'GET' && path === '/levels') return json(200, LEVELS);
    if (method === 'GET' && (m = path.match(/^\/briefs\/([^/?]+)/))) return json(200, { ready: true, n: 1284, min_n: 10, category: decodeURIComponent(m[1]), platform: 'instagram', week: '2026-W39', window_days: 90, posts: 28410, top_posts: 6120, formats: [{ key: 'reel', share_top: 71, share_all: 48, lift: 1.48 }, { key: 'carousel', share_top: 22, share_all: 31, lift: 0.71 }, { key: 'image', share_top: 7, share_all: 21, lift: 0.33 }], hooks: [{ key: 'question', label: 'a question', share_top: 24, share_all: 12, lift: 2 }], days: [{ key: 'Wed', share_top: 21, share_all: 15, lift: 1.4 }], slots: [{ key: 'morning', share_top: 38, share_all: 27, lift: 1.41 }], cadence: { top_quartile_per_week: 4.2, all_per_week: 2.1 }, caption_words: { top_avg: 41, all_avg: 58 }, lines: ["Reels are 48% of what gets posted but 71% of the posts that beat their account's average (1.48× lift).", 'Openers with a question show up 2× more often among top posts (24% vs 12%).', 'Top posts land on Wed and Thu, mornings (6–11) more than the rest.', 'The top quarter of fitness creator accounts post 4.2× a week; the median is 2.1×.'], built_at: Date.now() });
    if (method === 'POST' && path === '/billing/subscribe') {
      const tier = [...PRICING.tiers, ...PRICING.business].find(t => t.tier === body.tier);
      if (!tier) return json(400, { error: 'Unknown tier' });
      const founder = tier.tier === 'growth_plan' && foundersTaken < 400 && !entitlement.founder; if (founder) foundersTaken++;
      const cycle = body.billingCycle === 'annual' ? 'annual' : 'monthly';
      entitlement = { ...entitlement, current_tier: tier.tier, billing_cycle: cycle, founder: founder || (entitlement.founder && tier.tier === 'growth_plan'), price_cents: (founder || (entitlement.founder && tier.tier === 'growth_plan')) ? (cycle === 'annual' ? 10800 : 1200) : (cycle === 'annual' ? tier.annualPrice : tier.monthlyPrice) * 100, regens: 0 };
      const promo = body.promo_code ? { code: String(body.promo_code).toUpperCase(), description: String(body.promo_code).toUpperCase() === 'FOUNDER50' ? 'First month free, then $12/mo' : '20% off your first month' } : null;
      return json(200, { ok: true, entitlement, tier: tier.tier, promo });
    }
    if (method === 'POST' && path === '/billing/check-access') {
      const order = ['social_snapshot', 'growth_plan', 'growth_plan_pro', 'business_growth', 'business_evaluator', 'agency'];
      const ok = order.indexOf(entitlement.current_tier) >= order.indexOf(body.requiredTier);
      return ok ? json(200, { access: true }) : json(402, { error: 'Upgrade required', required_tier: body.requiredTier });
    }
    // Auth — same shape as routes/growth-engine.js
    if (method === 'POST' && path === '/billing/promo/check') { const c = String(body.code || '').toUpperCase(); const product = body.product === 'plan_unlock' ? 'plan_unlock' : 'growth_plan'; const cycle = body.billingCycle === 'annual' ? 'annual' : 'monthly'; const base = product === 'growth_plan' ? (cycle === 'annual' ? 10800 : 1200) : 1500; if (c === 'FOUNDER50') { if (product !== 'growth_plan') return json(200, { valid: false, reason: 'That code is for the Growth Plan subscription.' }); if (cycle !== 'monthly') return json(200, { valid: false, reason: 'Free-month codes apply to monthly billing — switch to monthly to use it.' }); return json(200, { valid: true, code: c, product, description: 'First month free, then $12/mo', base_cents: base, amount_cents: 0, free_months: 1 }); } if (c === 'CREATOR20') return json(200, { valid: true, code: c, product, description: '20% off' + (product === 'growth_plan' ? ' your first month' : ''), base_cents: base, amount_cents: Math.round(base * 0.8), free_months: 0 }); if (c === 'PODCAST') { if (product !== 'plan_unlock') return json(200, { valid: false, reason: 'That code is for the 60-day plan.' }); return json(200, { valid: true, code: c, product, description: '60-day plan, free', base_cents: base, amount_cents: 0, free_months: 0 }); } return json(200, { valid: false, reason: "That code doesn't exist." }); }
    if (method === 'POST' && path === '/events') return json(200, { ok: true });
    if (method === 'GET' && path.startsWith('/admin/costs')) return json(200, { days: 30, total_cents: 412.6, avg_cents_per_report: 1.9, by_kind: [{ key: 'llm', cents: 318.2, n: 1460, quantity: 9.2e6 }, { key: 'scrape', cents: 94.4, n: 310, quantity: 310 }], by_provider: [{ key: 'gemini', cents: 240.1, n: 1200, quantity: 8e6 }, { key: 'apify', cents: 94.4, n: 310, quantity: 310 }, { key: 'groq', cents: 78.1, n: 260, quantity: 1.2e6 }], by_feature: [{ key: 'free_report', cents: 210.3, n: 900, quantity: 0 }, { key: 'paid_report', cents: 121.2, n: 300, quantity: 0 }, { key: 'rescore', cents: 62.1, n: 210, quantity: 0 }, { key: 'competitors', cents: 19, n: 50, quantity: 0 }], by_model: [{ key: 'gemini-2.5-flash', cents: 240.1, n: 1200, quantity: 8e6 }, { key: 'apify:instagram-profile', cents: 84, n: 280, quantity: 280 }, { key: 'groq/compound', cents: 78.1, n: 260, quantity: 1.2e6 }, { key: 'apify:tiktok-video', cents: 10.4, n: 30, quantity: 26 }], users: [{ account_id: 'u1', email: 'ava@example.com', cost_cents: 14.2, reports: 6, revenue_cents: 2400 }, { account_id: 'u2', email: 'jay@example.com', cost_cents: 9.8, reports: 4, revenue_cents: 1200 }, { account_id: 'u3', email: 'free@example.com', cost_cents: 2.1, reports: 1, revenue_cents: 0 }] });
    if (method === 'GET' && path.startsWith('/admin/funnel')) return json(200, { days: 30, steps: [{ name: 'evaluate_started', actors: 412, total: 460, from_previous: null }, { name: 'evaluate_completed', actors: 371, total: 402, from_previous: 0.9 }, { name: 'report_viewed', actors: 340, total: 880, from_previous: 0.92 }, { name: 'signup', actors: 96, total: 96, from_previous: 0.28 }, { name: 'pricing_viewed', actors: 74, total: 130, from_previous: 0.77 }, { name: 'subscribe', actors: 19, total: 19, from_previous: 0.26 }], other: { share_clicked: { actors: 58, total: 71 }, card_downloaded: { actors: 31, total: 40 }, unlock: { actors: 7, total: 7 }, cancel: { actors: 2, total: 2 } }, by_ref: { FOUNDER50: { evaluate_started: 40, signup: 15, subscribe: 6 } }, retention_month_two: { cohort: 11, retained: 8, rate: 0.73 }, testing: true, variants: [{ name: 'control', growth_plan: 1200, plan_unlock: 1500 }, { name: 'lower', growth_plan: 900, plan_unlock: 1200 }], by_variant: { control: { pricing_viewed: 40, subscribe: 9, unlock: 3, revenue_cents: 15300 }, lower: { pricing_viewed: 34, subscribe: 10, unlock: 4, revenue_cents: 13800 } } });
    if (method === 'GET' && path.startsWith('/admin/business-accounts')) return json(200, { users: [{ user_id: 'u9', email: 'studio@example.com', niche: 'fitness_creator', created_at: Date.now() - 86400000 }], reports: [{ account_id: 'u9', email: 'studio@example.com', handle: 'ironworks_gym', platform: 'instagram', category: 'fitness_creator', overall: 44, generated_at: Date.now() - 86400000 }] });
    if (method === 'GET' && path === '/admin/promos') return json(200, { promos: [{ code: 'FOUNDER50', kind: 'free_months', value: 1, applies_to: 'growth_plan', max_redemptions: 50, redemptions: 12, expires_at: null, active: true, note: 'founders band' }, { code: 'CREATOR20', kind: 'percent', value: 20, applies_to: 'any', max_redemptions: null, redemptions: 3, expires_at: null, active: true, note: '' }] });
    if (method === 'GET' && path === '/account/subscription-status') { const free = entitlement.current_tier === 'social_snapshot'; return json(200, { user_id: 'usr_mock', current_tier: entitlement.current_tier, tier_name: free ? 'Snapshot' : entitlement.current_tier === 'maintenance' ? 'Maintenance' : entitlement.current_tier === 'growth_plan_pro' ? 'Pro' : 'Growth Plan', monthly_price: free ? 0 : entitlement.current_tier === 'maintenance' ? 5 : entitlement.current_tier === 'growth_plan_pro' ? 39 : 19, price_cents: free ? 0 : entitlement.price_cents || null, billing_cycle: entitlement.billing_cycle || null, founder: !!entitlement.founder, pending_tier: entitlement.pending_tier || null, pending_tier_at: entitlement.pending_tier_at || null, limits: LIM[entitlement.current_tier] || null, paused_until: entitlement.paused_until || null, tier_start_date: entitlement.started || (entitlement.started = Date.now()), billing_period_start: free ? null : (entitlement.period_end || Date.now()) - 30 * 86400000, email_paused: !!mockPrefs.paused, billing_period_end: free ? null : (entitlement.period_end || (entitlement.period_end = Date.now() + 30 * 86400000)), cancel_at: entitlement.cancel_at || null, status: free ? 'free' : entitlement.paused_until ? 'paused' : entitlement.cancel_at ? 'cancel_pending' : entitlement.pending_tier ? 'downgrade_pending' : 'active', email_prefs: mockPrefs }); }
    if (method === 'GET' && path === '/account/referrals') return json(200, { ref_code: 'k7m2p9qa', link: location.origin + '/?ref=k7m2p9qa', signed_up: 3, paid: 1, paid_cents: 1200 });
    if (method === 'GET' && path === '/account/email-prefs') return json(200, { prefs: mockPrefs, types: ['weekly_score', 'monday_move', 'milestones', 'product_news'] });
    if (method === 'PUT' && path === '/account/email-prefs') { Object.assign(mockPrefs, body); return json(200, { prefs: mockPrefs, types: ['weekly_score', 'monday_move', 'milestones', 'product_news'] }); }
    if (method === 'GET' && path === '/billing/cancel-preview') return json(200, { current_tier: entitlement.current_tier, ends_at: entitlement.period_end || Date.now() + 30 * 86400000, paused_until: entitlement.paused_until || null, lose: { runs: 4, first_run: Date.now() - 28 * 86400000, streak_weeks: 3, next_posts: 6, competitors: 2, moves_done: 5, level: 'Rising' }, pause: { months: [1, 2, 3] }, maintenance: { tier: 'maintenance', name: 'Maintenance', monthlyPrice: 5, description: 'Keep the weekly rescore and your score history. No plan, no post writing.', features: [] }, reasons: [['price', 'Too expensive'], ['not_using', "I wasn't using it"], ['no_results', "It didn't move my score"], ['missing', 'Missing something I need'], ['break', 'Taking a break from posting'], ['other', 'Other']] });
    if (method === 'POST' && path === '/billing/pause') { const m = Math.max(1, Math.min(3, Number(body.months) || 1)); entitlement.paused_until = Date.now() + m * 30 * 86400000; delete entitlement.cancel_at; return json(200, { status: 'paused', pausedUntil: entitlement.paused_until, months: m }); }
    if (method === 'POST' && path === '/billing/unpause') { delete entitlement.paused_until; return json(200, { status: 'active' }); }
    if (method === 'POST' && path === '/billing/switch') { const order = ['maintenance', 'growth_plan', 'growth_plan_pro']; if (!order.includes(body.tier)) return json(400, { error: 'Only maintenance, growth_plan and growth_plan_pro can be switched to' }); delete entitlement.cancel_at; if (order.indexOf(body.tier) < order.indexOf(entitlement.current_tier)) { entitlement.pending_tier = body.tier; entitlement.pending_tier_at = entitlement.period_end || Date.now() + 30 * 86400000; return json(200, { status: 'downgrade_pending', currentTier: entitlement.current_tier, pendingTier: body.tier, effectiveAt: entitlement.pending_tier_at }); } entitlement.current_tier = body.tier; delete entitlement.pending_tier; entitlement.price_cents = body.tier === 'growth_plan_pro' ? 3900 : 1900; entitlement.founder = false; return json(200, { status: 'active', currentTier: body.tier }); }
    if (method === 'POST' && path === '/billing/cancel') { entitlement.cancel_at = entitlement.period_end || Date.now() + 30 * 86400000; return json(200, { status: 'cancel_pending', endsAt: entitlement.cancel_at }); }
    if (method === 'POST' && path === '/billing/resume') { delete entitlement.cancel_at; return json(200, { status: 'active' }); }
    if (method === 'POST' && path === '/auth/forgot') return json(200, { ok: true, message: 'If that email has an account, a reset link is on its way.' });
    if (method === 'POST' && path === '/auth/reset') { if (body.token === 'expired') return json(400, { error: 'This reset link has expired or was already used. Request a new one.' }); return json(200, { token: 'mock-token', user: { email: 'you@example.com' } }); }
    if (method === 'POST' && (path === '/auth/login' || path === '/auth/signup')) {
      if (!body.email || !body.password) return json(400, { error: 'Email and password required', code: 'INVALID_EMAIL' });
      if (path === '/auth/login' && body.password === 'wrong') return json(401, { error: 'Invalid email or password', code: 'AUTH_FAILED' });
      return json(200, { token: 'mock.' + btoa(body.email) + '.' + Date.now(), user: { user_id: 'usr_mock', email: body.email, company_name: body.company_name || null } });
    }
    if (method === 'GET' && path === '/auth/me') return json(200, { user_id: 'usr_mock', email: 'maya@sunrisefitness.co', company_name: 'Sunrise Fitness BK', is_admin: false, is_business: false, niche: 'fitness_creator', ref_code: 'mockref1', goal: mockGoal.goal, goal_target: mockGoal.goal_target });
    if (method === 'PUT' && path === '/account/goal') { mockGoal = { goal: body.goal, goal_target: body.goal === 'followers' ? Number(body.goal_target) || null : null }; return json(200, mockGoal); }
    return json(404, { error: 'No mock route for ' + method + ' ' + path });
  };
})();
