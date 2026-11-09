# Daily publication workflow

This repository is a public archive. Only researched public design selections, their original covers, and maintenance code belong here. Research runs in the existing daily job. GitHub Pages continues to deploy `main` from the root. No additional cron, token, secret, app installation, permission grant, or custom Actions workflow is required.

## Safety and ownership

- One coordinator owns publication. Research workers return results and never update `main` in parallel.
- Every run starts from a freshly read, full 40-character `main` HEAD, called `H`, and that commit's tree, called `T`. Read every source file at `H`, not at a moving branch name. Do not use a previous workspace as the source of truth.
- The existing GitHub connection is used under its current authorization. A permission denial or pending approval is a real blocker, not a reason to switch APIs, browser, account, or credentials. Do not retry an uncertain write before reading its outcome. Do not promise that scheduling removes provider-side approval requirements.
- A date is an idempotency key. If the date already exists unchanged, verify the existing publication and make no commit. A different version of an existing date requires an explicit correction review. Never overwrite the archive to resolve a race.
- Preserve case IDs, historical days and full text, original-link order, cover mappings and files, favicon files, and the browser-only favorites key `motion-archive:favorites:v1`. Do not publish visitor favorites or private diagnostics.

## 1. Restore and validate the pinned snapshot

Read `README.md`, `PUBLISHING.md`, the scripts, `source-data.json`, `data.json`, `covers.json`, and the recursive Git tree at `H`. Both data files must have identical content. GitHub's Contents API can return empty content for files over 1 MB: use the authorized Git blob read at the SHA from the tree, and verify the bytes against that blob SHA. Do not mistake an empty API content field for an empty archive.

Save a local `remote-tree.json` containing `{ "head": "H", "baseTree": "T", "truncated": false, "tree": [...] }`, using the commit's actual tree SHA and the unchanged recursive Git tree entries. Refuse a truncated inventory. This is a local validation input, not a file to commit. Restore exact bytes, including the original final newline. The script verifies the three pinned JSON files' Git blob hashes and binds the plan to this commit's tree. A shallow snapshot may omit images if their paths are present in this verified tree.

Run with Node 20 or later:

```sh
node scripts/archive.mjs validate --root . --tree remote-tree.json
node --test tests/publishing.test.mjs
node --check app.js
```

## 2. Prepare one edition

Create a local `batch.json` with `day`, `covers`, and optional `missingCovers`:

- `day` uses the existing `{date,title,fullText,cases}` schema, with complete case fields and stable IDs.
- `covers` contains only new case IDs and `{src,alt,sourceUrl,credit?}` values. Save new local raster cover files beside the batch, using their relative repository paths. Keep specific unavailable-cover reasons in both `missingCovers[id]` and the visible case text. A blank preview is not evidence of a viewed work.
- Preserve the five modules, case-quality requirements and quantity targets in the daily research job. The script reports counts but does not invent content to meet quotas. Editorial verification and semantic cross-platform deduplication still require research; mechanical URL checks are only a safety net.

```sh
node scripts/archive.mjs prepare --root . --tree remote-tree.json \
  --batch batch.json --head H --base-tree T --out staging-YYYY-MM-DD
```

The command never edits the source checkout. It creates validated JSON, new cover assets, a public `publish-manifest.json` containing content hashes and counts, and a **local-only** `publish-plan.json`. The two data files share one blob SHA. All historical fields and covers are retained; duplicate dates, IDs, and primary original URLs fail closed. Never commit the local batch, tree inventory, plan, logs, or private research notes.

## 3. Publish atomically through the authorized connector

1. Re-read `main`. It must still equal the plan's `expectedHead` `H`. If it changed, reload the new snapshot and rebuild. Do not simply replace the expected value on the stale plan.
2. For each distinct new binary cover, create one Git blob and verify the returned SHA against the plan. Reuse identical blob SHAs. If a write is pending or denied, stop that write and report the exact blocker. Existing files and covers are reused from `T`.
3. Create a Git tree with `base_tree_sha=T`. For UTF-8 text entries, the Git Trees API's inline `content` field can avoid separate blob-creation calls. Use `sha` for verified binary blobs. Do not send `content` and `sha` for the same entry. This normal batching optimization does not bypass a denied upload. Read the returned tree and verify every changed entry's SHA against the plan before committing.
4. Create one commit with the new tree and **the original `H` as its sole parent**. Read back the commit to confirm its parent and tree.
5. Update `main` once with `sha=newCommit`, `expected_sha=H`, and `force=false`. The expected-SHA condition is the authoritative cross-worker race guard; an in-memory lock alone is insufficient. A lease rejection requires a fresh read and rebuild. Never force push.
6. If a response is uncertain, read `main` first. If it is the intended commit, continue verification. If it is different, inspect ancestry and the dated edition before deciding what remains. Do not duplicate a commit or publish the same edition twice.

## 4. Verify deployment before reporting success

- Confirm the remote commit SHA, then inspect the normal Pages build/deployment for **that same SHA**. Use repository Actions runs or deployment records; a pull-request-only workflow query is not sufficient. Do not confuse a previous successful run with the new release.
- After that build succeeds, run:

```sh
node scripts/archive.mjs verify-live --manifest staging-YYYY-MM-DD/publish-manifest.json --attempts 6
```

This makes only public HTTPS reads, checks the expected manifest, exact data/cover hashes, current date, day count and case count, and retries briefly for CDN propagation. It does not upload, trigger builds, or request credentials.

- In a normal cloud browser, check the live page: cumulative count, today's date and count, five module filters, daily full text, original links, and representative new covers. Keep real favorites untouched. The isolated regression page at `tests/refresh.html` should show `6 passed, 0 failed`; it uses in-memory storage.
- A build success with a stale page is not a verified publication. A push success with a pending build is not a verified publication. Report those states accurately. Do not automatically revert or republish to fix caching.
- Only after deployment and live verification, send the fixed webpage link and actual daily/module counts. If blocked, preserve the complete unpublished edition and deliver the full selections in the original conversation; explain the specific missing publication step. The next permitted run can resume from current remote state.

## Corrections and maintenance

The append command intentionally does not edit historical editions or cover records. Explicit corrections need a reviewed, minimal diff and the same pinned-HEAD, single-commit and verification procedure. Website-code changes also run the existing browser regression and update the script cache version when `app.js` changes. A manifest describes data content, not a guarantee of editorial quality or external-link permanence.
