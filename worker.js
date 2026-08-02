/**
 * LifeOS — backend Worker (v3: bring-your-own-Cloudflare)
 *
 * THIS FILE RUNS IN TWO ROLES, DISTINGUISHED ONLY BY WHICH SECRETS ARE SET:
 *
 *   ORCHESTRATOR   (Matthew's deployment — the one with GOOGLE_CLIENT_ID /
 *                   NOTION_CLIENT_ID set) brokers every OAuth flow that
 *                   requires a stable, pre-registered redirect URI (Google,
 *                   Notion, Cloudflare itself), and provisions each user's
 *                   own personal deployment on request.
 *
 *   PERSONAL       (every user's own deployment, living in their own
 *   DEPLOYMENT     Cloudflare account, provisioned automatically — has
 *                   INTERNAL_RELAY_SECRET set, no GOOGLE_CLIENT_ID). This is
 *                   where that user's actual credentials, config, and cron
 *                   job live from then on. The orchestrator relays freshly
 *                   completed OAuth grants here and otherwise steps back —
 *                   a user who's provisioned is no longer dependent on
 *                   Matthew's Cloudflare account, D1, or uptime for their
 *                   day-to-day automation.
 *
 * ROUTES
 * ------
 * Auth (Google is the only identity provider — also doubles as the OAuth
 * flow for Calendar/Gmail, so there's no separate "login" system to secure):
 *   GET  /auth/google/start?scopes=calendar,gmail   → redirect to Google
 *   GET  /auth/google/callback                      → Google redirects back here
 *   POST /auth/logout
 *   GET  /api/me                                    → also returns {worker_url,
 *                                                       relay_token} once provisioned
 *
 * Credential vault:
 *   GET    /api/credentials              → connection status, never secret values
 *   POST   /api/credentials/:service     → store an API-key style credential
 *                                           (:service ∈ canvas | monday | gemini | ntfy)
 *   DELETE /api/credentials/:service
 *
 * OAuth connectors (beyond Google, which is handled by /auth/google/start):
 *   GET /oauth/notion/start
 *   GET /oauth/notion/callback
 *   GET /oauth/cloudflare/start      — orchestrator only; bootstraps provisioning
 *   GET /oauth/cloudflare/callback
 *
 * Provisioning (orchestrator only):
 *   POST /api/provision   → create this user's own D1 + deploy their own
 *                            Worker into their own Cloudflare account
 *   GET  /api/provision    → current deployment status
 *
 * Internal, Worker-to-Worker only (personal deployments only):
 *   POST /internal/receive-credential   → orchestrator relays a freshly
 *                                          completed OAuth grant here
 *
 * Web scraping / research agent:
 *   POST   /api/scrape         → ad-hoc: fetch a URL, extract text via
 *                                 HTMLRewriter, ask Gemini against a stated goal
 *   GET    /api/watch          → list this user's periodic scrape jobs
 *   POST   /api/watch          → create one (runs once immediately, then
 *                                 rides the same Cron Trigger as everything else)
 *   DELETE /api/watch/:id
 *
 * GET /api/digest — same reminder-check/email-triage logic the Cron Trigger
 *   runs, returned as structured JSON on demand for the dashboard's Digest tab
 *
 * Non-secret per-user config (Notion database ids, monday board ids, etc.):
 *   GET /api/config
 *   PUT /api/config
 *
 * Data proxy (dashboard calls these; the Worker attaches the user's own
 * decrypted credentials so the browser never touches a raw token):
 *   ANY  /proxy/notion/*
 *   ANY  /proxy/canvas/*
 *   POST /proxy/monday
 *
 * scheduled() — Cron Trigger, replaces GitHub Actions + daily_check.py.
 * On the orchestrator, only runs for users who haven't provisioned their own
 * deployment yet (fallback/shared-hosting mode). On a personal deployment,
 * this is the one and only cron job for that one user.
 *
 * REQUIRED ENV / SECRETS (wrangler.toml + `wrangler secret put`)
 * ----------------------------------------------------------------
 * Orchestrator only:
 *   GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET   Google Cloud Console → Credentials
 *   NOTION_CLIENT_ID / NOTION_CLIENT_SECRET   a Notion "public" integration
 *   CLOUDFLARE_CLIENT_ID / CLOUDFLARE_CLIENT_SECRET
 *                                              a Cloudflare self-managed OAuth
 *                                              client (Manage Account → OAuth
 *                                              clients) — see SETUP.md
 * Both roles:
 *   DB                    D1 binding (see schema.sql)
 *   MASTER_KEY            32-byte key, base64. openssl rand -base64 32
 *   APP_URL               the React dashboard's origin
 *   WORKER_URL            this Worker's own URL
 * Personal deployments only (set automatically at provision time):
 *   INTERNAL_RELAY_SECRET
 *
 * See SETUP.md for the OAuth app registration steps.
 */

const API_KEY_SERVICES = new Set(["canvas", "monday", "gemini", "ntfy"]);
const SESSION_COOKIE = "lifeos_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;       // 10 minutes

// ── Crypto helpers ────────────────────────────────────────────────────────────

function bytesToBase64(bytes) {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function base64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function base64UrlFromBytes(bytes) {
  return bytesToBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function randomToken(numBytes = 32) {
  return base64UrlFromBytes(crypto.getRandomValues(new Uint8Array(numBytes)));
}

async function sha256Hex(str) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function sha256Base64Url(str) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  return base64UrlFromBytes(new Uint8Array(digest));
}

async function masterKey(env) {
  return crypto.subtle.importKey("raw", base64ToBytes(env.MASTER_KEY), "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}

// AES-GCM, unique random IV per call. This is the only place secrets touch
// plaintext outside of the third-party API call that consumes them.
async function encryptJSON(env, obj) {
  const key = await masterKey(env);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new TextEncoder().encode(JSON.stringify(obj));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, data);
  return { ciphertext: bytesToBase64(new Uint8Array(ciphertext)), iv: bytesToBase64(iv) };
}

async function decryptJSON(env, ciphertextB64, ivB64) {
  const key = await masterKey(env);
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64ToBytes(ivB64) },
    key,
    base64ToBytes(ciphertextB64)
  );
  return JSON.parse(new TextDecoder().decode(plain));
}

// ── Relay tokens ──────────────────────────────────────────────────────────────
//
// Once a user has their own personal deployment, the dashboard talks to it
// directly — but a session cookie set on the orchestrator's domain won't be
// sent cross-origin to someone's own *.workers.dev subdomain. Instead, /api/me
// mints a short-lived HMAC-signed token (keyed on that user's own
// INTERNAL_RELAY_SECRET, established once at provision time) that the
// dashboard presents as a Bearer token to their personal Worker. Same secret
// also authenticates the orchestrator's own server-to-server credential
// relay — see /internal/receive-credential.

async function hmacSha256Hex(secret, message) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function mintRelayToken(secret, userId, ttlMs = 15 * 60 * 1000) {
  const expires = Date.now() + ttlMs;
  const payload = `${userId}.${expires}`;
  return `${payload}.${await hmacSha256Hex(secret, payload)}`;
}

// Cloudflare's own guidance for comparing secret values: don't short-circuit
// on length mismatch, hash both sides to a fixed size first. Used for every
// secret-vs-attacker-input comparison in this file — the relay token's
// signature, and the bearer-secret check on /internal/receive-credential.
async function constantTimeEqual(a, b) {
  const ha = await sha256Hex(a || "");
  const hb = await sha256Hex(b || "");
  let diff = 0;
  for (let i = 0; i < 64; i++) diff |= ha.charCodeAt(i) ^ hb.charCodeAt(i);
  return diff === 0;
}

async function verifyRelayToken(secret, token) {
  const parts = (token || "").split(".");
  if (parts.length !== 3) return null;
  const [userId, expires, sig] = parts;
  if (!Number.isFinite(Number(expires)) || Date.now() > Number(expires)) return null;
  const expected = await hmacSha256Hex(secret, `${userId}.${expires}`);
  return (await constantTimeEqual(sig, expected)) ? userId : null;
}

// ── Request helpers ───────────────────────────────────────────────────────────

function getCookie(request, name) {
  const header = request.headers.get("Cookie") || "";
  const match = header.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return match ? decodeURIComponent(match[1]) : null;
}

function corsHeaders(env) {
  return {
    "Access-Control-Allow-Origin": env.APP_URL,
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

function json(env, obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders(env) },
  });
}

async function getSessionUser(request, env) {
  // Personal deployments have no same-site cookie to check against — the
  // dashboard calls them directly with a relay token instead.
  if (env.INTERNAL_RELAY_SECRET) {
    const auth = request.headers.get("Authorization") || "";
    const bearer = auth.startsWith("Bearer ") ? auth.slice(7) : null;
    if (bearer) {
      const userId = await verifyRelayToken(env.INTERNAL_RELAY_SECRET, bearer);
      if (userId) {
        const row = await env.DB.prepare("SELECT id, email, name, avatar_url FROM users WHERE id = ?").bind(userId).first();
        if (row) return row;
      }
    }
  }

  const token = getCookie(request, SESSION_COOKIE);
  if (!token) return null;
  const tokenHash = await sha256Hex(token);
  const row = await env.DB.prepare(
    `SELECT s.expires_at, u.id, u.email, u.name, u.avatar_url
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ?`
  )
    .bind(tokenHash)
    .first();
  if (!row) return null;
  if (new Date(row.expires_at) < new Date()) return null;
  return { id: row.id, email: row.email, name: row.name, avatar_url: row.avatar_url };
}

// ── Credential vault ──────────────────────────────────────────────────────────

async function getDecryptedCredential(env, userId, service) {
  const row = await env.DB.prepare(
    "SELECT ciphertext, iv, expires_at FROM credentials WHERE user_id = ? AND service = ?"
  )
    .bind(userId, service)
    .first();
  if (!row) return null;
  const data = await decryptJSON(env, row.ciphertext, row.iv);
  return { ...data, expires_at: row.expires_at };
}

