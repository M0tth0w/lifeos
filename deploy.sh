#!/usr/bin/env bash
# LifeOS deploy script — run once, handles everything.
# Prerequisites: Node 18+, npm, a Cloudflare account, a GitHub account.
set -e
RED='\033[0;31m'; GREEN='\033[0;32m'; AMBER='\033[0;33m'; CYAN='\033[0;36m'; NC='\033[0m'
info()  { echo -e "${CYAN}▸ $1${NC}"; }
ok()    { echo -e "${GREEN}✓ $1${NC}"; }
warn()  { echo -e "${AMBER}! $1${NC}"; }
fail()  { echo -e "${RED}✗ $1${NC}"; exit 1; }
ask()   { echo -e "${AMBER}? $1${NC}"; read -r REPLY; echo "$REPLY"; }

echo ""
echo -e "${AMBER}  LifeOS deploy${NC}"
echo "  ─────────────────────────────────────────────"
echo ""

# ── 1. Check Node ───────────────────────────────────────────────────────────
info "Checking Node.js..."
node -v &>/dev/null || fail "Node.js not found. Install from nodejs.org"
ok "Node $(node -v)"

# ── 2. Install dependencies ──────────────────────────────────────────────────
info "Installing npm packages..."
npm install --silent
ok "packages installed"

# ── 3. Install wrangler ──────────────────────────────────────────────────────
info "Installing wrangler..."
npm install -g wrangler --silent 2>/dev/null || npm install wrangler --save-dev --silent
WRANGLER="$(npm bin)/wrangler"
[ -f "$WRANGLER" ] || WRANGLER="wrangler"
ok "wrangler ready"

# ── 4. Cloudflare login ──────────────────────────────────────────────────────
info "Logging in to Cloudflare (browser will open)..."
$WRANGLER login
ok "Cloudflare authenticated"

# ── 5. GitHub repo ───────────────────────────────────────────────────────────
echo ""
info "Setting up GitHub repo..."
GITHUB_USER=$(ask "Your GitHub username:")
REPO_NAME="lifeos"

git init -q
git add -A
git commit -q -m "LifeOS v1" 2>/dev/null || true

# Try gh CLI first, fall back to manual
if command -v gh &>/dev/null; then
  gh repo create "$REPO_NAME" --public --source=. --push -y 2>/dev/null && ok "Repo created and pushed" || {
    warn "gh CLI failed — creating repo via API..."
    GH_TOKEN=$(ask "GitHub personal access token (needs 'repo' scope — github.com/settings/tokens):")
    curl -sf -H "Authorization: token $GH_TOKEN" \
         -H "Content-Type: application/json" \
         -d "{\"name\":\"$REPO_NAME\",\"private\":false}" \
         https://api.github.com/user/repos > /dev/null
    git remote add origin "https://github.com/$GITHUB_USER/$REPO_NAME.git" 2>/dev/null || true
    git branch -M main
    git push -u origin main -q
    ok "Repo pushed to github.com/$GITHUB_USER/$REPO_NAME"
  }
else
  warn "gh CLI not found — using GitHub API..."
  GH_TOKEN=$(ask "GitHub personal access token (needs 'repo' scope — github.com/settings/tokens):")
  curl -sf -H "Authorization: token $GH_TOKEN" \
       -H "Content-Type: application/json" \
       -d "{\"name\":\"$REPO_NAME\",\"private\":false}" \
       https://api.github.com/user/repos > /dev/null
  git remote add origin "https://github.com/$GITHUB_USER/$REPO_NAME.git" 2>/dev/null || true
  git branch -M main
  git push -u origin main -q
  ok "Repo pushed to github.com/$GITHUB_USER/$REPO_NAME"
fi

GITHUB_RAW_URL="https://raw.githubusercontent.com/$GITHUB_USER/$REPO_NAME/main/worker.js"
ok "worker.js URL: $GITHUB_RAW_URL"

# ── 6. Deploy Pages (frontend) ───────────────────────────────────────────────
echo ""
info "Building frontend..."
npm run build --silent
ok "build complete (dist/)"

info "Deploying to Cloudflare Pages..."
PAGES_URL=$($WRANGLER pages deploy dist --project-name=lifeos-dashboard 2>&1 | grep -oE 'https://[a-zA-Z0-9._-]+\.pages\.dev' | tail -1)
[ -z "$PAGES_URL" ] && warn "Couldn't auto-detect Pages URL — check dash.cloudflare.com/pages for it" || ok "Pages URL: $PAGES_URL"

