# Email templates (Claude Design batch 4)

Three single-column 600px emails in the Field Guide identity. Inline styles only.
Not wired to a sender yet — the backend has no mailer. Suggested: Resend
(free tier 3k/mo) from `growth_engine_job_queue.js` on completion, and a
daily cron for `move_due` / `score_changed`.

| File | When | Placeholders |
|---|---|---|
| `report_ready.html` | job complete | handle, score, grade, summary, move, report_url |
| `move_due.html` | day 30 / 60 / 90 of a paid plan | handle, move, why, report_url |
| `score_changed.html` | weekly refresh where overall moved | handle, old, new, dimension, delta, report_url |

Static HTML — swap the placeholder values with your templating engine before sending.