async function upsertCredential(env, userId, service, authType, payload, extra = {}) {
  const { ciphertext, iv } = await encryptJSON(env, payload);
  await env.DB.prepare(
    `INSERT INTO credentials (id, user_id, service, auth_type, ciphertext, iv, scopes, expires_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(user_id, service) DO UPDATE SET
       ciphertext = excluded.ciphertext, iv = excluded.iv,
       scopes = excluded.scopes, expires_at = excluded.expires_at, updated_at = datetime('now')`
  )
    .bind(crypto.randomUUID(), userId, service, authType, ciphertext, iv, extra.scopes ?? null, extra.expiresAt ?? null)
    .run();
}

async function refreshGoogleToken(env, userId, service, refreshToken) {
  const resp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  const tokens = await resp.json();
  if (!resp.ok) throw new Error(`Google refresh failed: ${JSON.stringify(tokens)}`);
  await upsertCredential(
    env,
    userId,
    service,
    "oauth",
    { access_token: tokens.access_token, refresh_token: refreshToken },
    { expiresAt: new Date(Date.now() + tokens.expires_in * 1000).toISOString() }
  );
  return tokens.access_token;
}

async function getValidGoogleAccessToken(env, userId, service) {
  const cred = await getDecryptedCredential(env, userId, service);
  if (!cred) return null;
  const expiringSoon = !cred.expires_at || new Date(cred.expires_at) < new Date(Date.now() + 60_000);
  if (expiringSoon && cred.refresh_token) return refreshGoogleToken(env, userId, service, cred.refresh_token);
  return cred.access_token;
}

// ── Credential relay (orchestrator → a user's own personal deployment) ───────
//
// Every place that previously called upsertCredential() directly for a
// user-facing OAuth grant or pasted API key now goes through this instead.
// If the user has provisioned their own Worker, their secret goes there, not
// into the orchestrator's D1 — that's the whole point of bring-your-own-
// Cloudflare. If they haven't provisioned yet, it falls back to storing
// locally (unchanged behavior from before this feature existed).

async function storeUserCredential(env, userId, service, authType, payload, extra = {}) {
  const deployment = await env.DB.prepare(
    "SELECT value FROM user_config WHERE user_id = ? AND key = 'deployment.worker_url'"
  )
    .bind(userId)
    .first();
  const relay = await getDecryptedCredential(env, userId, "_relay");

  if (deployment?.value && relay?.secret) {
    try {
      const resp = await fetch(`${deployment.value}/internal/receive-credential`, {
        method: "POST",
        headers: { Authorization: `Bearer ${relay.secret}`, "Content-Type": "application/json" },
        body: JSON.stringify({ userId, service, authType, payload, extra }),
      });
      if (resp.ok) return;
      console.error(`relay to personal worker failed (${resp.status}) for ${userId}/${service} — falling back to local vault`);
    } catch (e) {
      console.error(`relay to personal worker threw for ${userId}/${service}:`, e.message);
    }
  }

  await upsertCredential(env, userId, service, authType, payload, extra);
}

// ── Cloudflare bring-your-own-account provisioning ────────────────────────────
//
// Cloudflare's self-managed OAuth (GA June 2026) is what makes this possible —
// any developer can register an OAuth client and get scoped, revocable,
// per-user delegated access to a Cloudflare account, the same mechanism
// `wrangler login` itself has always used internally. Endpoints below are
// Cloudflare's fixed dashboard OAuth endpoints, not something we host.

const CLOUDFLARE_AUTHORIZE_URL = "https://dash.cloudflare.com/oauth2/auth";
const CLOUDFLARE_TOKEN_URL = "https://dash.cloudflare.com/oauth2/token";
const CLOUDFLARE_API = "https://api.cloudflare.com/client/v4";

async function refreshCloudflareToken(env, userId, refreshToken) {
  const resp = await fetch(CLOUDFLARE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.CLOUDFLARE_CLIENT_ID,
      client_secret: env.CLOUDFLARE_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  const tokens = await resp.json();
  if (!resp.ok) throw new Error(`Cloudflare refresh failed: ${JSON.stringify(tokens)}`);
  const existing = await getDecryptedCredential(env, userId, "cloudflare");
  await upsertCredential(
    env,
    userId,
    "cloudflare",
    "oauth",
    { access_token: tokens.access_token, refresh_token: tokens.refresh_token || refreshToken, account_id: existing?.account_id },
    { expiresAt: new Date(Date.now() + tokens.expires_in * 1000).toISOString() }
  );
  return tokens.access_token;
}

async function getValidCloudflareToken(env, userId) {
  const cred = await getDecryptedCredential(env, userId, "cloudflare");
  if (!cred) return null;
  const expiringSoon = !cred.expires_at || new Date(cred.expires_at) < new Date(Date.now() + 60_000);
  const token = expiringSoon && cred.refresh_token ? await refreshCloudflareToken(env, userId, cred.refresh_token) : cred.access_token;
  return { token, accountId: cred.account_id };
}

async function cf(token, path, opts = {}) {
  const resp = await fetch(`${CLOUDFLARE_API}${path}`, {
    ...opts,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(opts.headers || {}) },
  });
  const data = opts.raw ? null : await resp.json();
  if (!resp.ok || (data && data.success === false)) {
    throw new Error(`Cloudflare API ${path} failed: ${JSON.stringify(data?.errors || (await resp.text().catch(() => "")))}`);
  }
  return data?.result ?? data;
}

// Same statements applied to the orchestrator's own D1 (schema.sql) — kept as
// one array so a user's personal database is provisioned identically.
const SCHEMA_STATEMENTS = [
  `CREATE TABLE users (id TEXT PRIMARY KEY, google_sub TEXT UNIQUE NOT NULL, email TEXT NOT NULL, name TEXT, avatar_url TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), last_login_at TEXT)`,
  `CREATE TABLE sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, created_at TEXT NOT NULL DEFAULT (datetime('now')), expires_at TEXT NOT NULL, user_agent TEXT, ip_hash TEXT)`,
  `CREATE INDEX idx_sessions_user ON sessions(user_id)`,
  `CREATE TABLE credentials (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, service TEXT NOT NULL, auth_type TEXT NOT NULL, ciphertext TEXT NOT NULL, iv TEXT NOT NULL, key_version INTEGER NOT NULL DEFAULT 1, scopes TEXT, expires_at TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE(user_id, service))`,
  `CREATE INDEX idx_credentials_user ON credentials(user_id)`,
  `CREATE TABLE oauth_state (state TEXT PRIMARY KEY, purpose TEXT NOT NULL, user_id TEXT, code_verifier TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), expires_at TEXT NOT NULL)`,
  `CREATE TABLE user_config (user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, key TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY (user_id, key))`,
  `CREATE TABLE reminder_rules (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, type_name TEXT NOT NULL, offsets TEXT NOT NULL)`,
  `CREATE INDEX idx_rules_user ON reminder_rules(user_id)`,
  `CREATE TABLE watch_jobs (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, target_url TEXT NOT NULL, goal TEXT NOT NULL, frequency TEXT NOT NULL, notify_via TEXT NOT NULL DEFAULT 'ntfy', last_run_at TEXT, last_result TEXT, next_run_at TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')))`,
  `CREATE INDEX idx_watch_user ON watch_jobs(user_id)`,
  `CREATE INDEX idx_watch_next_run ON watch_jobs(next_run_at)`,
  `CREATE TABLE rate_limits (bucket_key TEXT PRIMARY KEY, window_start TEXT NOT NULL, count INTEGER NOT NULL DEFAULT 1)`,
  `CREATE TABLE upload_formats (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, name TEXT NOT NULL, source_folder TEXT NOT NULL, pick_count INTEGER NOT NULL DEFAULT 1, selection TEXT NOT NULL DEFAULT 'random', caption_template TEXT, hashtags TEXT, platforms TEXT NOT NULL, schedule TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')))`,
  `CREATE INDEX idx_upfmt_user ON upload_formats(user_id)`,
  `CREATE TABLE upload_jobs (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, format_id TEXT, platform TEXT NOT NULL, account TEXT, payload TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'queued', error TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), completed_at TEXT)`,
  `CREATE INDEX idx_upjob_user ON upload_jobs(user_id)`,
  `CREATE INDEX idx_upjob_status ON upload_jobs(status)`,
];