# ── 7. Update wrangler.toml with real URLs ───────────────────────────────────
info "Updating wrangler.toml..."
if [ -n "$PAGES_URL" ]; then
  sed -i.bak "s|APP_URL = \"FILLED_BY_DEPLOY\"|APP_URL = \"$PAGES_URL\"|" wrangler.toml
fi
sed -i.bak "s|WORKER_SOURCE_URL = \"FILLED_BY_DEPLOY\"|WORKER_SOURCE_URL = \"$GITHUB_RAW_URL\"|" wrangler.toml
rm -f wrangler.toml.bak
ok "wrangler.toml updated"

# ── 8. Set Worker secrets ────────────────────────────────────────────────────
echo ""
echo -e "${AMBER}  Setting secrets — paste each value when prompted.${NC}"
echo -e "  ${CYAN}(Generate MASTER_KEY with: openssl rand -base64 32)${NC}"
echo ""

for SECRET in MASTER_KEY GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET NOTION_CLIENT_ID NOTION_CLIENT_SECRET CLOUDFLARE_CLIENT_ID CLOUDFLARE_CLIENT_SECRET; do
  info "Secret: $SECRET"
  $WRANGLER secret put $SECRET
  ok "$SECRET set"
done

# ── 9. Deploy Worker ─────────────────────────────────────────────────────────
echo ""
info "Deploying Worker..."
WORKER_OUTPUT=$($WRANGLER deploy 2>&1)
echo "$WORKER_OUTPUT" | grep -E "Deployed|https://" || true
WORKER_URL=$(echo "$WORKER_OUTPUT" | grep -oE 'https://[a-zA-Z0-9._-]+\.workers\.dev' | tail -1)
ok "Worker deployed${WORKER_URL:+: $WORKER_URL}"

# ── 10. Patch DEFAULT_API_BASE in App.jsx ────────────────────────────────────
if [ -n "$WORKER_URL" ]; then
  info "Patching DEFAULT_API_BASE in src/App.jsx..."
  sed -i.bak "s|const DEFAULT_API_BASE = \"\"|const DEFAULT_API_BASE = \"$WORKER_URL\"|" src/App.jsx
  rm -f src/App.jsx.bak
  ok "DEFAULT_API_BASE = $WORKER_URL"

  info "Rebuilding and redeploying frontend with Worker URL..."
  npm run build --silent
  $WRANGLER pages deploy dist --project-name=lifeos-dashboard > /dev/null 2>&1
  ok "Frontend redeployed"
fi

# ── 11. Push final state to GitHub ───────────────────────────────────────────
info "Pushing final config to GitHub..."
git add -A
git commit -q -m "Set production URLs" 2>/dev/null || true
git push -q
ok "GitHub up to date"

# ── 12. Connect Pages to GitHub (manual step) ───────────────────────────────
echo ""
echo -e "${GREEN}  ─────────────────────────────────────────────${NC}"
echo -e "${GREEN}  Done.${NC}"
echo ""
[ -n "$PAGES_URL" ] && echo -e "  App URL:    ${CYAN}$PAGES_URL${NC}"
[ -n "$WORKER_URL" ] && echo -e "  Worker URL: ${CYAN}$WORKER_URL${NC}"
echo ""
echo -e "${AMBER}  One manual step remaining — connect Pages to GitHub${NC}"
echo -e "  so future git pushes auto-redeploy the frontend:"
echo ""
echo -e "  1. Go to ${CYAN}dash.cloudflare.com${NC} → Workers & Pages"
echo -e "  2. Click ${CYAN}lifeos-dashboard${NC} → Settings → Builds & Deployments"
echo -e "  3. Connect to Git → pick ${CYAN}$GITHUB_USER/$REPO_NAME${NC}"
echo -e "  4. Build command: ${CYAN}npm run build${NC}  Output: ${CYAN}dist${NC}"
echo ""
echo -e "${AMBER}  Also add OAuth redirect URIs:${NC}"
echo -e "  Google:     ${CYAN}${WORKER_URL:-YOUR_WORKER_URL}/auth/google/callback${NC}"
echo -e "  Notion:     ${CYAN}${WORKER_URL:-YOUR_WORKER_URL}/oauth/notion/callback${NC}"
echo -e "  Cloudflare: ${CYAN}${WORKER_URL:-YOUR_WORKER_URL}/oauth/cloudflare/callback${NC}"
echo ""
