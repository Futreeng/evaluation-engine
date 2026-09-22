#!/usr/bin/env bash
# Publish public/ as the sample-data demo at scalecraft-demo.vercel.app.
#
# The demo is the same front end as production: config.js turns mock mode on
# by hostname (`mockHosts`), so nothing gets patched here — this just stages
# public/ next to a vercel.json and deploys it. Needs the Vercel CLI signed in
# to the FutreEng team (`vercel login`).
#
#   scripts/deploy_demo.sh            # production deploy of the demo project
#   scripts/deploy_demo.sh --preview  # preview URL only
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
STAGE="${TMPDIR:-/tmp}/scalecraft-demo-deploy"
rm -rf "$STAGE" && mkdir -p "$STAGE/.vercel"
cp -R "$ROOT/public" "$STAGE/public"
cat > "$STAGE/vercel.json" <<'JSON'
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "outputDirectory": "public",
  "framework": null,
  "headers": [
    { "source": "/(.*)\\.(js|css)", "headers": [{ "key": "Cache-Control", "value": "public, max-age=3600, must-revalidate" }] }
  ]
}
JSON
# Vercel project link (ids are identifiers, not secrets).
cat > "$STAGE/.vercel/project.json" <<'JSON'
{"projectId":"prj_1WFZVb1PbcDCdrelT3xbHeRpRjKp","orgId":"team_5QoTMZC4sGJuB9Ll4fiWDCZl","projectName":"scalecraft-demo"}
JSON
cd "$STAGE"
if [ "${1:-}" = "--preview" ]; then vercel deploy --yes; else vercel deploy --prod --yes; fi