// The one-click "deploy my own LifeOS backend" action. Everything from here
// down runs using the USER's own Cloudflare OAuth token — every resource it
// touches is created in their account, not Matthew's.
async function provisionUserWorker(env, userId, user) {
  const cfAuth = await getValidCloudflareToken(env, userId);
  if (!cfAuth) throw new Error("Cloudflare not connected");

  const accounts = await cf(cfAuth.token, "/accounts");
  const accountId = cfAuth.accountId || accounts[0]?.id;
  if (!accountId) throw new Error("No Cloudflare account authorized");

  const scriptName = `lifeos-${userId.slice(0, 8)}`;

  // 1. Their own D1 database, schema applied fresh.
  const db = await cf(cfAuth.token, `/accounts/${accountId}/d1/database`, {
    method: "POST",
    body: JSON.stringify({ name: scriptName }),
  });
  for (const sql of SCHEMA_STATEMENTS) {
    await cf(cfAuth.token, `/accounts/${accountId}/d1/database/${db.uuid}/query`, {
      method: "POST",
      body: JSON.stringify({ sql }),
    });
  }
  // Seed their user row so ids line up across both databases.
  await cf(cfAuth.token, `/accounts/${accountId}/d1/database/${db.uuid}/query`, {
    method: "POST",
    body: JSON.stringify({
      sql: "INSERT INTO users (id, google_sub, email, name, avatar_url, last_login_at) VALUES (?, ?, ?, ?, ?, datetime('now'))",
      params: [user.id, user.google_sub || "", user.email, user.name, user.avatar_url],
    }),
  });

  // 2. Fresh, unique secrets for this deployment only.
  const personalMasterKey = bytesToBase64(crypto.getRandomValues(new Uint8Array(32)));
  const internalSecret = randomToken(32);
  const workerUrl = `https://${scriptName}.${await workersDevSubdomain(cfAuth.token, accountId)}.workers.dev`;

  // 3. Upload the script itself — this exact file, reused as-is (its role is
  // decided purely by which secrets/vars are present below, not by different
  // code). A Worker can't embed its own source as a string without a build
  // step, so the orchestrator pulls it fresh from the canonical copy in your
  // repo. Point WORKER_SOURCE_URL at the raw GitHub URL of this exact file —
  // e.g. https://raw.githubusercontent.com/<you>/lifeos/main/worker.js —
  // and keep it in sync whenever you change this file.
  const workerSource = await (await fetch(env.WORKER_SOURCE_URL)).text();
  const metadata = {
    main_module: "worker.js",
    compatibility_date: "2026-07-01",
    bindings: [{ type: "d1", name: "DB", id: db.uuid }],
  };
  const form = new FormData();
  form.append("metadata", JSON.stringify(metadata));
  form.append("worker.js", new Blob([workerSource], { type: "application/javascript+module" }), "worker.js");
  await cf(cfAuth.token, `/accounts/${accountId}/workers/scripts/${scriptName}`, { method: "PUT", body: form, headers: {}, raw: true });

  // 4. Secrets + vars (secrets are write-only from here on, even to the
  // account owner — see SECURITY.md for why that matters).
  const secrets = {
    MASTER_KEY: personalMasterKey,
    INTERNAL_RELAY_SECRET: internalSecret,
    GOOGLE_CLIENT_ID: env.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: env.GOOGLE_CLIENT_SECRET,
    NOTION_CLIENT_ID: env.NOTION_CLIENT_ID,
    NOTION_CLIENT_SECRET: env.NOTION_CLIENT_SECRET,
  };
  for (const [name, text] of Object.entries(secrets)) {
    await cf(cfAuth.token, `/accounts/${accountId}/workers/scripts/${scriptName}/secrets`, {
      method: "PUT",
      body: JSON.stringify({ name, text, type: "secret_text" }),
    });
  }
  // vars (non-secret) go through the same endpoint's plain_text binding, or a
  // settings PATCH depending on API version in use at deploy time — verify
  // against current docs before first run.
  await cf(cfAuth.token, `/accounts/${accountId}/workers/scripts/${scriptName}/settings`, {
    method: "PATCH",
    body: JSON.stringify({
      bindings: [{ type: "plain_text", name: "APP_URL", text: env.APP_URL }, { type: "plain_text", name: "WORKER_URL", text: workerUrl }],
    }),
  });

  // 5. Cron — same schedule as the orchestrator's fallback job, now running
  // solely for this one user.
  await cf(cfAuth.token, `/accounts/${accountId}/workers/scripts/${scriptName}/schedules`, {
    method: "PUT",
    body: JSON.stringify({ crons: ["0 7 * * *", "0 12 * * *"] }),
  });

  // 6. Make it reachable on workers.dev.
  await cf(cfAuth.token, `/accounts/${accountId}/workers/scripts/${scriptName}/subdomain`, {
    method: "POST",
    body: JSON.stringify({ enabled: true }),
  });

  // 7. Record the deployment, store the shared relay secret, and migrate
  // over anything already connected locally before this point.
  await env.DB.batch([
    env.DB.prepare("INSERT INTO user_config (user_id, key, value) VALUES (?, 'deployment.worker_url', ?) ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value").bind(userId, workerUrl),
    env.DB.prepare("INSERT INTO user_config (user_id, key, value) VALUES (?, 'deployment.account_id', ?) ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value").bind(userId, accountId),
    env.DB.prepare("INSERT INTO user_config (user_id, key, value) VALUES (?, 'deployment.status', 'ready') ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value").bind(userId),
  ]);
  await upsertCredential(env, userId, "_relay", "internal", { secret: internalSecret });

  const existingServices = await env.DB.prepare("SELECT service FROM credentials WHERE user_id = ? AND service NOT IN ('cloudflare','_relay')").bind(userId).all();
  for (const row of existingServices.results) {
    const cred = await getDecryptedCredential(env, userId, row.service);
    const { expires_at, ...payload } = cred;
    await fetch(`${workerUrl}/internal/receive-credential`, {
      method: "POST",
      headers: { Authorization: `Bearer ${internalSecret}`, "Content-Type": "application/json" },
      body: JSON.stringify({ userId, service: row.service, authType: "migrated", payload, extra: { expiresAt: expires_at } }),
    }).catch((e) => console.error(`migrating ${row.service} to personal worker failed:`, e.message));
    await env.DB.prepare("DELETE FROM credentials WHERE user_id = ? AND service = ?").bind(userId, row.service).run();
  }

  return { workerUrl, accountId };
}

async function workersDevSubdomain(token, accountId) {
  const result = await cf(token, `/accounts/${accountId}/workers/subdomain`);
  return result.subdomain;
}

// ── Web scraping / research agent ─────────────────────────────────────────────
//
// Deliberately NOT a headless-browser setup — plain fetch() + HTMLRewriter
// (a real, built-in Workers API, not a library) covers static HTML, which is
// most sites worth pointing this at. JS-heavy SPAs won't render; that would
// need Cloudflare's Browser Rendering API, a separate heavier feature to add
// if a specific target actually needs it — don't reach for it by default.

async function extractTextFromHTML(html) {
  let text = ""
  const rewriter = new HTMLRewriter()
    .on("script, style, noscript, svg, nav, footer, header, iframe", { element(el){ el.remove() } })
    .on("body *", { text(t){ text += t.text; if (t.lastInTextNode) text += " " } })
  const transformed = rewriter.transform(new Response(html, { headers: { "Content-Type": "text/html" } }))
  await transformed.text() // drains the stream — handlers only fire once consumed
  return text.replace(/\s+/g, " ").trim()
}

