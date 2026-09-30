# Prompt: in-app authentication (email + password, DB sessions)

Drafted 2026-09-30. Paste the fenced block below into a fresh agent session.

**Decisions already made:** scrypt (Node built-in) hashing; DB-backed sessions with a 30-day sliding
expiry; email as the login identifier; users created by CLI (no signup); the prod manifests change is
included (but nothing is applied to the cluster).

**Defaults I chose without asking. Edit the prompt if you disagree**

- Password policy: minimum 12 characters, maximum 128, no composition rules.
- Login throttle: 5 failures per account and 20 per IP per 15 minutes, in memory.
- Sessions refresh `expires_at` at most once an hour, so reads don't write on every request.
- scrypt cost N=2^15, r=8, p=1, encoded with its parameters so they can be raised later.
- CSRF: SameSite=Lax cookie plus an Origin / `Sec-Fetch-Site` check on non-GET requests.
- `AUTH_REQUIRED` defaults to **off** so local dev and the existing tests are unchanged. Production
  turns it on.
- The web app gets a login page, a user menu (change password, sign out) and a change-password page.
- No MFA, roles, signup, email reset, or OIDC in this change.

```
Implement in-app authentication for flight-log: email + password login with database-backed
sessions. Read AGENTS.md, apps/api/AGENTS.md, apps/web/AGENTS.md and docs/data-model.md first.
State your plan (files you will touch, in order) before coding, then work in small logical
commits.

CONTEXT
- Today every request acts as DEFAULT_USER_ID via apps/api/src/http/resolveUser.ts, mounted with
  app.use('/api', resolveUser) after /api/health. Every user-owned query already goes through
  apps/api/src/dal/* with userId first, so auth only changes HOW req.userId is set. resolveUser must
  stay the only place that sets it (root AGENTS.md invariant 1).
- users table: id, email (nullable, unique), display_name, created_at. The existing flights belong to
  the seeded default user; they must stay that user's.
- Production runs behind Traefik at https://flights.wyattmunson.com and is currently gated by HTTP
  basic auth (deploy/k8s/apps/flight-log/ingress.yaml). This work replaces that.

DECISIONS (do not relitigate)
- Hash passwords with Node's built-in crypto.scrypt (async, not scryptSync, so the event loop is not
  blocked). N=2^15, r=8, p=1, 16-byte random salt, 64-byte key. N=2^15 needs a maxmem option above
  the 32 MB default. Encode as one string "scrypt$N$r$p$saltB64$hashB64" so parameters can be raised
  later, and compare with timingSafeEqual. No new npm dependencies (root AGENTS.md invariant 11).
- Sessions live in the database. Cookie holds a random 32-byte token (base64url); store only its
  SHA-256 hex. Sliding expiry of 30 days; refresh expires_at/last_seen_at only if the last refresh was
  more than 1 hour ago.
- Login identifier is email, lower-cased and trimmed on write and on lookup. No signup endpoint.
- Password policy: 12 to 128 characters, no composition rules, must not equal the email.

DATABASE (apps/api)
1. schema.prisma: add users.password_hash (text, nullable) and a Session model mapped to "sessions":
   id uuid pk, user_id fk (ON DELETE CASCADE), token_hash text unique, created_at, last_seen_at,
   expires_at (timestamptz). Index user_id and expires_at.
2. Migration with --create-only, remove the DROP INDEX lines for the hand-written indexes (see the
   root AGENTS.md Prisma gotcha), apply with npm run db:migrate.
3. Update docs/data-model.md (ERD and prose) for the new column and table.
4. Add sessions to the TRUNCATE in apps/api/test/helpers.ts resetUserData().

API (apps/api)
5. src/auth/: password.ts (hash/verify, policy check), sessions.ts (create, lookup-and-refresh, delete,
   delete-all-for-user, purge expired), cookies.ts (parse Cookie header by hand, build Set-Cookie),
   throttle.ts (in-memory sliding window keyed by IP and by email; returns retry-after seconds).
   Put DB access for sessions and the user password lookup in src/dal/ (dal/auth.ts) with the same
   layering rules as the rest of the app; routes and services never touch Prisma directly.
6. env.ts getters (lazy, like the others): AUTH_REQUIRED (default false), COOKIE_SECURE (default true
   when NODE_ENV=production, else false), TRUST_PROXY_HOPS (default 1 in production, else 0),
   SESSION_TTL_DAYS (default 30). Add all to .env.example. app.set('trust proxy', ...) from
   TRUST_PROXY_HOPS so req.ip and req.protocol are right behind Traefik.
7. Cookie: name flightlog_session, HttpOnly, SameSite=Lax, Path=/, Secure per COOKIE_SECURE,
   Max-Age = the TTL. Clear it with an expired cookie on logout.
8. resolveUser:
   - AUTH_REQUIRED off: behave exactly as today (req.userId = DEFAULT_USER_ID).
   - AUTH_REQUIRED on: read the cookie, look up and refresh the session, set req.userId from it.
     No or invalid or expired session: AppError 401 code "unauthenticated". Never fall back to the
     default user in this mode.
   - Public even when required: GET /api/health, POST /api/auth/login. Mount order matters: health is
     already before resolveUser; make login public without weakening the rest.
9. CSRF guard for non-GET/HEAD/OPTIONS requests when AUTH_REQUIRED is on: if Origin is present it
   must match the request's own origin (use req.protocol + req.get('host')); if absent, require
   Sec-Fetch-Site to be same-origin or none; otherwise 403 "csrf_rejected". The multipart import upload
   must keep working from the same origin.
10. Routes (src/routes/auth.ts, wrapped in route(), Zod-parsed, AppError for failures), mounted in
    app.ts:
    - POST /api/auth/login {email, password}: verify; on success create a session, purge that user's
      expired sessions, set the cookie, return the AuthMe body. On any failure return 401
      "invalid_credentials" with one generic message. For an unknown email or a user with no
      password_hash, still run a dummy scrypt verify so timing does not reveal which accounts exist.
      Apply the throttle before verifying; when tripped return 429 "too_many_attempts" with a
      Retry-After header. Successful logins reset that account's counter.
    - POST /api/auth/logout: delete the session and clear the cookie; 204, idempotent.
    - GET /api/auth/me: AuthMe = { user: {id, email, displayName}, authRequired: boolean }. When
      AUTH_REQUIRED is off, return the default user with authRequired false (so the web app never
      shows a login screen locally). When on and unauthenticated: 401.
    - POST /api/auth/password {currentPassword, newPassword}: verify the current password, apply the
      policy, store the new hash, delete all OTHER sessions for that user, keep the current one.
    Send Cache-Control: no-store on all /api/auth responses.
11. packages/shared: LoginInputSchema and ChangePasswordInputSchema in schemas.ts; AuthMe in types.ts.
    Never put password_hash in any response type. Both sides use these; don't redeclare shapes.
12. Document every new route in apps/api/src/docs/openapi.ts (docs.test.ts fails otherwise), including
    the 401/403/429 responses and the cookie security scheme.
13. Privacy: never log passwords, cookies, session tokens or hashes; do not include them or the
    submitted email in error messages or error details. requestLog already omits bodies and queries.
    Keep it that way.

CLI (apps/api)
14. src/auth/cli.ts with npm scripts in apps/api/package.json (mirror the seed:* scripts), run via
    tsx:
    - user:create --email <e> --name <n>: create a user, prompt for the password twice without echo
      when stdin is a TTY, otherwise read one line from stdin (so it can be piped). Enforce the policy.
    - user:set-password --email <e>: same prompting, replaces the hash and deletes that user's
      sessions.
    - user:create --adopt-default --email <e> [--name <n>]: instead of creating a new row, set the
      email (and optional name) and password on the seeded DEFAULT_USER_ID row, so existing flights
      keep their owner. Fail clearly if that row already has a password unless --force is given.
    Never print the password or hash. In production these run as
    kubectl -n flight-log exec -it deploy/api -- sh -c 'cd apps/api && npm run user:create -- ...'.
    Document that in deploy/README.md.

WEB (apps/web)
15. Hooks in src/api/hooks.ts only (no fetch in components): useMe, useLogin, useLogout,
    useChangePassword. Login/logout must clear the whole TanStack Query cache. Put a global handler on
    the QueryClient in main.tsx so any 401 (other than from /auth/login) sends the user to /login,
    preserving the current path.
16. LoginPage at /login: email and password fields with real labels and autocomplete="username" /
    "current-password" so password managers work; inline error for invalid_credentials and a clear
    message for 429 (using Retry-After). After success, navigate to the originally requested path.
    The "next" target must be validated as a same-origin relative path starting with a single "/"
    (reject "//" and absolute URLs) to avoid an open redirect.
17. Route guard in App.tsx: while useMe loads show the Spinner; if it 401s go to /login; if
    authRequired is false render the app with no login UI at all.
18. Layout: a user menu with the display name, "Change password" and "Sign out" (hidden when
    authRequired is false). ChangePasswordPage with current/new/confirm and autocomplete="new-password".
19. Follow the web rules: loading/error states, accessible controls, light and dark, phone width.

TESTS
20. Unit (no DB): password hash/verify roundtrip and wrong password, parameter encoding, policy
    (length bounds, equals-email), cookie parse/serialize, throttle window and reset.
21. Integration (real Postgres, supertest agents, set AUTH_REQUIRED via process.env in the test and
    restore it after): login success sets an HttpOnly cookie; wrong password and unknown email return
    the identical 401 body; throttle returns 429 with Retry-After; protected routes (a flights read, a
    write, import, stats, map) return 401 without a session and work with one; /api/health and login
    stay public; logout invalidates the session; an expired session is rejected; password change kills
    other sessions but not the current one; CSRF guard rejects a cross-origin POST; and TWO users cannot
    see or modify each other's flights through the HTTP API (use the existing OTHER_USER_ID pattern and
    a second real user with its own login). With AUTH_REQUIRED off, the existing suites must pass
    unchanged.
22. Web (Vitest + RTL): LoginPage error and success paths, the redirect-target validator (rejects
    "//evil.com", "https://evil.com", accepts "/flights?x=1"), guard behavior for authRequired false
    and true.

DEPLOY (manifests only. Do NOT apply anything to a cluster or push images)
23. deploy/k8s/apps/flight-log/kustomization.yaml: add AUTH_REQUIRED=true to the API ConfigMap
    literals. ingress.yaml: remove the basic-auth Middleware and its references from both routes.
    Keep the redirect-https middleware.
24. deploy/scripts/create-secrets.sh and deploy/README.md: remove the basic-auth secret and username
    argument; describe the safe rollout ORDER so I can't lock myself out:
    (a) merge and let the images workflow build; (b) kubectl rollout restart deploy/api deploy/web while
    the OLD manifests still apply (AUTH_REQUIRED unset means off, and basic auth still guards the site);
    (c) create my user with user:create --adopt-default via kubectl exec; (d) apply the new manifests
    (AUTH_REQUIRED=true, no basic auth); (e) confirm login works and 401 without a session, before
    deleting the old flight-log-basic-auth secret.
25. Add docs/release-notes/<today>.md covering what changed, the rollout commands in order, and any
    pitfalls hit (correct command first), following the style of the existing release notes.

DOCS (same change)
26. README: replace "Phase 1 has no auth" in Assumptions, update the resolveUser row in Design
    decisions, add a short "Authentication" section (how login, sessions and the CLI work, and how
    to add a user). Root AGENTS.md: add invariants that passwords/hashes/tokens never appear in logs
    or responses and that only resolveUser sets req.userId; add src/auth/ to apps/api/AGENTS.md
    layout. Update .env.example, docker-compose.yml (pass AUTH_REQUIRED through, default off).

NON-GOALS
No signup page, email verification or reset, MFA/passkeys, roles, admin UI, OIDC, "remember me"
toggle, or third-party auth libraries. Keep the design open for a later oidc_subject column, but do
not add it.

DEFINITION OF DONE
- npm run lint && npm run typecheck && npm test && npm run format:check all pass; report any failure
  with its output instead of skipping it.
- Manually verify in a browser with AUTH_REQUIRED=true: login, redirect back to the requested page,
  logout, expired/invalid session behavior, change password, phone width, light and dark. Report
  what you actually checked.
- Confirm nothing sensitive (password, hash, token, cookie) appears in the API logs during that run.
- Final message: what changed, what you verified, what you could not verify, and the exact rollout
  commands.
```
