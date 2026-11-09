import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {append, validate, assertLease, canonicalUrl, makeManifest, verifyPayload, json, gitBlob, modules} from '../scripts/archive.mjs';

const clone = structuredClone;
const day = (date, id = date, url = `https://example.com/${id}`) => ({date, title: date, fullText: 'Verified public example.',
  cases: [{id, date, title: 'Example', module: 'UI动效', fullText: 'Original case text.', links: [{url, label: 'Original'}]}]});
const cover = id => ({src: `https://example.com/${id}.jpg`, alt: 'Original frame', sourceUrl: `https://example.com/${id}`});
const base = () => ({title: 'Archive', updatedAt: '2026-11-09', modules, days: [day('2026-11-09')]});
const covers = () => ({'2026-11-09': cover('2026-11-09')});
const batch = () => ({day: day('2026-11-10'), covers: {'2026-11-10': cover('2026-11-10')}});

test('append preserves every historical field and cover; repeat is a no-op', () => {
  const d = base(), c = covers(), b = batch(), before = clone([d, c, b]);
  const r = append(d, c, b);
  assert.equal(r.changed, true); assert.deepEqual([d, c, b], before);
  assert.deepEqual(r.data.days[1], d.days[0]); assert.deepEqual(r.covers[d.days[0].cases[0].id], c[d.days[0].cases[0].id]);
  assert.equal(append(r.data, r.covers, b).changed, false);
});
test('changed same-day content fails instead of overwriting', () => {
  const r = append(base(), covers(), batch()), b = batch(); b.day.fullText += ' changed';
  assert.throws(() => append(r.data, r.covers, b), /Existing date differs/);
});
test('duplicate original URL across dates or modules is rejected', () => {
  const b = batch(); b.day.cases[0].links[0].url = 'https://example.com/2026-11-09/?utm_source=test#watch';
  assert.throws(() => append(base(), covers(), b), /already archived/);
  const b2 = batch(); b2.day.cases.push({...clone(b2.day.cases[0]), id: 'other', module: 'UI设计'});
  assert.throws(() => append(base(), covers(), b2), /already archived/);
  assert.equal(canonicalUrl('https://twitter.com/a/status/1?utm_source=t#x'), canonicalUrl('https://x.com/a/status/1'));
});
test('duplicate IDs and invalid date/module/URLs are rejected', () => {
  const b = batch(); b.day.cases[0].id = '2026-11-09'; assert.throws(() => append(base(), covers(), b), /Duplicate case id/);
  for (const change of [d => d.days[0].cases[0].date = '2026-11-08', d => d.days[0].cases[0].module = 'other',
    d => d.days[0].cases[0].links[0].url = 'javascript:alert(1)', d => d.updatedAt = '2026-11-08']) {
    const d = base(); change(d); assert.throws(() => validate(d, covers()));
  }
});
test('cover provenance, safe path and local asset existence are required', () => {
  for (const src of ['../outside.jpg', '/outside.jpg', 'javascript:alert(1)', 'a\\b.jpg']) {
    const c = covers(); c['2026-11-09'].src = src; assert.throws(() => validate(base(), c), /unsafe cover/);
  }
  const c = covers(); c['2026-11-09'].src = 'missing.jpg'; assert.throws(() => validate(base(), c, () => false), /Missing/);
  c['2026-11-09'].sourceUrl = ''; assert.throws(() => validate(base(), c), /provenance/);
});
test('new missing covers need a visible specific reason; legacy placeholders survive', () => {
  const c = covers(); c['2026-11-09'].src = ''; validate(base(), c);
  const b = batch(); b.covers = {}; assert.throws(() => append(base(), c, b), /Need cover/);
  b.missingCovers = {'2026-11-10': 'Original video requires login; no public frame available.'};
  assert.throws(() => append(base(), c, b), /Put the cover limitation/);
  b.day.cases[0].fullText += b.missingCovers['2026-11-10']; assert.equal(append(base(), c, b).changed, true);
});
test('historical cover updates and inconsistent inline covers are rejected', () => {
  const b = batch(); b.covers['2026-11-09'] = cover('different'); assert.throws(() => append(base(), covers(), b), /historical cover/);
  const b2 = batch(); b2.day.cases[0].cover = cover('other'); assert.throws(() => append(base(), covers(), b2), /Inline cover/);
});
test('lease guard rejects concurrent writers and short SHAs', () => {
  assertLease('a'.repeat(40), 'a'.repeat(40));
  assert.throws(() => assertLease('a'.repeat(40), 'b'.repeat(40)), /HEAD changed/);
  assert.throws(() => assertLease('abcdef0', 'abcdef0'), /full SHA/);
});
test('release verification rejects mixed, stale, truncated and miscounted data', () => {
  const d = json(base()), c = json(covers()), m = makeManifest(base(), d, c);
  assert.equal(verifyPayload(m, d, c).totalCases, 1);
  assert.throws(() => verifyPayload(m, d + ' ', c), /data hash/);
  assert.throws(() => verifyPayload(m, d, '{}'), /cover hash/);
  assert.throws(() => verifyPayload({...m, totalCases: 2}, d, c), /counts/);
});
test('CLI stages only planned files, pins source bytes, protects output and detects stale input', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'motion-publish-test-'));
  try {
    const d = json(base()), c = json(covers()), head = 'a'.repeat(40), treeSha = 'b'.repeat(40);
    for (const [p, bytes] of Object.entries({'source-data.json': d, 'data.json': d, 'covers.json': c})) fs.writeFileSync(path.join(root, p), bytes);
    const tree = {head, baseTree: treeSha, truncated: false, tree: ['source-data.json', 'data.json', 'covers.json'].map(p => ({path: p, type: 'blob', sha: gitBlob(fs.readFileSync(path.join(root, p)))}))};
    fs.writeFileSync(path.join(root, 'tree.json'), json(tree)); fs.writeFileSync(path.join(root, 'batch.json'), json(batch()));
    const args = ['scripts/archive.mjs', 'prepare', '--root', root, '--tree', path.join(root, 'tree.json'), '--batch', path.join(root, 'batch.json'), '--head', head, '--base-tree', treeSha, '--out', path.join(root, 'stage')];
    let r = spawnSync(process.execPath, args, {encoding: 'utf8'}); assert.equal(r.status, 0, r.stderr);
    const plan = JSON.parse(r.stdout); assert.equal(plan.expectedHead, head); assert.equal(plan.statistics.totalCases, 2);
    assert.deepEqual(plan.changes.map(p => p.path), ['source-data.json', 'data.json', 'covers.json', 'publish-manifest.json']);
    assert.equal(plan.changes[0].sha, plan.changes[1].sha);
    assert.equal(fs.readFileSync(path.join(root, 'source-data.json'), 'utf8'), d);
    r = spawnSync(process.execPath, args, {encoding: 'utf8'}); assert.notEqual(r.status, 0); assert.match(r.stderr, /Output exists/);
    const wrongTreeArgs = args.map(x => x === treeSha ? 'e'.repeat(40) : x);
    r = spawnSync(process.execPath, wrongTreeArgs, {encoding: 'utf8'}); assert.notEqual(r.status, 0); assert.match(r.stderr, /Base tree differs/);
    fs.writeFileSync(path.join(root, 'tree.json'), json({...tree, truncated: true}));
    r = spawnSync(process.execPath, args, {encoding: 'utf8'}); assert.notEqual(r.status, 0); assert.match(r.stderr, /complete/);
    fs.writeFileSync(path.join(root, 'tree.json'), json(tree));
    fs.appendFileSync(path.join(root, 'source-data.json'), ' ');
    r = spawnSync(process.execPath, args, {encoding: 'utf8'}); assert.notEqual(r.status, 0); assert.match(r.stderr, /pinned tree/);
  } finally { fs.rmSync(root, {recursive: true, force: true}); }
});
test('CLI rejects new assets replacing an existing directory or nested below an existing blob', () => {
  for (const [asset, collision] of [['legacy.jpg', {path: 'legacy.jpg/old.png', type: 'blob', sha: 'd'.repeat(40)}],
    ['old.png/cover.jpg', {path: 'old.png', type: 'blob', sha: 'd'.repeat(40)}]]) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'motion-collision-test-'));
    try {
      for (const [p, v] of Object.entries({'source-data.json': base(), 'data.json': base(), 'covers.json': covers()})) fs.writeFileSync(path.join(root, p), json(v));
      const head = 'a'.repeat(40), baseTree = 'b'.repeat(40);
      const tree = {head, baseTree, truncated: false, tree: [...['source-data.json', 'data.json', 'covers.json'].map(p => ({path: p, type: 'blob', sha: gitBlob(fs.readFileSync(path.join(root, p)))})), collision]};
      fs.writeFileSync(path.join(root, 'tree.json'), json(tree));
      const b = batch(); b.covers['2026-11-10'].src = asset; fs.writeFileSync(path.join(root, 'batch.json'), json(b));
      fs.mkdirSync(path.dirname(path.join(root, asset)), {recursive: true}); fs.writeFileSync(path.join(root, asset), 'cover bytes');
      const r = spawnSync(process.execPath, ['scripts/archive.mjs', 'prepare', '--root', root, '--tree', path.join(root, 'tree.json'), '--batch', path.join(root, 'batch.json'), '--head', head, '--base-tree', baseTree, '--out', path.join(root, 'stage')], {encoding: 'utf8'});
      assert.notEqual(r.status, 0); assert.match(r.stderr, /Asset path conflicts/);
    } finally { fs.rmSync(root, {recursive: true, force: true}); }
  }
});
test('checked-in archive has valid schema and identical maintained/rendered data', () => {
  const d = JSON.parse(fs.readFileSync('source-data.json')), c = JSON.parse(fs.readFileSync('covers.json'));
  assert.deepEqual(d, JSON.parse(fs.readFileSync('data.json'))); assert.ok(validate(d, c).totalCases > 0);
});
