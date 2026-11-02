'use strict';
const $ = s => document.querySelector(s);
let data, items = [], covers = {}, state = {date:'', module:'', q:'', sort:'new', favorites:false};
const FAVORITES_KEY = 'motion-archive:favorites:v1';
let favorites = new Set(), storageAvailable = true;
const names = {'UI设计':'UI 设计','UI动效':'UI 动效','趣味交互':'趣味交互','AI产品宣传':'AI 产品宣传','AI制作动画':'AI 制作动画'};
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function safeUrl(s) { try { const u = new URL(s); return ['https:','http:'].includes(u.protocol) ? u.href : '#'; } catch { return '#'; } }
function favoriteKey(c) {
  const url = safeUrl(c.links?.[0]?.url);
  if (url !== '#') { const u = new URL(url); u.hash = ''; return 'url:' + u.href; }
  return 'id:' + c.id;
}
function isFavorite(c) { return favorites.has(favoriteKey(c)) || favorites.has('id:' + c.id); }
function readFavorites() {
  try {
    const raw = localStorage.getItem(FAVORITES_KEY);
    const saved = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(saved) || !saved.every(k => typeof k === 'string')) throw Error('Invalid favorites');
    favorites = new Set(saved);
  } catch { storageAvailable = false; }
}
function saveFavorites() {
  try { localStorage.setItem(FAVORITES_KEY, JSON.stringify([...favorites])); storageAvailable = true; }
  catch { storageAvailable = false; }
}
function inline(s) { return esc(s).replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_,l,u) => `<a href="${esc(safeUrl(u.replace(/&amp;/g,'&')))}" target="_blank" rel="noopener noreferrer">${l} ↗</a>`).replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>'); }
function markdown(s) { return String(s).split(/\n\n+/).map(p => { if (/^#{1,4} /.test(p)) return `<h3>${inline(p.match(/^#{1,4} (.*)/)[1])}</h3>`; return '<p>' + p.split('\n').map(inline).join('<br>') + '</p>'; }).join(''); }
function clean(s) { return String(s).replace(/\[([^\]]+)\]\([^)]*\)/g,'$1').replace(/\*|#/g,'').replace(/https?:\/\/\S+/g,'').trim(); }
function preview(c) { return clean(c.fullText.split('\n').filter(x => x.trim() && !/^\[|^原片|^原作|^观看|^链接|^https?:/.test(x)).join(' ')); }
function openCase(c) { $('#detailMeta').textContent = `${c.date} 归档 · ${names[c.module] || c.module}`; $('#detailBody').innerHTML = `<h2>${esc(c.title)}</h2><div class="detail-links">${c.links.map(l => `<a href="${esc(safeUrl(l.url))}" target="_blank" rel="noopener noreferrer">${esc(l.label || '查看原作')} ↗</a>`).join('')}</div>${markdown(c.fullText)}`; $('#detail').showModal(); $('#detail').scrollTop = 0; }
function openDay(d) { $('#detailMeta').textContent = `${d.date} · 当日完整精选`; $('#detailBody').innerHTML = markdown(d.fullText); $('#detail').showModal(); $('#detail').scrollTop = 0; }
function coverMarkup(c) {
  const cover = c.cover || covers[c.id];
  let src = '';
  if (cover?.src) {
    try { const u = new URL(cover.src, document.baseURI); if (['http:','https:'].includes(u.protocol)) src = u.href; } catch {}
  }
  const sourceUrl = safeUrl(cover?.sourceUrl || c.links?.[0]?.url);
  let host = '原作链接见详情';
  try { host = new URL(c.links?.[0]?.url).hostname.replace(/^www\./, ''); } catch {}
  return `<div class="card-cover${src ? ' has-image' : ''}"><div class="cover-placeholder"><span aria-hidden="true">↗</span><strong>${esc(host)}</strong><small>暂无可用作品封面 · 可查看原作</small></div>${src ? `<a class="cover-link" href="${esc(sourceUrl)}" target="_blank" rel="noopener noreferrer" aria-label="查看封面原作：${esc(c.title)}"><img src="${esc(src)}" alt="${esc(cover.alt || c.title + ' · 原作封面')}" loading="lazy" decoding="async" referrerpolicy="no-referrer"><span class="cover-caption">${esc(cover.credit || '封面来源')} ↗</span></a>` : ''}</div>`;
}
function render() {
  const q = state.q.toLowerCase().trim();
  const favoriteCount = items.filter(isFavorite).length;
  const found = items.filter(c => (!state.favorites || isFavorite(c)) && (!state.date || c.date === state.date) && (!state.module || c.module === state.module) && (!q || (c.title + ' ' + c.fullText + ' ' + c.module).toLowerCase().includes(q))).sort((a,b) => state.sort === 'new' ? b.date.localeCompare(a.date) : a.date.localeCompare(b.date));
  $('#viewTitle').textContent = state.favorites ? '我的收藏' : state.date ? state.date + ' 精选' : '全部精选';
  $('#favoriteCount').textContent = favoriteCount;
  $('#resultCount').textContent = `显示 ${found.length} / ${state.favorites ? favoriteCount : items.length} 个${state.favorites ? '收藏' : '案例'}`;
  $('#storageNote').textContent = storageAvailable ? '收藏仅保存在当前浏览器，不会跨设备同步；清除浏览器数据会移除收藏。' : '浏览器存储不可用或收藏数据异常；本次仍可收藏，但刷新或关闭后可能丢失。';
  $('#storageNote').classList.toggle('warning', !storageAvailable);
  $('#clear').hidden = !state.date && !state.module && !q;
  $('#empty').hidden = !!found.length;
  $('#emptyTitle').textContent = state.favorites && !favoriteCount ? '还没有收藏案例' : '没有找到相符的案例';
  $('#emptyHint').textContent = state.favorites && !favoriteCount ? '点击卡片右上角的星星，把喜欢的作品留在这里。' : '试试更短的关键词，或清除日期和模块筛选。';
  $('#browseAll').hidden = !state.favorites || !!favoriteCount;
  $('#allDates').classList.toggle('active', !state.date && !state.favorites);
  $('#allDates').setAttribute('aria-pressed', String(!state.date && !state.favorites));
  $('#favoritesView').classList.toggle('active', state.favorites);
  $('#favoritesView').setAttribute('aria-pressed', String(state.favorites));
  document.querySelectorAll('.date-btn').forEach(b => { b.classList.toggle('active', b.dataset.date === state.date); b.setAttribute('aria-pressed', String(b.dataset.date === state.date)); });
  document.querySelectorAll('.filter').forEach(b => { b.classList.toggle('active', b.dataset.module === state.module); b.setAttribute('aria-pressed', String(b.dataset.module === state.module)); });
  $('#cards').innerHTML = found.map(c => `<article class="card" data-type="${esc(names[c.module])}">${coverMarkup(c)}<div class="card-top"><span class="tag">${esc(names[c.module] || c.module)}</span><time>${esc(c.date)}</time><button class="favorite-btn${isFavorite(c) ? ' is-saved' : ''}" data-id="${esc(c.id)}" aria-pressed="${isFavorite(c)}" aria-label="${isFavorite(c) ? '取消收藏' : '收藏'}：${esc(c.title)}" title="${isFavorite(c) ? '取消收藏' : '收藏案例'}"><span aria-hidden="true">${isFavorite(c) ? '★' : '☆'}</span></button></div><h3>${esc(c.title)}</h3><p class="excerpt">${esc(preview(c))}</p><div class="card-bottom"><button class="detail-btn" data-id="${esc(c.id)}">案例详情与借鉴点 <span>↗</span></button>${c.links[0] ? `<a class="source-link" href="${esc(safeUrl(c.links[0].url))}" target="_blank" rel="noopener noreferrer">查看原作 ↗</a>` : ''}</div><div class="verification">${c.limitations ? '含核验范围与观看限制' : '作者与原始链接见详情'}</div></article>`).join('');
  document.querySelectorAll('.card-cover img').forEach(img => { img.addEventListener('error', () => { img.closest('.card-cover').classList.remove('has-image'); img.closest('.cover-link').remove(); }); });
}
readFavorites();
$('#cards').addEventListener('click', e => {
  const button = e.target.closest('button[data-id]');
  if (!button) return;
  const c = items.find(c => c.id === button.dataset.id);
  if (!c) return;
  if (button.classList.contains('detail-btn')) return openCase(c);
  if (!button.classList.contains('favorite-btn')) return;
  const buttons = [...document.querySelectorAll('.favorite-btn')], index = buttons.indexOf(button);
  const removing = isFavorite(c);
  if (removing) { favorites.delete(favoriteKey(c)); favorites.delete('id:' + c.id); } else favorites.add(favoriteKey(c));
  saveFavorites(); render();
  const remaining = [...document.querySelectorAll('.favorite-btn')];
  (remaining.find(b => b.dataset.id === c.id) || remaining[Math.min(index, remaining.length - 1)] || $('#favoritesView')).focus({preventScroll:true});
  $('#favoriteStatus').textContent = `${removing ? '已取消收藏' : '已收藏'}：${c.title}${storageAvailable ? '' : '。暂时仅在本次页面中保存'}`;
});
$('#closeDetail').onclick = () => $('#detail').close();
$('#detail').addEventListener('click', e => { if (e.target === $('#detail')) { const r = $('#detail').getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) $('#detail').close(); } });
$('#search').addEventListener('input', e => { state.q = e.target.value; render(); });
$('#sort').onchange = e => { state.sort = e.target.value; render(); };
function browseAll() { state.date = ''; state.favorites = false; render(); }
$('#allDates').onclick = browseAll;
$('#browseAll').onclick = () => { state.module = ''; state.q = ''; $('#search').value = ''; browseAll(); };
$('#favoritesView').onclick = () => { state.favorites = true; state.date = ''; state.module = ''; state.q = ''; $('#search').value = ''; render(); };
$('#clear').onclick = () => { state.date = ''; state.module = ''; state.q = ''; $('#search').value = ''; render(); };
document.addEventListener('keydown', e => { if (e.key === '/' && !['INPUT','TEXTAREA'].includes(document.activeElement.tagName) && !$('#detail').open) { e.preventDefault(); $('#search').focus(); } });
window.addEventListener('storage', e => { if (e.key === FAVORITES_KEY || e.key === null) { favorites = new Set(); storageAvailable = true; readFavorites(); if (data) render(); } });
Promise.all([
  fetch('data.json').then(r => { if (!r.ok) throw Error('load'); return r.json(); }),
  fetch('covers.json').then(r => r.ok ? r.json() : {}).catch(() => ({}))
]).then(([d, coverData]) => {
  data = d; covers = coverData && typeof coverData === 'object' ? coverData : {}; items = d.days.flatMap(d => d.cases);
  $('#caseCount').textContent = items.length; $('#sideCount').textContent = items.length;
  $('#dayCount').textContent = String(d.days.length).padStart(2,'0'); $('#updated').textContent = d.days.map(x => x.date).sort().at(-1);
  $('#dates').innerHTML = d.days.slice().sort((a,b) => b.date.localeCompare(a.date)).map(d => `<button class="date-btn" data-date="${esc(d.date)}">${esc(d.date)}<span>${d.cases.length}</span></button>`).join('');
  document.querySelectorAll('.date-btn').forEach(b => b.onclick = () => { state.date = b.dataset.date; render(); });
  $('#filters').innerHTML = ['',...d.modules].map(m => `<button class="filter${m ? '' : ' active'}" data-module="${esc(m)}">${m ? names[m] || m : '全部'}<span>${m ? items.filter(c => c.module === m).length : items.length}</span></button>`).join('');
  document.querySelectorAll('.filter').forEach(b => b.onclick = () => { state.module = b.dataset.module; render(); });
  $('#editions').innerHTML = d.days.slice().sort((a,b) => b.date.localeCompare(a.date)).map(d => `<button class="edition" data-day="${esc(d.date)}"><strong>${esc(d.date)}</strong><span>${d.cases.length} 个主案例 · 阅读当日全文 ↗</span></button>`).join('');
  document.querySelectorAll('.edition').forEach(b => b.onclick = () => openDay(d.days.find(d => d.date === b.dataset.day)));
  render();
}).catch(() => { $('#cards').innerHTML = '<p role="alert">资料暂时加载失败，请刷新页面重试。</p>'; });
