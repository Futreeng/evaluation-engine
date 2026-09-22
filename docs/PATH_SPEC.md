# The Path — one step at a time

Branch `feat/path`. Decided 22 Sept 2026 after the sample-report audit.

## Why

The report is a good document and a bad to-do list. A paying creator opens it and sees
fifteen moves, a calendar and six posts competing for attention, and the plan repeats
itself (the same bio move four times, the same reel referenced ten times). The Path turns
the plan into the thing they open every day: one step, why it matters, how to do it, done.

## Part 1 — plan quality (prerequisite)

`server/growth_engine_plan_quality.js`, wired into `evaluateTier1`.

1. **Phases are written in order, not in parallel.** Phase 2 sees phase 1's moves, phase 3
   sees both. Prompt rule: never repeat a move already in the plan, never touch the same
   bio line, highlight, pinned post or link twice.
2. **Validator.** Every move gets a topic (`bio_cta`, `bio_link`, `bio_rewrite`, `highlight`,
   `pin`, `schedule`, `format`, `engage`, `repurpose`, `other`). A plan is rejected and the
   phase rewritten once when: two moves share a one-off topic; a move's topic belongs to a
   different dimension than the phase label; one post is cited by more than two moves.
   After the retry, duplicates are dropped rather than shipped.
3. **One schedule.** Posting days and times are derived, not asked for: cadence from the
   hours answer (under 2h → 2/wk, 2–5h → 3/wk, else the category target capped at 4),
   days from the account's own best days, time from its best window on that day. The
   schedule is fixed in every prompt (moves, calendar, posts) and the report shows one
   set of numbers.
4. **Verified mechanics.** A small library of real Instagram and TikTok steps (add link,
   edit bio, pin a post, make a highlight from a story, schedule a post). When a move's
   topic matches, its "how" comes from the library, not the model.
5. **Posts have names.** "the Cape Flattery reel (Sep 17)" instead of "2026‑09‑17". Every
   date reference in moves, calendar and posts is rewritten to the post's name.
6. **Written posts are for the audience.** No "swipe up", no `[Name]` placeholders, no
   sponsor-facing lines; at most one post per set may pitch a media kit.
7. **One consistency target.** The benchmark text the model sees is generated from the
   same numeric targets the scorer uses, so explanation, evidence and plan agree.
8. **Label honesty.** A dimension named in the summary as a loss is tagged "Biggest gap",
   never "Strong".

## Part 2 — the Path

Route `#/path/:report`. Server `GET /reports/:id/path`, `POST /reports/:id/path/:key`.

### Steps

Every step has the same shape: `key, kind, phase, title, action, why, how[], example,
done_when, time, due (date or null), status, verified`. Kinds:

| kind | source | advances by | key |
|---|---|---|---|
| move | plan opener or move | completion | `p1m2` (existing keys) |
| slot | calendar slot, with the matching written post attached | its date | `c3-wed` |

Order inside a phase: moves first (they take minutes and lift the weakest dimension),
then slots by date. A phase opens when the previous phase's moves are all done or skipped,
or its first day arrives, whichever comes first.

### Status

`open · done · skipped · later · verified`. Done and skipped are terminal; later comes back
tomorrow and does not break the streak. Skip takes one tap for a reason (`did_it`,
`cant`, `not_me`), stored on the report and surfaced in admin move outcomes.

Stored on the report body: `moves_done` (existing), `moves_skipped {key:{at,reason}}`,
`moves_later {key: until}`, `moves_verified {key:{at, ok, note}}`.

### Verification at rescore

At every rescore the job queue compares the new profile against open and done moves:

| topic | check |
|---|---|
| bio_link | `profile.external_url` present |
| bio_cta / bio_rewrite | bio text changed since plan start |
| pin | a pinned post exists |
| highlight | `highlight_count` increased |
| schedule / slot | a post exists on the slot's date (±1 day) |

Verified moves get a second tick. A move the user marked done that the rescore can't see
comes back with "We couldn't see this on your profile yet."

### Screen states

- **Now**: one card. Progress line "Step 4 of 21 · Days 1–30 · Profile". Buttons Done,
  Skip, Not today. "Why this" collapsed. "2 today" when a move and a slot both fall today.
- **Done moment**: tick, streak, phase progress, next card slides in.
- **Caught up**: "Next step: Wednesday — post the Cape Flattery re-cut. Work ahead?"
- **Free**: steps 1–3 live, the rest greyed with the count and the unlock button at the end.

The report keeps the 30-60-90 list read-only with ticks; its "This week" card becomes
"Start here →". Signed-in users with a plan land on the Path; the report is one tap away.
Monday and score emails link to the Path.

## Not in this build

- Reminders/push. Email cadence stays as is.
- The 90-day map view (option 3). Layer for later.
- Regenerating the public sample (LLM quota). The shipped sample is cleaned by running the
  deterministic parts of Part 1 over it.