async function runScrapeJob(env, userId, { target_url, goal }) {
  const resp = await fetch(target_url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; LifeOSBot/1.0)" } })
  if (!resp.ok) throw new Error(`Fetch failed: ${resp.status} ${resp.statusText}`)
  const html = await resp.text()
  const text = (await extractTextFromHTML(html)).slice(0, 15000) // keep the Gemini prompt reasonable

  const gemini = await getDecryptedCredential(env, userId, "gemini")
  if (!gemini?.token) throw new Error("Gemini not connected")

  const prompt =
    `You're extracting information from a scraped web page for a specific goal.\n\n` +
    `Goal: ${goal}\n\nPage content:\n${text}\n\n` +
    `Respond with a direct, concise answer to the goal. If the page doesn't contain ` +
    `relevant information, say so plainly rather than padding with generic commentary.`
  const geminiResp = await fetch(
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
    {
      method: "POST",
      headers: { "x-goog-api-key": gemini.token, "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
    }
  )
  const data = await geminiResp.json()
  const answer = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "(no response)"
  return { url: target_url, goal, answer, scraped_at: new Date().toISOString() }
}

async function pushScrapeResult(topic, job, result) {
  await fetch(`https://ntfy.sh/${topic}`, {
    method: "POST",
    body: `${result.answer}\n\n(from ${job.target_url})`,
    headers: { Title: `LifeOS research — ${job.goal.slice(0, 60)}`, Priority: "default" },
  })
}

// Called once per user per cron tick alongside reminders/email/digest — a
// periodic watch job rides the same schedule, no separate trigger needed.
async function runDueWatchJobs(env, userId) {
  const nowIso = new Date().toISOString()
  const due = await env.DB.prepare("SELECT * FROM watch_jobs WHERE user_id = ? AND next_run_at <= ?").bind(userId, nowIso).all()
  for (const job of due.results) {
    try {
      const result = await runScrapeJob(env, userId, { target_url: job.target_url, goal: job.goal })
      if (job.frequency === "once") {
        await env.DB.prepare("DELETE FROM watch_jobs WHERE id = ?").bind(job.id).run()
      } else {
        const days = job.frequency === "weekly" ? 7 : 1
        await env.DB.prepare("UPDATE watch_jobs SET last_run_at=?, last_result=?, next_run_at=? WHERE id=?")
          .bind(nowIso, JSON.stringify(result), new Date(Date.now() + days * 86_400_000).toISOString(), job.id)
          .run()
      }
      if (job.notify_via === "ntfy") {
        const ntfy = await getDecryptedCredential(env, userId, "ntfy")
        if (ntfy?.topic) await pushScrapeResult(ntfy.topic, job, result)
      }
    } catch (e) {
      console.error(`watch job ${job.id} failed:`, e.message)
    }
  }
}

// ── Reminder check (ported from daily_check.py, parameterized per user) ──────

function parseOffsetsToDays(s) {
  const days = [];
  const re = /(\d+)\s*(day|week|month)s?/gi;
  let m;
  while ((m = re.exec(s || ""))) {
    const n = parseInt(m[1], 10);
    const unit = m[2].toLowerCase();
    days.push(unit === "day" ? n : unit === "week" ? n * 7 : n * 30);
  }
  return days;
}

async function mondayQuery(token, query, variables) {
  const resp = await fetch("https://api.monday.com/v2", {
    method: "POST",
    headers: { Authorization: token, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  const data = await resp.json();
  if (data.errors) throw new Error(`monday.com error: ${JSON.stringify(data.errors)}`);
  return data.data;
}

async function runReminderCheck(mondayToken, config) {
  const rulesBoard = config["monday.rules_board_id"];
  const deadlinesBoard = config["monday.deadlines_board_id"];
  if (!rulesBoard || !deadlinesBoard) return [];

  const offsetCol = config["monday.rules_offset_col"];
  const typeCol = config["monday.deadlines_type_col"];
  const dueCol = config["monday.deadlines_due_col"];
  const statusCol = config["monday.deadlines_status_col"];

  const rulesData = await mondayQuery(
    mondayToken,
    `query ($b: [ID!]) { boards(ids: $b) { items_page(limit: 50) { items { name column_values { id text } } } } }`,
    { b: [rulesBoard] }
  );
  const rules = {};
  for (const item of rulesData.boards[0].items_page.items) {
    const col = item.column_values.find((c) => c.id === offsetCol);
    rules[item.name] = parseOffsetsToDays(col?.text);
  }

  const deadlinesData = await mondayQuery(
    mondayToken,
    `query ($b: [ID!]) { boards(ids: $b) { items_page(limit: 200) { items { id name column_values { id text } } } } }`,
    { b: [deadlinesBoard] }
  );

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const hits = [];
  for (const item of deadlinesData.boards[0].items_page.items) {
    const cols = Object.fromEntries(item.column_values.map((c) => [c.id, c.text]));
    if (cols[statusCol] === "Done" || !cols[dueCol]) continue;
    const due = new Date(`${cols[dueCol]}T00:00:00Z`);
    const type = cols[typeCol] || "Custom";
    for (const offsetDays of rules[type] || []) {
      const fireDate = new Date(due);
      fireDate.setUTCDate(fireDate.getUTCDate() - offsetDays);
      if (fireDate.getTime() === today.getTime()) {
        const daysLeft = Math.round((due - today) / 86_400_000);
        hits.push({
          title: `${type}: ${item.name}`,
          body: `Due ${daysLeft === 0 ? "today" : `in ${daysLeft} day(s)`} (${cols[dueCol]}).`,
        });
        break;
      }
    }
  }
  return hits;
}

// ── Email triage — Gmail API + Gemini (replaces IMAP + app passwords) ────────
//
// This is a deliberate upgrade over the old daily_check.py: raw IMAP needs a
// TCP client Workers don't ship with, and app passwords don't work at all for
// Workspace/Outlook accounts. Gmail API over the OAuth scope the user already
// granted at login solves both problems and needs no separate credential.

async function runEmailTriage(gmailAccessToken, geminiKey) {
  const sinceEpoch = Math.floor((Date.now() - 3 * 24 * 60 * 60 * 1000) / 1000);
  const listResp = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=after:${sinceEpoch}&maxResults=30`,
    { headers: { Authorization: `Bearer ${gmailAccessToken}` } }
  );
  const list = await listResp.json();
  if (!list.messages) return [];

  const messages = [];
  for (const m of list.messages) {
    const msgResp = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}` +
        `?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`,
      { headers: { Authorization: `Bearer ${gmailAccessToken}` } }
    );
    const msg = await msgResp.json();
    const h = Object.fromEntries((msg.payload?.headers || []).map((x) => [x.name, x.value]));
    messages.push({ from: h.From, subject: h.Subject, date: h.Date, snippet: msg.snippet });
  }

  const prompt =
    `Here are recent emails:\n${JSON.stringify(messages, null, 2)}\n\n` +
    `Flag emails that are clearly important (deadlines, admin/financial, meeting requests, direct asks). ` +
    `Ignore newsletters and routine notifications. Limit to 8 most important. ` +
    `Output ONLY this JSON, nothing else, no markdown fences: ` +
    `{"flagged":[{"from":"","subject":"","why":""}]}`;

  const geminiResp = await fetch(
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
    {
      method: "POST",
      headers: { "x-goog-api-key": geminiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
    }
  );
  const geminiData = await geminiResp.json();
  const raw = geminiData.candidates[0].content.parts[0].text.replace(/^```json\s*|^```\s*|```\s*$/g, "").trim();
  return (JSON.parse(raw).flagged) || [];
}

async function pushDigest(topic, { reminders, flagged }) {
  const sections = [];
  if (reminders.length) sections.push("REMINDERS\n" + reminders.map((r) => `• ${r.title} — ${r.body}`).join("\n"));
  if (flagged.length) sections.push("INBOX\n" + flagged.map((f) => `• ${f.subject} (${f.why})`).join("\n"));
  const body = sections.length ? sections.join("\n\n") : "Nothing urgent today.";
  await fetch(`https://ntfy.sh/${topic}`, {
    method: "POST",
    body,
    headers: {
      Title: `LifeOS — ${new Date().toISOString().slice(0, 10)}`,
      Priority: sections.length ? "default" : "low",
    },
  });
}

async function runForUser(env, userId) {
  const result = { reminders: [], flagged: [], canvas_deadlines: [], errors: [] };

  try {
    const [monday, configRows] = await Promise.all([
      getDecryptedCredential(env, userId, "monday"),
      env.DB.prepare("SELECT key, value FROM user_config WHERE user_id = ?").bind(userId).all(),
    ]);
    const config = Object.fromEntries(configRows.results.map((r) => [r.key, r.value]));
    if (monday?.token) result.reminders = await runReminderCheck(monday.token, config);
  } catch (e) {
    result.errors.push(`reminders: ${e.message}`);
  }

  // ── Canvas deadline alerts — fires ntfy 24h and 1h before due ─────────
  try {
    const canvas = await getDecryptedCredential(env, userId, "canvas");
    if (canvas?.token && canvas?.domain) {
      const now = new Date();
      const in25h = new Date(now.getTime() + 25 * 3600000);
      const upcoming = await fetch(
        `https://${canvas.domain}/api/v1/users/self/upcoming_events?per_page=30`,
        { headers: { Authorization: `Bearer ${canvas.token}` } }
      ).then(r => r.ok ? r.json() : []).catch(() => []);

      for (const ev of upcoming) {
        if (!ev.assignment?.due_at) continue;
        const due = new Date(ev.assignment.due_at);
        if (due > in25h) continue;                          // not soon enough
        if (ev.assignment.has_submitted_submissions) continue; // already done
        const hoursLeft = Math.round((due - now) / 3600000);
        result.canvas_deadlines.push({
          title: ev.title,
          due_at: ev.assignment.due_at,
          hours_left: hoursLeft,
          points: ev.assignment.points_possible,
          url: ev.html_url,
        });
      }

      // Send ntfy for anything due within 25h if ntfy is connected
      if (result.canvas_deadlines.length) {
        const ntfy = await getDecryptedCredential(env, userId, "ntfy");
        if (ntfy?.topic) {
          const lines = result.canvas_deadlines.map(d =>
            `• ${d.title} — due in ${d.hours_left}h${d.points ? ` (${d.points}pts)` : ""}`
          ).join("\n");
          await fetch(`https://ntfy.sh/${ntfy.topic}`, {
            method: "POST",
            body: `Canvas deadlines coming up:\n${lines}`,
            headers: {
              Title: "LifeOS — Canvas deadlines",
              Priority: result.canvas_deadlines.some(d => d.hours_left <= 2) ? "urgent" : "high",
              Tags: "books,alarm_clock",
            },
          }).catch(() => {});
        }
      }
    }
  } catch (e) {
    result.errors.push(`canvas: ${e.message}`);
  }

  try {
    const [gmailToken, gemini] = await Promise.all([
      getValidGoogleAccessToken(env, userId, "gmail"),
      getDecryptedCredential(env, userId, "gemini"),
    ]);
    if (gmailToken && gemini?.token) result.flagged = await runEmailTriage(gmailToken, gemini.token);
  } catch (e) {
    result.errors.push(`email: ${e.message}`);
  }

  try {
    const ntfy = await getDecryptedCredential(env, userId, "ntfy");
    if (ntfy?.topic) await pushDigest(ntfy.topic, result);
  } catch (e) {
    result.errors.push(`digest: ${e.message}`);
  }

  try {
    await runDueWatchJobs(env, userId);
  } catch (e) {
    result.errors.push(`watch jobs: ${e.message}`);
  }

  if (result.errors.length) console.error(`user ${userId}:`, result.errors);
  return result;
}

// ── Generic authenticated proxy to a third-party API ─────────────────────────

async function proxyRequest(request, env, { service, targetBase, stripPrefix, extraHeaders }) {
  const user = await getSessionUser(request, env);
  if (!user) return json(env, { error: "Not authenticated" }, 401);
  const cred = await getDecryptedCredential(env, user.id, service);
  if (!cred) return json(env, { error: `${service} not connected` }, 400);

  const url = new URL(request.url);
  const target = `${targetBase}${url.pathname.replace(stripPrefix, "")}${url.search}`;
  const resp = await fetch(target, {
    method: request.method,
    headers: { ...extraHeaders(cred), "Content-Type": "application/json" },
    body: ["POST", "PATCH", "PUT"].includes(request.method) ? await request.text() : undefined,
  });
  return new Response(await resp.text(), {
    status: resp.status,
    headers: { "Content-Type": "application/json", ...corsHeaders(env) },
  });
}

// ── Rate limiting ─────────────────────────────────────────────────────────────
//
// Google Sign-In means there's no password to brute-force, but the OAuth
// entry points themselves are still worth throttling — unbounded requests to
// /auth/*/start can spam oauth_state rows (storage-exhaustion), and it's
// cheap insurance regardless. A sliding window per client IP, checked once
// before dispatch rather than duplicated in every route.

const RATE_LIMITED_PATHS = new Set([
  "/auth/google/start", "/auth/google/callback",
  "/oauth/notion/start", "/oauth/notion/callback",
  "/oauth/cloudflare/start", "/oauth/cloudflare/callback",
]);
const RATE_LIMIT_MAX = 20;
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000; // 10 minutes

async function checkRateLimit(env, bucketKey, max = RATE_LIMIT_MAX, windowMs = RATE_LIMIT_WINDOW_MS) {
  const now = Date.now();
  const row = await env.DB.prepare("SELECT window_start, count FROM rate_limits WHERE bucket_key = ?").bind(bucketKey).first();
  if (!row) {
    await env.DB.prepare("INSERT INTO rate_limits (bucket_key, window_start, count) VALUES (?, ?, 1)")
      .bind(bucketKey, new Date(now).toISOString())
      .run();
    return true;
  }
  if (now - new Date(row.window_start).getTime() > windowMs) {
    await env.DB.prepare("UPDATE rate_limits SET window_start = ?, count = 1 WHERE bucket_key = ?")
      .bind(new Date(now).toISOString(), bucketKey)
      .run();
    return true;
  }
  if (row.count >= max) return false;
  await env.DB.prepare("UPDATE rate_limits SET count = count + 1 WHERE bucket_key = ?").bind(bucketKey).run();
  return true;
}

// ── Router ────────────────────────────────────────────────────────────────────

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(env) });

    if (RATE_LIMITED_PATHS.has(path)) {
      const ip = request.headers.get("CF-Connecting-IP") || "unknown";
      const allowed = await checkRateLimit(env, `auth:${await sha256Hex(ip)}`);
      if (!allowed) return json(env, { error: "Too many attempts — try again in a few minutes." }, 429);
    }

    // ── Google auth (also the OAuth flow for Calendar/Gmail scopes) ──────────
    if (path === "/auth/google/start") {
      const extra = url.searchParams.get("scopes"); // "calendar" | "gmail" | "calendar,gmail"
      const session = await getSessionUser(request, env);
      if (extra && !session) return json(env, { error: "Log in before connecting extra scopes" }, 401);

      const codeVerifier = randomToken(48);
      const codeChallenge = await sha256Base64Url(codeVerifier);
      const state = randomToken(24);
      const purpose = extra ? `connect:google:${extra}` : "login";

      await env.DB.prepare(
        "INSERT INTO oauth_state (state, purpose, user_id, code_verifier, expires_at) VALUES (?, ?, ?, ?, ?)"
      )
        .bind(state, purpose, session?.id ?? null, codeVerifier, new Date(Date.now() + OAUTH_STATE_TTL_MS).toISOString())
        .run();

      const scopeMap = {
        calendar: "https://www.googleapis.com/auth/calendar",
        gmail: "https://www.googleapis.com/auth/gmail.readonly",
      };
      const scopes = ["openid", "email", "profile", ...(extra || "").split(",").filter(Boolean).map((s) => scopeMap[s]).filter(Boolean)];

      const params = new URLSearchParams({
        client_id: env.GOOGLE_CLIENT_ID,
        redirect_uri: `${env.APP_WORKER_URL}/auth/google/callback`,
        response_type: "code",
        scope: scopes.join(" "),
        state,
        code_challenge: codeChallenge,
        code_challenge_method: "S256",
        access_type: "offline",
        prompt: "consent", // guarantees a refresh_token, including on reconnect
        include_granted_scopes: "true",
      });
      return Response.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`, 302);
    }

    if (path === "/auth/google/callback") {
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");
      if (url.searchParams.get("error")) return Response.redirect(`${env.APP_URL}?error=google_denied`, 302);

      const stateRow = await env.DB.prepare("SELECT * FROM oauth_state WHERE state = ?").bind(state).first();
      if (!stateRow || new Date(stateRow.expires_at) < new Date()) return json(env, { error: "Invalid or expired state" }, 400);
      await env.DB.prepare("DELETE FROM oauth_state WHERE state = ?").bind(state).run();

      const tokenResp = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: env.GOOGLE_CLIENT_ID,
          client_secret: env.GOOGLE_CLIENT_SECRET,
          code,
          code_verifier: stateRow.code_verifier,
          grant_type: "authorization_code",
          redirect_uri: `${env.APP_WORKER_URL}/auth/google/callback`,
        }),
      });
      const tokens = await tokenResp.json();
      if (!tokenResp.ok) return json(env, { error: "Google token exchange failed", detail: tokens }, 400);

      const infoResp = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${tokens.id_token}`);
      const info = await infoResp.json();
      if (!infoResp.ok || info.aud !== env.GOOGLE_CLIENT_ID) return json(env, { error: "id_token verification failed" }, 400);

      let userId = stateRow.user_id;
      if (!userId) {
        const existing = await env.DB.prepare("SELECT id FROM users WHERE google_sub = ?").bind(info.sub).first();
        if (existing) {
          userId = existing.id;
          await env.DB.prepare(
            "UPDATE users SET last_login_at = datetime('now'), name = ?, avatar_url = ?, email = ? WHERE id = ?"
          )
            .bind(info.name || null, info.picture || null, info.email, userId)
            .run();
        } else {
          userId = crypto.randomUUID();
          await env.DB.prepare(
            "INSERT INTO users (id, google_sub, email, name, avatar_url, last_login_at) VALUES (?, ?, ?, ?, ?, datetime('now'))"
          )
            .bind(userId, info.sub, info.email, info.name || null, info.picture || null)
            .run();
        }
      }

      if (stateRow.purpose.startsWith("connect:google:")) {
        const which = stateRow.purpose.split(":")[2].split(",");
        for (const svc of which) {
          const service = svc === "calendar" ? "google_calendar" : "gmail";
          await storeUserCredential(
            env,
            userId,
            service,
            "oauth",
            { access_token: tokens.access_token, refresh_token: tokens.refresh_token },
            { scopes: tokens.scope, expiresAt: new Date(Date.now() + tokens.expires_in * 1000).toISOString() }
          );
        }
      }

      const sessionToken = randomToken(32);
      await env.DB.prepare("INSERT INTO sessions (token_hash, user_id, expires_at, user_agent) VALUES (?, ?, ?, ?)")
        .bind(
          await sha256Hex(sessionToken),
          userId,
          new Date(Date.now() + SESSION_TTL_MS).toISOString(),
          request.headers.get("User-Agent") || ""
        )
        .run();

      const headers = new Headers({ Location: env.APP_URL });
      headers.append(
        "Set-Cookie",
        `${SESSION_COOKIE}=${sessionToken}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_TTL_MS / 1000}`
      );
      return new Response(null, { status: 302, headers });
    }

    if (path === "/auth/logout" && request.method === "POST") {
      const token = getCookie(request, SESSION_COOKIE);
      if (token) await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await sha256Hex(token)).run();
      const headers = new Headers({ "Content-Type": "application/json", ...corsHeaders(env) });
      headers.append("Set-Cookie", `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`);
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
    }

    // ── Account deletion — the privacy policy promises this, so it exists.
    // One row delete: every other table references users(id) with ON DELETE
    // CASCADE, so sessions, credentials, config, watch jobs, upload formats/
    // jobs, and reminder rules all go with it, in one transaction. Note for
    // provisioned users: their real data lives in THEIR OWN Cloudflare
    // account — deleting here removes everything the orchestrator holds;
    // their own Worker + D1 they delete from their own dashboard (it's
    // theirs, we genuinely cannot reach into it, which is the whole point).
    if (path === "/api/account" && request.method === "DELETE") {
      const user = await getSessionUser(request, env);
      if (!user) return json(env, { error: "Not authenticated" }, 401);
      await env.DB.prepare("DELETE FROM users WHERE id = ?").bind(user.id).run();
      const headers = new Headers({ "Content-Type": "application/json", ...corsHeaders(env) });
      headers.append("Set-Cookie", `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`);
      return new Response(JSON.stringify({ ok: true, deleted: true }), { status: 200, headers });
    }

    if (path === "/api/me") {
      const user = await getSessionUser(request, env);
      if (!user) return json(env, { error: "Not authenticated" }, 401);

      const deployment = await env.DB.prepare(
        "SELECT value FROM user_config WHERE user_id = ? AND key = 'deployment.worker_url'"
      )
        .bind(user.id)
        .first();
      let deploymentInfo = null;
      if (deployment?.value) {
        const relay = await getDecryptedCredential(env, user.id, "_relay");
        if (relay?.secret) {
          deploymentInfo = { worker_url: deployment.value, relay_token: await mintRelayToken(relay.secret, user.id) };
        }
      }
      return json(env, { user, deployment: deploymentInfo });
    }

    // ── Mandatory bring-your-own-Cloudflare ──────────────────────────────────
    // Every user runs on their OWN infrastructure. The orchestrator only
    // handles sign-in, connecting Cloudflare, and provisioning — every
    // feature route requires a personal deployment. (Personal deployments
    // carry INTERNAL_RELAY_SECRET and skip this check entirely — they ARE
    // the user's own infrastructure.)
    // OPERATOR_MODE bypasses this gate for the operator — set via
    // wrangler secret put OPERATOR_MODE (value: true). Lets the app owner
    // use the app without a separate Cloudflare OAuth app registered.
    const operatorMode = env.OPERATOR_MODE === "true";
    if (!operatorMode && !env.INTERNAL_RELAY_SECRET && (path.startsWith("/api/") || path.startsWith("/proxy/"))) {
      const BYOC_EXEMPT =
        path === "/api/me" || path === "/api/provision" || path === "/api/account" ||
        (path === "/api/credentials" && request.method === "GET") ||
        path === "/api/credentials/cloudflare";
      if (!BYOC_EXEMPT) {
        const gateUser = await getSessionUser(request, env);
        if (gateUser) {
          const dep = await env.DB.prepare(
            "SELECT value FROM user_config WHERE user_id = ? AND key = 'deployment.worker_url'"
          ).bind(gateUser.id).first();
          if (!dep?.value) {
            return json(env, {
              error: "LifeOS runs entirely on your own Cloudflare account — connect Cloudflare and deploy your backend in Settings first.",
              code: "byoc_required",
            }, 403);
          }
        }
      }
    }

    // ── Credential vault (API-key style services) ─────────────────────────────
    if (path === "/api/credentials" && request.method === "GET") {
      const user = await getSessionUser(request, env);
      if (!user) return json(env, { error: "Not authenticated" }, 401);
      const rows = await env.DB.prepare(
        "SELECT service, auth_type, scopes, expires_at, updated_at FROM credentials WHERE user_id = ?"
      )
        .bind(user.id)
        .all();
      return json(env, { credentials: rows.results });
    }

    const credMatch = path.match(/^\/api\/credentials\/([a-z_]+)$/);
    if (credMatch) {
      const service = credMatch[1];
      if (!API_KEY_SERVICES.has(service)) return json(env, { error: "Unknown or OAuth-only service" }, 400);
      const user = await getSessionUser(request, env);
      if (!user) return json(env, { error: "Not authenticated" }, 401);

      if (request.method === "POST") {
        const body = await request.json(); // canvas: {token, domain} · monday/gemini: {token} · ntfy: {topic}
        await storeUserCredential(env, user.id, service, "api_key", body);
        return json(env, { ok: true });
      }
      if (request.method === "DELETE") {
        const deployment = await env.DB.prepare(
          "SELECT value FROM user_config WHERE user_id = ? AND key = 'deployment.worker_url'"
        )
          .bind(user.id)
          .first();
        if (deployment?.value) {
          const relay = await getDecryptedCredential(env, user.id, "_relay");
          if (relay?.secret) {
            await fetch(`${deployment.value}/api/credentials/${service}`, {
              method: "DELETE",
              headers: { Authorization: `Bearer ${await mintRelayToken(relay.secret, user.id)}` },
            }).catch((e) => console.error("relay delete failed:", e.message));
          }
        }
        await env.DB.prepare("DELETE FROM credentials WHERE user_id = ? AND service = ?").bind(user.id, service).run();
        return json(env, { ok: true });
      }
    }

    // ── Notion OAuth ───────────────────────────────────────────────────────────
    if (path === "/oauth/notion/start") {
      const user = await getSessionUser(request, env);
      if (!user) return json(env, { error: "Not authenticated" }, 401);
      const state = randomToken(24);
      await env.DB.prepare("INSERT INTO oauth_state (state, purpose, user_id, expires_at) VALUES (?, 'connect:notion', ?, ?)")
        .bind(state, user.id, new Date(Date.now() + OAUTH_STATE_TTL_MS).toISOString())
        .run();
      const params = new URLSearchParams({
        client_id: env.NOTION_CLIENT_ID,
        redirect_uri: `${env.APP_WORKER_URL}/oauth/notion/callback`,
        response_type: "code",
        owner: "user",
        state,
      });
      return Response.redirect(`https://api.notion.com/v1/oauth/authorize?${params}`, 302);
    }

    if (path === "/oauth/notion/callback") {
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");
      const stateRow = await env.DB.prepare("SELECT * FROM oauth_state WHERE state = ?").bind(state).first();
      if (!stateRow) return json(env, { error: "Invalid state" }, 400);
      await env.DB.prepare("DELETE FROM oauth_state WHERE state = ?").bind(state).run();

      const resp = await fetch("https://api.notion.com/v1/oauth/token", {
        method: "POST",
        headers: {
          Authorization: `Basic ${btoa(`${env.NOTION_CLIENT_ID}:${env.NOTION_CLIENT_SECRET}`)}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ grant_type: "authorization_code", code, redirect_uri: `${env.APP_WORKER_URL}/oauth/notion/callback` }),
      });
      const tokens = await resp.json();
      if (!resp.ok) return json(env, { error: "Notion token exchange failed", detail: tokens }, 400);

      await storeUserCredential(env, stateRow.user_id, "notion", "oauth", {
        access_token: tokens.access_token,
        workspace_name: tokens.workspace_name,
      });
      return Response.redirect(`${env.APP_URL}?connected=notion`, 302);
    }

    // ── Cloudflare OAuth — bootstraps bring-your-own-account provisioning ─────
    // Orchestrator only. Uses Cloudflare's self-managed OAuth (the same
    // mechanism `wrangler login` has always used internally, opened to all
    // developers in June 2026) — register a client under Manage Account →
    // OAuth clients. See SETUP.md for the scopes to select.
    if (path === "/oauth/cloudflare/start") {
      const user = await getSessionUser(request, env);
      if (!user) return json(env, { error: "Not authenticated" }, 401);

      const codeVerifier = randomToken(48);
      const codeChallenge = await sha256Base64Url(codeVerifier);
      const state = randomToken(24);
      await env.DB.prepare(
        "INSERT INTO oauth_state (state, purpose, user_id, code_verifier, expires_at) VALUES (?, 'connect:cloudflare', ?, ?, ?)"
      )
        .bind(state, user.id, codeVerifier, new Date(Date.now() + OAUTH_STATE_TTL_MS).toISOString())
        .run();

      const params = new URLSearchParams({
        client_id: env.CLOUDFLARE_CLIENT_ID,
        redirect_uri: `${env.APP_WORKER_URL}/oauth/cloudflare/callback`,
        response_type: "code",
        state,
        code_challenge: codeChallenge,
        code_challenge_method: "S256",
        // Exact scope names shown when you create the OAuth client mirror
        // API token permission groups — select at minimum: Account Settings
        // Read, D1 Edit, Workers Scripts Edit. Verify the literal strings in
        // your own client's config rather than trust this comment blindly.
        scope: env.CLOUDFLARE_OAUTH_SCOPES || "account:read d1:edit workers_scripts:edit",
      });
      return Response.redirect(`${CLOUDFLARE_AUTHORIZE_URL}?${params}`, 302);
    }

    if (path === "/oauth/cloudflare/callback") {
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");
      if (url.searchParams.get("error")) return Response.redirect(`${env.APP_URL}?error=cloudflare_denied`, 302);

      const stateRow = await env.DB.prepare("SELECT * FROM oauth_state WHERE state = ?").bind(state).first();
      if (!stateRow || new Date(stateRow.expires_at) < new Date()) return json(env, { error: "Invalid or expired state" }, 400);
      await env.DB.prepare("DELETE FROM oauth_state WHERE state = ?").bind(state).run();

      const tokenResp = await fetch(CLOUDFLARE_TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: env.CLOUDFLARE_CLIENT_ID,
          client_secret: env.CLOUDFLARE_CLIENT_SECRET,
          code,
          code_verifier: stateRow.code_verifier,
          grant_type: "authorization_code",
          redirect_uri: `${env.APP_WORKER_URL}/oauth/cloudflare/callback`,
        }),
      });
      const tokens = await tokenResp.json();
      if (!tokenResp.ok) return json(env, { error: "Cloudflare token exchange failed", detail: tokens }, 400);

      // Discover which account(s) this grant covers — the consent screen is
      // where the user actually picks the account; we just read the result.
      const accounts = await cf(tokens.access_token, "/accounts");
      const accountId = accounts[0]?.id;

      await upsertCredential(
        env,
        stateRow.user_id,
        "cloudflare",
        "oauth",
        { access_token: tokens.access_token, refresh_token: tokens.refresh_token, account_id: accountId },
        { expiresAt: new Date(Date.now() + tokens.expires_in * 1000).toISOString() }
      );
      return Response.redirect(`${env.APP_URL}?connected=cloudflare`, 302);
    }

    // ── Provisioning — deploy this user's own LifeOS backend ─────────────────
    if (path === "/api/provision") {
      const user = await getSessionUser(request, env);
      if (!user) return json(env, { error: "Not authenticated" }, 401);

      if (request.method === "GET") {
        const rows = await env.DB.prepare("SELECT key, value FROM user_config WHERE user_id = ? AND key LIKE 'deployment.%'")
          .bind(user.id)
          .all();
        return json(env, { deployment: Object.fromEntries(rows.results.map((r) => [r.key.replace("deployment.", ""), r.value])) });
      }

      if (request.method === "POST") {
        if (!(await checkRateLimit(env, `provision:${user.id}`, 3, 60 * 60 * 1000))) {
          return json(env, { error: "Too many provisioning attempts — try again in an hour." }, 429);
        }
        try {
          const result = await provisionUserWorker(env, user.id, user);
          return json(env, { ok: true, ...result });
        } catch (e) {
          console.error(`provisioning failed for ${user.id}:`, e.message);
          return json(env, { error: "Provisioning failed", detail: e.message }, 500);
        }
      }
    }

    // ── Internal relay target — personal deployments only ────────────────────
    // The orchestrator calls this right after any OAuth grant completes, so
    // the resulting credential ends up in this user's own vault, not the
    // orchestrator's. Authenticated with the same shared secret set at
    // provision time — never exposed to the browser.
    if (path === "/internal/receive-credential" && request.method === "POST") {
      if (!env.INTERNAL_RELAY_SECRET) return json(env, { error: "Not a personal deployment" }, 400);
      const auth = request.headers.get("Authorization") || "";
      const bearer = auth.startsWith("Bearer ") ? auth.slice(7) : "";
      if (!(await constantTimeEqual(bearer, env.INTERNAL_RELAY_SECRET))) return json(env, { error: "Unauthorized" }, 401);
      const { userId, service, authType, payload, extra } = await request.json();
      await upsertCredential(env, userId, service, authType, payload, extra || {});
      return json(env, { ok: true });
    }

    // ── Web scraping / research agent ─────────────────────────────────────────
    // ── Gemini proxy — lets the dashboard's command bar / AI features work
    // without ever holding the raw key client-side, same principle as the
    // Notion/Canvas/monday proxies below.
    // ── Uploader — formats (reusable presets) + a durable job queue ──────────
    // The queue lives server-side in D1, so closing the app never loses
    // queued uploads. HONEST STATUS: actual publishing to TikTok/Instagram/
    // YouTube requires each platform's app-review process before publish
    // scopes are granted (weeks, per platform). Until those OAuth apps are
    // approved and wired in, jobs queue durably and report
    // "waiting_platform_auth" rather than pretending to post.
    if (path === "/api/uploader/formats") {
      const user = await getSessionUser(request, env);
      if (!user) return json(env, { error: "Not authenticated" }, 401);
      if (request.method === "GET") {
        const rows = await env.DB.prepare("SELECT * FROM upload_formats WHERE user_id = ? ORDER BY created_at DESC").bind(user.id).all();
        return json(env, { formats: rows.results });
      }
      if (request.method === "POST") {
        const f = await request.json();
        if (!f.name || !f.source_folder || !f.platforms?.length) return json(env, { error: "name, source_folder, and platforms are required" }, 400);
        const id = crypto.randomUUID();
        await env.DB.prepare(
          `INSERT INTO upload_formats (id, user_id, name, source_folder, pick_count, selection, caption_template, hashtags, platforms, schedule)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(id, user.id, f.name, f.source_folder, f.pick_count||1, f.selection||"random", f.caption_template||null, f.hashtags||null, JSON.stringify(f.platforms), f.schedule||null).run();
        return json(env, { ok: true, id });
      }
    }
    const fmtMatch = path.match(/^\/api\/uploader\/formats\/([a-zA-Z0-9-]+)$/);
    if (fmtMatch && request.method === "DELETE") {
      const user = await getSessionUser(request, env);
      if (!user) return json(env, { error: "Not authenticated" }, 401);
      await env.DB.prepare("DELETE FROM upload_formats WHERE id = ? AND user_id = ?").bind(fmtMatch[1], user.id).run();
      return json(env, { ok: true });
    }

    if (path === "/api/uploader/jobs") {
      const user = await getSessionUser(request, env);
      if (!user) return json(env, { error: "Not authenticated" }, 401);
      if (request.method === "GET") {
        const rows = await env.DB.prepare("SELECT * FROM upload_jobs WHERE user_id = ? ORDER BY created_at DESC LIMIT 50").bind(user.id).all();
        return json(env, { jobs: rows.results.map(r=>({ ...r, payload: JSON.parse(r.payload) })) });
      }
      if (request.method === "POST") {
        // One request can queue a batch: one job per platform entry.
        const { platforms, payload, format_id } = await request.json();
        if (!platforms?.length || !payload) return json(env, { error: "platforms and payload are required" }, 400);
        const ids = [];
        for (const p of platforms) {
          const id = crypto.randomUUID();
          // No platform OAuth wired yet → waiting_platform_auth, honestly.
          await env.DB.prepare(
            "INSERT INTO upload_jobs (id, user_id, format_id, platform, account, payload, status) VALUES (?, ?, ?, ?, ?, ?, 'waiting_platform_auth')"
          ).bind(id, user.id, format_id||null, p.platform, p.account||null, JSON.stringify({ ...payload, settings: p.settings||{} })).run();
          ids.push(id);
        }
        return json(env, { ok: true, ids, note: "Queued durably. Publishing activates once platform OAuth apps are approved and connected." });
      }
    }
    const jobMatch = path.match(/^\/api\/uploader\/jobs\/([a-zA-Z0-9-]+)$/);
    if (jobMatch && request.method === "DELETE") {
      const user = await getSessionUser(request, env);
      if (!user) return json(env, { error: "Not authenticated" }, 401);
      await env.DB.prepare("DELETE FROM upload_jobs WHERE id = ? AND user_id = ?").bind(jobMatch[1], user.id).run();
      return json(env, { ok: true });
    }

    // ── Zapier NLA proxy ─────────────────────────────────────────────────────
    // The user's NLA key lives in the encrypted vault (stored as the "zapier"
    // credential's token field). The Worker calls nla.zapier.com on their
    // behalf — the key never touches the browser.
    if (path === "/api/zapier/actions" && request.method === "GET") {
      const user = await getSessionUser(request, env);
      if (!user) return json(env, { error: "Not authenticated" }, 401);
      const cred = await env.DB.prepare(
        "SELECT value FROM credentials WHERE user_id = ? AND service = 'zapier'"
      ).bind(user.id).first();
      if (!cred) return json(env, { error: "Zapier not connected" }, 400);
      const { token } = JSON.parse(await decryptVault(env, cred.value));
      const r = await fetch("https://nla.zapier.com/api/v1/exposed/", {
        headers: { "X-API-KEY": token, "Content-Type": "application/json" }
      });
      if (!r.ok) return json(env, { error: `Zapier ${r.status}` }, 502);
      const data = await r.json();
      // Return only social-media-relevant actions to keep the list clean
      const SOCIAL_KEYWORDS = ["tiktok","instagram","youtube","soundcloud","twitter","linkedin","facebook","post","upload","video","publish"];
      const actions = (data.results || []).filter(a =>
        SOCIAL_KEYWORDS.some(k => (a.description||"").toLowerCase().includes(k) || (a.display_name||"").toLowerCase().includes(k))
      );
      return json(env, { actions: actions.length ? actions : data.results || [] });
    }

    if (path === "/api/zapier/execute" && request.method === "POST") {
      const user = await getSessionUser(request, env);
      if (!user) return json(env, { error: "Not authenticated" }, 401);
      const cred = await env.DB.prepare(
        "SELECT value FROM credentials WHERE user_id = ? AND service = 'zapier'"
      ).bind(user.id).first();
      if (!cred) return json(env, { error: "Zapier not connected" }, 400);
      const { token } = JSON.parse(await decryptVault(env, cred.value));
      const { action_id, instructions, params } = await request.json();
      if (!action_id || !instructions) return json(env, { error: "action_id and instructions required" }, 400);
      const r = await fetch(`https://nla.zapier.com/api/v1/exposed/${action_id}/execute/`, {
        method: "POST",
        headers: { "X-API-KEY": token, "Content-Type": "application/json" },
        body: JSON.stringify({ instructions, ...(params && { params }) })
      });
      const result = await r.json();
      if (!r.ok) return json(env, { error: result?.detail || `Zapier ${r.status}` }, 502);
      return json(env, { ok: true, result });
    }

    // ── Uploader job drain — called by cron and by the queue-now button.
    // For each queued job that has a zapier_action_id, fires it through the
    // NLA proxy above. Jobs without one stay in the queue unchanged (waiting
    // for the user to map a platform → action in the Uploader settings).
    if (path === "/api/uploader/drain" && request.method === "POST") {
      const user = await getSessionUser(request, env);
      if (!user) return json(env, { error: "Not authenticated" }, 401);
      const cred = await env.DB.prepare(
        "SELECT value FROM credentials WHERE user_id = ? AND service = 'zapier'"
      ).bind(user.id).first();
      if (!cred) return json(env, { error: "Connect Zapier first" }, 400);
      const { token } = JSON.parse(await decryptVault(env, cred.value));
      const jobs = await env.DB.prepare(
        "SELECT * FROM upload_jobs WHERE user_id = ? AND status IN ('queued','waiting_platform_auth') AND zapier_action_id IS NOT NULL LIMIT 10"
      ).bind(user.id).all();
      const results = [];
      for (const job of jobs.results) {
        await env.DB.prepare("UPDATE upload_jobs SET status = 'uploading' WHERE id = ?").bind(job.id).run();
        try {
          const payload = JSON.parse(job.payload);
          const instructions = `Post to ${job.platform}: folder "${payload.folder}"${payload.caption?`, caption: "${payload.caption}"`:""}${payload.tags?`, tags: ${payload.tags}`:""}. Do not compress the file.`;
          const r = await fetch(`https://nla.zapier.com/api/v1/exposed/${job.zapier_action_id}/execute/`, {
            method: "POST",
            headers: { "X-API-KEY": token, "Content-Type": "application/json" },
            body: JSON.stringify({ instructions })
          });
          const res = await r.json();
          if (r.ok) {
            await env.DB.prepare("UPDATE upload_jobs SET status='done', completed_at=datetime('now') WHERE id=?").bind(job.id).run();
            results.push({ id: job.id, ok: true });
          } else {
            await env.DB.prepare("UPDATE upload_jobs SET status='failed', error=? WHERE id=?").bind(res.detail||`Zapier ${r.status}`, job.id).run();
            results.push({ id: job.id, ok: false, error: res.detail });
          }
        } catch (e) {
          await env.DB.prepare("UPDATE upload_jobs SET status='failed', error=? WHERE id=?").bind(e.message, job.id).run();
          results.push({ id: job.id, ok: false, error: e.message });
        }
      }
      return json(env, { ok: true, drained: results.length, results });
    }

    // ── Digest data — reuses the same reminder-check/email-triage logic the
    // Cron Trigger runs, just returned as structured JSON on demand instead
    // of pushed to ntfy. Keeps one source of truth for both.
    if (path === "/api/digest" && request.method === "GET") {
      const user = await getSessionUser(request, env);
      if (!user) return json(env, { error: "Not authenticated" }, 401);
      if (!(await checkRateLimit(env, `digest:${user.id}`, 10, 10 * 60 * 1000))) {
        return json(env, { error: "Too many requests — try again shortly." }, 429);
      }
      const result = { reminders: [], flagged: [] };
      try {
        const [monday, configRows] = await Promise.all([
          getDecryptedCredential(env, user.id, "monday"),
          env.DB.prepare("SELECT key, value FROM user_config WHERE user_id = ?").bind(user.id).all(),
        ]);
        const config = Object.fromEntries(configRows.results.map((r) => [r.key, r.value]));
        if (monday?.token) result.reminders = await runReminderCheck(monday.token, config);
      } catch (e) { console.error(`digest reminders for ${user.id}:`, e.message); }
      try {
        const [gmailToken, gemini] = await Promise.all([
          getValidGoogleAccessToken(env, user.id, "gmail"),
          getDecryptedCredential(env, user.id, "gemini"),
        ]);
        if (gmailToken && gemini?.token) result.flagged = await runEmailTriage(gmailToken, gemini.token);
      } catch (e) { console.error(`digest email triage for ${user.id}:`, e.message); }
      return json(env, result);
    }

    if (path === "/api/gemini" && request.method === "POST") {
      const user = await getSessionUser(request, env);
      if (!user) return json(env, { error: "Not authenticated" }, 401);
      const gemini = await getDecryptedCredential(env, user.id, "gemini");
      if (!gemini?.token) return json(env, { error: "Gemini not connected" }, 400);
      const { system, user: userText } = await request.json();
      const geminiResp = await fetch(
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
        {
          method: "POST",
          headers: { "x-goog-api-key": gemini.token, "Content-Type": "application/json" },
          body: JSON.stringify({
            system_instruction: system ? { parts: [{ text: system }] } : undefined,
            contents: [{ parts: [{ text: userText || "" }] }],
          }),
        }
      );
      const data = await geminiResp.json();
      if (!geminiResp.ok) return json(env, { error: data?.error?.message || `Gemini ${geminiResp.status}` }, 502);
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
      return json(env, { text });
    }

    if (path === "/api/scrape" && request.method === "POST") {
      const user = await getSessionUser(request, env);
      if (!user) return json(env, { error: "Not authenticated" }, 401);
      if (!(await checkRateLimit(env, `scrape:${user.id}`, 30, 10 * 60 * 1000))) {
        return json(env, { error: "Too many scrape requests — try again shortly." }, 429);
      }
      const { url, goal } = await request.json();
      if (!url || !goal) return json(env, { error: "url and goal are both required" }, 400);
      try {
        const result = await runScrapeJob(env, user.id, { target_url: url, goal });
        return json(env, { ok: true, result });
      } catch (e) {
        return json(env, { error: "Scrape failed", detail: e.message }, 500);
      }
    }

    if (path === "/api/watch") {
      const user = await getSessionUser(request, env);
      if (!user) return json(env, { error: "Not authenticated" }, 401);

      if (request.method === "GET") {
        const rows = await env.DB.prepare("SELECT * FROM watch_jobs WHERE user_id = ? ORDER BY created_at DESC").bind(user.id).all();
        return json(env, { jobs: rows.results.map((r) => ({ ...r, last_result: r.last_result ? JSON.parse(r.last_result) : null })) });
      }
      if (request.method === "POST") {
        const { url, goal, frequency, notify_via } = await request.json();
        if (!url || !goal) return json(env, { error: "url and goal are both required" }, 400);
        const existing = await env.DB.prepare("SELECT COUNT(*) as n FROM watch_jobs WHERE user_id = ?").bind(user.id).first();
        if (existing.n >= 20) return json(env, { error: "Limit of 20 active watch jobs reached — delete one first." }, 400);
        const freq = ["once", "daily", "weekly"].includes(frequency) ? frequency : "once";
        const id = crypto.randomUUID();
        // Runs immediately on creation (instant feedback), then falls onto its
        // own cadence from there via the shared Cron Trigger.
        await env.DB.prepare(
          `INSERT INTO watch_jobs (id, user_id, target_url, goal, frequency, notify_via, next_run_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
          .bind(id, user.id, url, goal, freq, notify_via === "dashboard" ? "dashboard" : "ntfy", new Date().toISOString())
          .run();
        return json(env, { ok: true, id });
      }
    }

    const watchMatch = path.match(/^\/api\/watch\/([a-zA-Z0-9_-]+)$/);
    if (watchMatch && request.method === "DELETE") {
      const user = await getSessionUser(request, env);
      if (!user) return json(env, { error: "Not authenticated" }, 401);
      await env.DB.prepare("DELETE FROM watch_jobs WHERE id = ? AND user_id = ?").bind(watchMatch[1], user.id).run();
      return json(env, { ok: true });
    }

    // ── Per-user config (non-secret pointers: database ids, board ids...) ────
    if (path === "/api/config") {
      const user = await getSessionUser(request, env);
      if (!user) return json(env, { error: "Not authenticated" }, 401);

      if (request.method === "GET") {
        const rows = await env.DB.prepare("SELECT key, value FROM user_config WHERE user_id = ?").bind(user.id).all();
        return json(env, { config: Object.fromEntries(rows.results.map((r) => [r.key, r.value])) });
      }
      if (request.method === "PUT") {
        const body = await request.json();
        const stmt = env.DB.prepare(
          `INSERT INTO user_config (user_id, key, value) VALUES (?, ?, ?)
           ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value`
        );
        await env.DB.batch(Object.entries(body).map(([k, v]) => stmt.bind(user.id, k, String(v))));
        return json(env, { ok: true });
      }
    }

    // ── Data proxies ───────────────────────────────────────────────────────────
    if (path.startsWith("/proxy/notion/")) {
      return proxyRequest(request, env, {
        service: "notion",
        targetBase: "https://api.notion.com",
        stripPrefix: "/proxy/notion",
        extraHeaders: (cred) => ({ Authorization: `Bearer ${cred.access_token}`, "Notion-Version": "2022-06-28" }),
      });
    }

    if (path.startsWith("/proxy/canvas/")) {
      const user = await getSessionUser(request, env);
      if (!user) return json(env, { error: "Not authenticated" }, 401);
      const cred = await getDecryptedCredential(env, user.id, "canvas");
      if (!cred) return json(env, { error: "Canvas not connected" }, 400);
      const target = `https://${cred.domain}${path.replace("/proxy/canvas", "")}${url.search}`;
      const resp = await fetch(target, {
        method: request.method,
        headers: { Authorization: `Bearer ${cred.token}`, "Content-Type": "application/json" },
        body: ["POST", "PATCH", "PUT"].includes(request.method) ? await request.text() : undefined,
      });
      return new Response(await resp.text(), { status: resp.status, headers: { "Content-Type": "application/json", ...corsHeaders(env) } });
    }

    // ── Canvas aggregator — hits all useful endpoints in parallel so the
    // frontend never has to make 4 sequential calls. Returns a clean
    // structured summary: courses, upcoming assignments (14 days), todo
    // (unsubmitted), and recent announcements.
    if (path === "/api/canvas/summary" && request.method === "GET") {
      const user = await getSessionUser(request, env);
      if (!user) return json(env, { error: "Not authenticated" }, 401);
      const cred = await getDecryptedCredential(env, user.id, "canvas");
      if (!cred) return json(env, { error: "Canvas not connected" }, 400);

      const canvasFetch = (endpoint) =>
        fetch(`https://${cred.domain}/api/v1${endpoint}`, {
          headers: { Authorization: `Bearer ${cred.token}` }
        }).then(r => r.ok ? r.json() : []).catch(() => []);

      const [courses, upcoming, todo, announcements] = await Promise.all([
        canvasFetch("/courses?enrollment_state=active&per_page=20&include[]=total_scores"),
        canvasFetch("/users/self/upcoming_events?per_page=30"),
        canvasFetch("/users/self/todo?per_page=50"),
        canvasFetch("/announcements?per_page=10&active_only=true"),
      ]);

      // Normalise upcoming events — Canvas mixes assignments and calendar
      // events; we only care about assignments with due dates here
      const now = new Date();
      const in14 = new Date(now.getTime() + 14 * 86400000);
      const deadlines = upcoming
        .filter(e => e.assignment && e.assignment.due_at)
        .map(e => ({
          id:         e.assignment.id,
          title:      e.title,
          course_id:  e.course_id,
          course_name:courses.find(c => c.id === e.course_id)?.name || "Unknown course",
          due_at:     e.assignment.due_at,
          points:     e.assignment.points_possible,
          html_url:   e.html_url,
          submitted:  e.assignment.has_submitted_submissions,
          days_until: Math.ceil((new Date(e.assignment.due_at) - now) / 86400000),
        }))
        .filter(d => new Date(d.due_at) <= in14)
        .sort((a, b) => new Date(a.due_at) - new Date(b.due_at));

      const todoItems = todo.map(t => ({
        id:          t.assignment?.id,
        title:       t.assignment?.name || t.type,
        course_id:   t.course_id,
        course_name: courses.find(c => c.id === t.course_id)?.name || "Unknown course",
        due_at:      t.assignment?.due_at,
        points:      t.assignment?.points_possible,
        html_url:    t.html_url,
      }));

      const cleanCourses = courses.map(c => ({
        id:    c.id,
        name:  c.name,
        code:  c.course_code,
        score: c.enrollments?.[0]?.computed_current_score ?? null,
        grade: c.enrollments?.[0]?.computed_current_grade ?? null,
      }));

      const cleanAnnouncements = announcements.slice(0, 6).map(a => ({
        id:         a.id,
        title:      a.title,
        course_id:  a.course_id,
        course_name:courses.find(c => c.id === a.course_id)?.name || "Unknown course",
        posted_at:  a.posted_at,
        html_url:   a.html_url,
      }));

      return json(env, { courses: cleanCourses, deadlines, todo: todoItems, announcements: cleanAnnouncements });
    }


    if (path === "/proxy/monday" && request.method === "POST") {
      const user = await getSessionUser(request, env);
      if (!user) return json(env, { error: "Not authenticated" }, 401);
      const cred = await getDecryptedCredential(env, user.id, "monday");
      if (!cred) return json(env, { error: "monday.com not connected" }, 400);
      const resp = await fetch("https://api.monday.com/v2", {
        method: "POST",
        headers: { Authorization: cred.token, "Content-Type": "application/json" },
        body: await request.text(),
      });
      return new Response(await resp.text(), { status: resp.status, headers: { "Content-Type": "application/json", ...corsHeaders(env) } });
    }

    return json(env, { error: `Unknown route: ${path}` }, 404);
  },

  // Cron Trigger — configure schedules in wrangler.toml, not here.
  // On the orchestrator, this only runs for users who haven't provisioned
  // their own Cloudflare deployment yet — once they have, their own copy of
  // this same function (running on their own account) takes over entirely.
  async scheduled(event, env, ctx) {
    const users = await env.DB.prepare(
      `SELECT u.id FROM users u
       LEFT JOIN user_config c ON c.user_id = u.id AND c.key = 'deployment.worker_url'
       WHERE c.value IS NULL`
    ).all();
    for (const u of users.results) {
      ctx.waitUntil(runForUser(env, u.id));
    }
  },
};
