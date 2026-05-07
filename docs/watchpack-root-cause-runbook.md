# Watchpack EINVAL Root-Cause Runbook

## Scope
Runbook for investigating `Watchpack Error (initial scan): EINVAL ... lstat 'C:\...'` without hiding logs.

## Symptoms
- Dev server prints repeated `EINVAL` for:
  - `C:\DumpStack.log.tmp`
  - `C:\System Volume Information`
  - `C:\hiberfil.sys`
  - `C:\pagefile.sys`
  - `C:\swapfile.sys`

## Confirmed baseline
- Project code does not include custom filesystem watchers (`chokidar`, `fs.watch`, `watchpack`).
- Main source is webpack/Watchpack behavior on Windows during initial scan.

## Triage steps
1. Verify launch cwd:
   - must be `C:\diploma2\diploma`.
2. Compare bundlers:
   - `npm run dev:webpack` (diagnostic mode)
   - `npm run dev` (Turbopack default)
3. Compare logs:
   - if EINVAL appears in webpack mode and does not appear in turbo mode, root cause is confirmed as webpack/Watchpack-specific in this environment.
4. Verify path structure:
   - ensure project path is not a symlink/junction/reparse-point chain.

## Operational decision
- Use `npm run dev` (Turbopack) as the default daily workflow.
- Keep `npm run dev:webpack` only for diagnostics and compatibility checks.

## Smoke checklist after startup
1. Open `/networks` and `/sandbox`.
2. Confirm route compile completes successfully.
3. Confirm API routes respond (`/api/profile`, `/api/proposals`).
4. Confirm HMR reacts to a small client edit.
5. Confirm no new runtime errors in terminal.

## Residual risks
- If webpack mode is required for a specific plugin behavior, EINVAL may still reappear on this Windows host.
- Environment factors (security software, system hooks, non-standard mount topology) can amplify scan noise.
