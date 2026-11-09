#!/usr/bin/env node
// No dependencies, credentials, repository writes, or network writes.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {fileURLToPath} from 'node:url';

export const modules = ['UI设计', 'UI动效', '趣味交互', 'AI产品宣传', 'AI制作动画'];
const fail = message => { throw new Error(message); };
const check = (condition, message) => condition || fail(message);
const text = value => typeof value === 'string' && value.trim().length > 0;
export const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
export const gitBlob = bytes => crypto.createHash('sha1').update(`blob ${Buffer.byteLength(bytes)}\0`).update(bytes).digest('hex');
export const json = value => JSON.stringify(value, null, 2) + '\n';
export function httpUrl(value) {
  try { const u = new URL(value); return ['http:', 'https:'].includes(u.protocol) && !u.username && !u.password; }
  catch { return false; }
}
export function canonicalUrl(value) {
  const u = new URL(value); u.hash = ''; u.hostname = u.hostname.toLowerCase().replace(/^www\./, '');
  if (u.hostname === 'twitter.com') u.hostname = 'x.com';
  for (const key of [...u.searchParams.keys()]) if (/^utm_/i.test(key) || ['fbclid', 'gclid'].includes(key)) u.searchParams.delete(key);
  u.searchParams.sort(); u.pathname = u.pathname.replace(/\/$/, '') || '/'; return u.href;
}
export function localPath(value) {
  return typeof value === 'string' && !value.includes('\\') && !value.startsWith('/') &&
    value.split('/').every(p => p && p !== '.' && p !== '..') && !/[?#:\x00-\x1f]/.test(value);
}
export function validate(data, covers, exists = () => true) {
  check(data && isDeepStrictEqual(data.modules, modules), 'Module schema changed');
  check(Array.isArray(data.days) && data.days.length > 0, 'Missing days');
  check(covers && typeof covers === 'object' && !Array.isArray(covers), 'Invalid covers dictionary');
  const dates = new Set(), ids = new Set();
  let total = 0;
  for (const day of data.days) {
    check(/^\d{4}-\d{2}-\d{2}$/.test(day.date) && new Date(day.date).toISOString().slice(0, 10) === day.date, 'Invalid date');
    check(!dates.has(day.date), `Duplicate date: ${day.date}`); dates.add(day.date);
    check(text(day.title) && text(day.fullText) && Array.isArray(day.cases) && day.cases.length, `Incomplete day: ${day.date}`);
    for (const c of day.cases) {
      check(['id', 'title', 'fullText'].every(k => text(c[k])), `Incomplete case: ${c.id}`);
      check(!ids.has(c.id), `Duplicate case id: ${c.id}`); ids.add(c.id);
      check(c.date === day.date && modules.includes(c.module), `Invalid case date/module: ${c.id}`);
      check(Array.isArray(c.links) && c.links.length && c.links.every(l => httpUrl(l.url)), `Invalid links: ${c.id}`);
      total++;
    }
  }
  check(data.updatedAt === [...dates].sort().at(-1), 'updatedAt must be latest archive date');
  for (const [id, cover] of Object.entries(covers)) {
    check(ids.has(id), `Orphan cover: ${id}`);
    check(text(cover.alt) && httpUrl(cover.sourceUrl), `Missing cover provenance: ${id}`);
    // Historical explicit no-image placeholders remain valid.
    check(cover.src === '' || httpUrl(cover.src) || (localPath(cover.src) && exists(cover.src)), `Missing or unsafe cover: ${id}`);
  }
  return {latestDate: data.updatedAt, totalDays: dates.size, totalCases: total, covers: Object.keys(covers).length};
}
export function assertLease(expected, actual) {
  check(/^[0-9a-f]{40}$/.test(expected), 'Expected HEAD must be a full SHA');
  check(expected === actual, 'HEAD changed: discard this plan, reload and rebuild; never force push');
}
export function append(data, covers, batch, exists = () => true) {
  validate(data, covers, exists);
  check(batch && batch.day && batch.covers && typeof batch.covers === 'object' && !Array.isArray(batch.covers), 'Batch needs day and covers');
  const old = data.days.find(day => day.date === batch.day.date);
  if (old) {
    check(isDeepStrictEqual(old, batch.day), `Existing date differs: ${old.date}; no automatic overwrite`);
    for (const [id, cover] of Object.entries(batch.covers)) check(isDeepStrictEqual(covers[id], cover), `Existing cover differs: ${id}`);
    return {changed: false, data, covers};
  }
  const ids = new Set(data.days.flatMap(day => day.cases.map(c => c.id)));
  const urls = new Set(data.days.flatMap(day => day.cases.map(c => canonicalUrl(c.links[0].url))));
  const newIds = new Set();
  for (const c of batch.day.cases || []) {
    check(!ids.has(c.id) && !newIds.has(c.id), `Duplicate case id: ${c.id}`); newIds.add(c.id);
    check(httpUrl(c.links?.[0]?.url), `Missing original URL: ${c.id}`);
    const url = canonicalUrl(c.links[0].url);
    check(!urls.has(url), `Original already archived: ${url}`); urls.add(url);
    check(batch.covers[c.id]?.src || text(batch.missingCovers?.[c.id]), `Need cover or specific unavailability reason: ${c.id}`);
    if (!batch.covers[c.id]?.src) check(c.fullText.includes(batch.missingCovers[c.id]), `Put the cover limitation in the case text: ${c.id}`);
    check(!c.cover || isDeepStrictEqual(c.cover, batch.covers[c.id]), `Inline cover must match covers dictionary: ${c.id}`);
  }
  for (const id of Object.keys(batch.covers)) check(newIds.has(id), `Batch tries to alter historical cover: ${id}`);
  const next = structuredClone(data);
  next.days.push(structuredClone(batch.day)); next.days.sort((a, b) => b.date.localeCompare(a.date));
  next.updatedAt = next.days[0].date;
  const nextCovers = {...covers, ...structuredClone(batch.covers)};
  validate(next, nextCovers, exists);
  for (const day of data.days) check(isDeepStrictEqual(next.days.find(d => d.date === day.date), day), 'History changed');
  return {changed: true, data: next, covers: nextCovers};
}
export function makeManifest(data, dataBytes, coverBytes) {
  return {version: 1, archiveDate: data.updatedAt, totalDays: data.days.length,
    totalCases: data.days.reduce((n, day) => n + day.cases.length, 0),
    files: {'data.json': sha256(dataBytes), 'covers.json': sha256(coverBytes)}};
}
export function verifyPayload(manifest, dataBytes, coverBytes) {
  check(manifest?.version === 1, 'Unsupported release manifest');
  check(sha256(dataBytes) === manifest.files?.['data.json'], 'Published data hash mismatch');
  check(sha256(coverBytes) === manifest.files?.['covers.json'], 'Published cover hash mismatch');
  const stats = validate(JSON.parse(dataBytes), JSON.parse(coverBytes));
  check(stats.latestDate === manifest.archiveDate && stats.totalCases === manifest.totalCases && stats.totalDays === manifest.totalDays, 'Published counts mismatch');
  return stats;
}
const read = filename => JSON.parse(fs.readFileSync(filename, 'utf8'));
function snapshot(root, treeFile) {
  const tree = treeFile ? read(treeFile) : null;
  const known = new Set(tree?.tree?.filter(e => e.type === 'blob').map(e => e.path));
  const exists = p => fs.existsSync(path.join(root, p)) || known.has(p);
  const data = read(path.join(root, 'source-data.json')), covers = read(path.join(root, 'covers.json'));
  check(isDeepStrictEqual(data, read(path.join(root, 'data.json'))), 'source-data.json and data.json differ');
  if (tree) {
    check(tree.truncated === false, 'Tree inventory must explicitly be complete');
    check(/^[0-9a-f]{40}$/.test(tree.baseTree), 'Tree inventory needs the pinned commit tree SHA');
    check(Array.isArray(tree.tree) && tree.tree.every(e => localPath(e.path) && /^[0-9a-f]{40}$/.test(e.sha)), 'Invalid tree inventory');
    check(new Set(tree.tree.map(e => e.path)).size === tree.tree.length, 'Duplicate inventory paths');
    for (const p of ['source-data.json', 'data.json', 'covers.json']) {
      const entry = tree.tree.find(e => e.path === p);
      check(entry && gitBlob(fs.readFileSync(path.join(root, p))) === entry.sha, `Snapshot bytes do not match pinned tree: ${p}`);
    }
  }
  return {data, covers, exists, tree};
}
export async function main(argv = process.argv.slice(2)) {
  const [command, ...rest] = argv;
  check(rest.length % 2 === 0, 'Options must be --name value pairs');
  const opts = Object.fromEntries(Array.from({length: rest.length / 2}, (_, i) => [rest[i * 2].replace(/^--/, ''), rest[i * 2 + 1]]));
  const root = path.resolve(opts.root || '.');
  if (command === 'validate') {
    const s = snapshot(root, opts.tree); console.log(json(validate(s.data, s.covers, s.exists))); return;
  }
  if (command === 'prepare') {
    check(opts.batch && opts.out && opts.head && opts['base-tree'] && opts.tree, 'Need --batch --out --head --base-tree --tree');
    assertLease(opts.head, opts.head); check(/^[0-9a-f]{40}$/.test(opts['base-tree']), 'Invalid base tree SHA');
    const s = snapshot(root, opts.tree);
    assertLease(opts.head, s.tree.head);
    check(opts['base-tree'] === s.tree.baseTree, 'Base tree differs from the pinned commit tree');
    const batchPath = path.resolve(opts.batch), batch = read(batchPath), batchDir = path.dirname(batchPath);
    const tracked = new Map(s.tree.tree.filter(e => e.type === 'blob').map(e => [e.path, e.sha]));
    for (const cover of Object.values(batch.covers || {})) {
      if (!localPath(cover.src) || !tracked.has(cover.src)) continue;
      const candidate = path.join(batchDir, cover.src);
      if (fs.existsSync(candidate)) check(gitBlob(fs.readFileSync(candidate)) === tracked.get(cover.src), `Cover filename collision: ${cover.src}`);
    }
    const result = append(s.data, s.covers, batch, p => s.exists(p) || fs.existsSync(path.join(batchDir, p)));
    if (!result.changed) { console.log(json({changed: false, date: batch.day.date, reason: 'Identical edition already present'})); return; }
    const out = path.resolve(opts.out);
    check(!fs.existsSync(out), 'Output exists; use a new staging directory'); fs.mkdirSync(out, {recursive: true});
    const files = {'source-data.json': json(result.data), 'data.json': json(result.data), 'covers.json': json(result.covers)};
    files['publish-manifest.json'] = json(makeManifest(result.data, files['data.json'], files['covers.json']));
    const changes = [];
    for (const [p, bytes] of Object.entries(files)) {
      fs.writeFileSync(path.join(out, p), bytes);
      changes.push({path: p, mode: '100644', type: 'blob', encoding: 'utf-8', sha: gitBlob(bytes), sha256: sha256(bytes)});
    }
    const newAssets = new Set(Object.values(batch.covers).map(c => c.src).filter(src => localPath(src) && !tracked.has(src)));
    for (const p of newAssets) {
      check(!s.tree.tree.some(e => e.path === p || e.path.startsWith(p + '/') || (e.type !== 'tree' && p.startsWith(e.path + '/'))), `Asset path conflicts with pinned tree: ${p}`);
      check(/\.(png|jpg|jpeg|webp|avif)$/i.test(p), `Only raster cover assets are allowed: ${p}`);
      const asset = fs.existsSync(path.join(batchDir, p)) ? path.join(batchDir, p) : path.join(root, p);
      const bytes = fs.readFileSync(asset); check(bytes.length > 0 && bytes.length <= 10 * 1024 * 1024, `Invalid cover size: ${p}`);
      fs.mkdirSync(path.dirname(path.join(out, p)), {recursive: true}); fs.writeFileSync(path.join(out, p), bytes);
      changes.push({path: p, mode: '100644', type: 'blob', encoding: 'base64', sha: gitBlob(bytes), sha256: sha256(bytes)});
    }
    const plan = {version: 1, repository: 'Richan2018/motion-atlas', branch: 'main', expectedHead: opts.head,
      baseTree: opts['base-tree'], date: batch.day.date, idempotencyKey: `edition:${batch.day.date}`, changes,
      statistics: validate(result.data, result.covers), moduleCounts: Object.fromEntries(modules.map(m => [m, batch.day.cases.filter(c => c.module === m).length]))};
    fs.writeFileSync(path.join(out, 'publish-plan.json'), json(plan)); console.log(json(plan)); return;
  }
  if (command === 'verify-live') {
    check(opts.manifest, 'Need local --manifest from the expected release');
    const expected = read(opts.manifest), base = new URL(opts.url || 'https://richan2018.github.io/motion-atlas/');
    check(base.protocol === 'https:' && base.hostname === 'richan2018.github.io' && base.pathname === '/motion-atlas/', 'Unexpected publication destination');
    const attempts = Math.min(6, Math.max(1, Number(opts.attempts || 1))); check(Number.isInteger(attempts), 'Invalid attempts');
    let error;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        const get = async p => { const u = new URL(p, base); u.searchParams.set('verify', expected.files['data.json']);
          const r = await fetch(u, {cache: 'no-store', signal: AbortSignal.timeout(15000)}); check(r.ok, `${p}: HTTP ${r.status}`); return Buffer.from(await r.arrayBuffer()); };
        const manifest = JSON.parse(await get('publish-manifest.json'));
        check(isDeepStrictEqual(manifest, expected), 'Pages still serves a different release');
        const stats = verifyPayload(manifest, await get('data.json'), await get('covers.json'));
        console.log(json({verified: true, url: base.href, ...stats})); return;
      } catch (e) { error = e; if (attempt < attempts) await new Promise(resolve => setTimeout(resolve, Math.min(60000, 10000 * 2 ** (attempt - 1)))); }
    }
    throw error;
  }
  fail('Commands: validate, prepare, verify-live. See PUBLISHING.md.');
}
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch(e => { console.error(e.message); process.exitCode = 1; });
}
