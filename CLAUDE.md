# CLAUDE.md

The project's agent instructions live in AGENTS.md (shared with other coding agents), imported here:

@AGENTS.md

## Claude Code specifics

- Nested `CLAUDE.md` files in `apps/api`, `apps/web` and `packages/shared` import each workspace's
  `AGENTS.md`. They load automatically when you work in those directories.
- `.claude/` (e.g. a local `launch.json` for previewing the web app) is gitignored and machine-specific.
- For UI changes, verify in the browser pane. The web app needs the API running, either via
  `docker compose up` or `npm run dev` with the `db` container up.
