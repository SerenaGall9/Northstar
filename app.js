'use strict';
import { esc, mdToHtml } from './md.js';
import { savePdf, pdfBase64 } from './pdf.js';
import * as AI from './ai.js';

/* =========================================================
   Storage: one state document in IndexedDB, on this device only
   ========================================================= */
const DB_NAME = 'northstar', DB_STORE = 'kv';
function idb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(DB_STORE);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function dbGet(k) { const d = await idb(); return new Promise((res, rej) => { const t = d.transaction(DB_STORE).objectStore(DB_STORE).get(k); t.onsuccess = () => res(t.result); t.onerror = () => rej(t.error); }); }
async function dbPut(k, v) { const d = await idb(); return new Promise((res, rej) => { const t = d.transaction(DB_STORE, 'readwrite'); t.objectStore(DB_STORE).put(v, k); t.oncomplete = () => res(); t.onerror = () => rej(t.error); }); }

const local = {
  get(k, d) { try { const v = localStorage.getItem('ns.' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('ns.' + k, JSON.stringify(v)); } catch { } },
};

const RUBRIC = [
  ['experience', 'Experience vs must-haves', 35],
  ['role', 'Role and seniority', 20],
  ['location', 'Location', 15],
  ['pay', 'Pay vs band', 15],
  ['industry', 'Industry', 10],
  ['timing', 'Hiring timeline', 5],
];
const TAILORED = ['PROFESSIONAL SUMMARY', 'CAREER HIGHLIGHTS', 'CORE COMPETENCIES'];

function blankState() {
  return {
    schema: 3, created_at: now(), updated_at: now(),
    profile: { contact: {}, markets: ['UAE', 'UK'], talent_pool_box: false, current_employer: '' },
    docs: { master_cv: '', playbook: '', rubric: '', search_profile: '', workflow_rules: '' },
    master_versions: [],
    sources: [], answers: [], blocklist: [], jobs: [], packs: [], fills: [], approvals: [], cloud: [], answer_merged: [], gmail: { last_checked: '', suggestions: [] },
    interviews: [], runs: [], reports: [], knockouts_counted: 0, last_cleanup: '',
  };
}

let S = null;
let saveTimer = null;
let baseAt = null; // the saved version this tab's data came from
const sizeOf = x => x ? (x.jobs || []).length + (x.packs || []).length + (x.answers || []).length + (x.blocklist || []).length : 0;
function adopt(x) { S = { ...blankState(), ...x }; baseAt = x.updated_at || null; }
// Safety copies: kept in this browser, newest 12, at most one every 20 minutes unless forced.
async function backup(reason, force = false) {
  try {
    const cur = await dbGet('state'); if (!cur || !sizeOf(cur)) return;
    const list = (await dbGet('backups')) || [];
    if (!force && list[0] && Date.now() - Date.parse(list[0].at) < 20 * 60e3) return;
    list.unshift({ at: now(), reason, counts: { roles: (cur.jobs || []).length, packs: (cur.packs || []).length, answers: (cur.answers || []).length, blocklist: (cur.blocklist || []).length }, state: cur });
    await dbPut('backups', list.slice(0, 12));
  } catch (e) { console.warn('backup failed', e); }
}
async function save() {
  clearTimeout(saveTimer);
  // Never overwrite a newer copy saved by another tab or window: reload it instead.
  const cur = await dbGet('state');
  if (cur && baseAt && cur.updated_at !== baseAt) {
    adopt(cur); renderAll();
    toast('Your data was changed in another Northstar tab, so this tab reloaded it. Please repeat your last step.');
    throw Error('stale tab');
  }
  // A save that would drop most of your data keeps a safety copy first.
  if (cur && sizeOf(cur) > 10 && sizeOf(S) < sizeOf(cur) / 2) await backup('before a large change', true);
  S.updated_at = now();
  await dbPut('state', S);
  baseAt = S.updated_at;
  try { bc && bc.postMessage({ type: 'changed', at: S.updated_at }); } catch { }
}
const bc = 'BroadcastChannel' in window ? new BroadcastChannel('northstar') : null;
if (bc) bc.onmessage = async e => { if (e.data?.type === 'changed') { const fresh = await dbGet('state'); if (fresh && fresh.updated_at !== S?.updated_at) { adopt(fresh); renderAll(); } } };

/* =========================================================
   Helpers
   ========================================================= */
function now() { return new Date().toISOString(); }
function uid(p = '') { return p + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
const $ = id => document.getElementById(id);
const attr = esc;
function fmtDate(s, withTime = true) { if (!s) return ''; const d = new Date(s); if (isNaN(d)) return s; return d.toLocaleString('en-GB', withTime ? { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' } : { day: 'numeric', month: 'short', year: 'numeric' }); }
function lines(v) { return Array.isArray(v) ? v.filter(Boolean) : (v ? String(v).split(/\n+/).map(x => x.trim()).filter(Boolean) : []); }
function words(t) { return String(t || '').trim().split(/\s+/).filter(Boolean).length; }
function hash(s) { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); } return (h >>> 0).toString(16).padStart(8, '0'); }
function norm(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }
function slug(s) { return String(s || '').replace(/[^\w.-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, ''); }
function download(name, text, type = 'text/plain;charset=utf-8') { const b = new Blob([text], { type }), a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 5000); }
function toast(t) { const x = $('toast'); x.textContent = t; x.classList.add('show'); clearTimeout(window._toast); window._toast = setTimeout(() => x.classList.remove('show'), 5000); }
function busy(text) { const b = $('busy'); if (!text) { b.classList.remove('show'); return; } $('busy-text').textContent = text; b.classList.add('show'); }
const jobsBy = () => Object.fromEntries(S.jobs.map(j => [j.id, j]));
const job = id => S.jobs.find(j => j.id === id);
let activeMarket = local.get('market', 'all');
const visible = j => activeMarket === 'all' || (j && j.market === activeMarket);

function fitBand(n) { return n >= 85 ? 5 : n >= 70 ? 4 : n >= 55 ? 3 : n >= 40 ? 2 : 1; }
function scoreOf(b) { return RUBRIC.reduce((s, [k, , max]) => s + Math.max(0, Math.min(max, +b?.[k] || 0)), 0); }
function computeFit(b, { adjacent, knockout } = {}) { const n = scoreOf(b); let f = fitBand(n); if (adjacent) f = Math.max(1, f - 1); if (knockout) f = 1; return { score: n, fit: f }; }

function packsOf(jid) { return S.packs.filter(p => p.job_id === jid).sort((a, b) => a.version - b.version); }
function latestPack(jid) { const p = packsOf(jid); return p[p.length - 1] || null; }
function approvedPack(jid) { return packsOf(jid).filter(p => p.status === 'approved').pop() || null; }
function activeFill(jid) { return S.fills.find(f => f.job_id === jid && !['cancelled', 'done'].includes(f.status)) || null; }
function approvalFor(jid) { const p = approvedPack(jid); return p && S.approvals.find(a => a.job_id === jid && a.pack_id === p.id && !a.used_at); }

const STAGES_PIPE = ['shortlisted', 'drafting', 'review', 'application', 'submitted', 'interview', 'closed'];
function statusOf(j) {
  const p = latestPack(j.id), f = activeFill(j.id);
  switch (j.stage) {
    case 'shortlisted': return 'Shortlisted';
    case 'drafting': return 'Drafting pack';
    case 'review': return !p ? 'No draft yet' : (p.change_requests || []).length ? 'Changes requested' : 'Ready to review';
    case 'application':
      if (approvalFor(j.id)) return 'Submit approved';
      if (!f) return 'Approved to fill';
      if (f.status === 'pending') return 'Fill queued';
      if (f.status === 'sent') return 'Filling';
      if (f.status === 'needs_you' || f.status === 'blocked') return 'Needs you';
      return 'Filled · check it';
    case 'submitted': return 'Submitted';
    case 'interview': return j.outcome === 'Offer' ? 'Offer' : 'Interview';
    case 'closed': return ['Rejected', 'Withdrawn'].includes(j.outcome) ? j.outcome : 'Closed';
    case 'discovery': return 'In discovery';
    case 'archived': return 'Archived';
    default: return j.stage;
  }
}
/* ----- Manual status changes (never unlock Submit) ----- */
const MANUAL_STATUS = [['Shortlisted', 'shortlisted', ''], ['Applied', 'submitted', ''], ['Interview', 'interview', ''], ['Offer', 'interview', 'Offer'], ['Rejected', 'closed', 'Rejected'], ['Withdrawn', 'closed', 'Withdrawn'], ['Closed', 'closed', '']];
function manualLabel(j) { const s = statusOf(j); return s === 'Submitted' ? 'Applied' : MANUAL_STATUS.some(([l]) => l === s) ? s : ''; }
function statusMenu(j) {
  const cur = manualLabel(j);
  return `<select class="stsel" data-statusjob="${attr(j.id)}" aria-label="Change status of ${attr(j.company + ' ' + j.role)}">${cur ? '' : `<option value="" selected disabled>${esc(statusOf(j))}</option>`}${MANUAL_STATUS.map(([l]) => `<option ${l === cur ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
}
async function setManualStatus(id, label, date, note) {
  const j = job(id), m = MANUAL_STATUS.find(([l]) => l === label); if (!j || !m) return;
  const from = statusOf(j); if (manualLabel(j) === label && !note) { toast('It already has that status'); return; }
  await backup('before changing a status', true);
  const day = date || now().slice(0, 10);
  const [, stage, outcome] = m;
  j.history ||= []; j.history.push({ at: now(), date: day, from, to: label, note: note || '', manual: true });
  j.stage = stage;
  if (outcome) j.outcome = outcome; else if (['Offer', 'Rejected', 'Withdrawn'].includes(j.outcome) && label !== 'Closed') delete j.outcome;
  if (label === 'Shortlisted' && !j.shortlisted_at) j.shortlisted_at = day;
  if (label === 'Applied' && !j.submitted_at) j.submitted_at = day;
  if (stage === 'closed') j.closed_at = day;
  // A manual change never unlocks Submit: any unused Submit approval for this role is withdrawn and the extension relocks.
  for (const a of S.approvals.filter(a => a.job_id === id && !a.used_at)) { a.used_at = now(); a.revoked = 'manual status change'; }
  for (const f of S.fills.filter(f => f.job_id === id && !['cancelled', 'done'].includes(f.status))) { f.status = 'cancelled'; f.updated_at = now(); extSend({ type: 'clear', fill_id: f.id }); }
  j.updated_at = now();
  await save(); renderAll(); toast(`${j.company}: ${from} → ${label}. Its packs are kept.`);
}
function openStatusForm(id) {
  const j = job(id); if (!j) return;
  formModal({ eyebrow: `${j.company} · ${j.role}`, title: 'Change status', copy: `Now: ${manualLabel(j) || statusOf(j)}. Packs are kept, and this never approves Submit.`, saveLabel: 'Change status',
    fields: [{ id: 'st', label: 'New status', type: 'select', options: MANUAL_STATUS.map(([l]) => l), value: manualLabel(j) || 'Applied' }, { id: 'date', label: 'Date', type: 'date', value: now().slice(0, 10) }, { id: 'note', label: 'Note (optional)', type: 'textarea', rows: 2, value: '' }],
    onSave: async v => { await setManualStatus(id, v.st, v.date, v.note.trim()); } });
}
document.addEventListener('change', e => { const t = e.target; if (t && t.dataset && t.dataset.statusjob) setManualStatus(t.dataset.statusjob, t.value, '', ''); });
/* ----- Check Gmail: labels matching emails (in the runner or a Claude chat) and suggests status changes here ----- */
const GMAIL_LABEL = 'Job Applications';
const GMAIL_TO = { submitted: 'Applied', interview: 'Interview', rejected: 'Rejected' };
const GMAIL_WORD = { submitted: 'Application received', interview: 'Interview invitation', rejected: 'Not moving forward' };
function gmailRoles() { return S.jobs.filter(j => ['shortlisted', 'drafting', 'review', 'application', 'submitted', 'interview'].includes(j.stage)).map(j => ({ id: j.id, company: j.company, role: j.role, status: statusOf(j) })); }
function checkGmail() {
  const roles = gmailRoles(); if (!roles.length) { toast('No open applications to check for'); return; }
  S.gmail ||= { last_checked: '', suggestions: [] };
  const last = S.gmail.last_checked ? Date.parse(S.gmail.last_checked) || 0 : 0;
  const sinceDays = last ? Math.min(60, Math.max(2, Math.ceil((Date.now() - last) / 864e5) + 2)) : 45;
  const prompt = AI.chatPrompt(AI.gmailPrompt({ roles, sinceDays, label: GMAIL_LABEL }));
  chatHandoff({ eyebrow: 'Gmail', title: 'Check Gmail with Claude chat', cloudTitle: 'Check Gmail', note: 'Use a Claude chat with the Gmail connector switched on.', prompt,
    onReply: async text => { applyGmail(text, now()); await save(); renderAll(); }, cloud: { kind: 'gmail', ref: {}, title: 'Check Gmail' } });
}
function applyGmail(text, at) {
  const res = AI.extractJson(text); S.gmail ||= { last_checked: '', suggestions: [] };
  let n = 0, same = 0;
  for (const e of res.emails || []) {
    const j = job(e.job_id), to = GMAIL_TO[e.kind];
    if (!j || !to || !e.thread_id || S.gmail.suggestions.some(x => x.thread_id === e.thread_id && x.kind === e.kind)) continue;
    const s = { id: uid('g'), thread_id: String(e.thread_id).slice(0, 40), job_id: j.id, kind: e.kind, date: String(e.date || '').slice(0, 10), why: String(e.why || '').slice(0, 90), labelled: !!e.labelled, status: 'new', at: now() };
    if (manualLabel(j) === to) { s.status = 'same'; same++; } else n++;
    S.gmail.suggestions.unshift(s);
  }
  S.gmail.suggestions = S.gmail.suggestions.slice(0, 200);
  S.gmail.last_checked = at || now();
  toast(n ? `${n} suggested status change${n > 1 ? 's' : ''} from Gmail. See From Gmail on Home.` : `Gmail checked: nothing new${same ? ` (${same} email${same > 1 ? 's' : ''} matched a status you already have)` : ''}.`);
}
function renderGmail() {
  const box = $('gmail-card'); if (!box) return;
  const list = (S.gmail?.suggestions || []).filter(x => x.status === 'new' && job(x.job_id)).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  box.hidden = !list.length;
  $('gmail-list').innerHTML = list.map(x => { const j = job(x.job_id); return `<div class="listrow"><span style="min-width:0"><b>${esc(j.company)}</b> · ${esc(j.role)}<br><span class="tiny">${esc(GMAIL_WORD[x.kind])}${x.date ? ' · ' + esc(fmtDate(x.date, false)) : ''}${x.why ? ' · ' + esc(x.why) : ''} · now ${esc(statusOf(j))}</span></span><span style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end"><a class="btn sm" href="https://mail.google.com/mail/u/0/#all/${encodeURIComponent(x.thread_id)}" target="_blank" rel="noopener noreferrer">Email ↗</a><button class="btn sm primary" data-act="gmailAccept" data-arg="${attr(x.id)}">Set ${esc(GMAIL_TO[x.kind])}</button><button class="btn sm" data-act="gmailDismiss" data-arg="${attr(x.id)}">Dismiss</button></span></div>`; }).join('');
}
function statusClass(s) {
  if (['Ready to review', 'Changes requested', 'Needs you', 'No draft yet', 'Fill queued'].includes(s)) return 'amber';
  if (['Interview', 'Filling', 'Drafting pack'].includes(s)) return 'blue';
  if (['Approved', 'Approved to fill', 'Submit approved', 'Filled · check it', 'Shortlisted'].includes(s)) return 'green';
  if (s === 'Closed') return 'red';
  return 'gray';
}
const badge = s => `<span class="tag badge ${statusClass(s)}">${esc(s)}</span>`;
const fitCell = j => j.fit ? `<div class="fit">${j.fit}<div class="fitbar"><i style="width:${j.fit * 20}%"></i></div></div>` : '<span class="tiny">—</span>';

function apiKey() { const k = local.get('api_key', ''); return /^sk-ant-oat/.test(k) ? '' : k; }
function model() { return local.get('model', AI.DEFAULT_MODEL); }
function docs() { return S.docs; }

/* =========================================================
   CV and letter composition
   ========================================================= */
function splitSections(md) {
  const out = { head: [], order: [], body: {} };
  let cur = null;
  for (const ln of String(md || '').split('\n')) {
    const m = ln.match(/^##\s+(.+?)\s*$/);
    if (m) { cur = m[1].trim(); out.order.push(cur); out.body[cur] = []; continue; }
    (cur ? out.body[cur] : out.head).push(ln);
  }
  return out;
}
function composeCV(sections, market) {
  const sp = splitSections(S.docs.master_cv);
  let head = sp.head.slice();
  const uae = sp.body['UAE HEADER'];
  if (market === 'UAE' && uae) {
    const contact = uae.find(l => l.includes('@')), status = uae.find(l => /^\*[^*]/.test(l.trim()));
    head = head.map(l => (contact && l.includes('@')) ? contact : (status && /^\*[^*]/.test(l.trim())) ? status : l);
  }
  let md = head.join('\n').trim() + '\n';
  for (const name of sp.order) {
    if (name === 'UAE HEADER') continue;
    const body = TAILORED.includes(name) && sections && sections[name] != null ? sections[name] : sp.body[name].join('\n');
    md += `\n## ${name}\n${String(body).trim()}\n`;
  }
  return md;
}
function letterDoc(pack) {
  const c = S.profile.contact || {}, j = job(pack.job_id) || {};
  const name = [c.first_name, c.last_name].filter(Boolean).join(' ');
  const contact = j.market === 'UAE' && c.contact_line_uae ? c.contact_line_uae : (c.contact_line || [c.city, c.phone, c.email].filter(Boolean).join(' · '));
  return `# ${name}\n${contact}\n\n${fmtDate(pack.created_at, false)}\n\n**${j.company || ''} · ${j.role || ''}**\n\n${pack.cl_md || ''}`;
}

/* =========================================================
   Navigation
   ========================================================= */
const PAGE_NAMES = { home: 'Home', discovery: 'Discovery', review: 'Review', application: 'Application', interview: 'Interview', profile: 'Career profile' };
let currentPage = 'home';
function go(page) {
  currentPage = page;
  document.querySelectorAll('.page').forEach(x => x.classList.toggle('on', x.id === 'page-' + page));
  document.querySelectorAll('[data-page]').forEach(x => x.classList.toggle(x.closest('#nav') ? 'active' : 'on', x.dataset.page === page));
  $('crumb').textContent = PAGE_NAMES[page];
  local.set('page', page);
  renderPage(page);
  window.scrollTo({ top: 0 });
}
document.querySelectorAll('[data-page]').forEach(b => b.addEventListener('click', () => go(b.dataset.page)));
document.querySelectorAll('[data-market]').forEach(b => b.addEventListener('click', () => { activeMarket = b.dataset.market; local.set('market', activeMarket); renderAll(); }));
['f-q', 'f-status', 'f-fit'].forEach(id => $(id).addEventListener('input', () => renderHome()));

// One delegated click handler: data-act="name" data-arg="value"
document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (!el || el.disabled) return;
  const fn = ACT[el.dataset.act];
  if (!fn) return;
  if (el.tagName !== 'INPUT') e.preventDefault();
  fn(el.dataset.arg, el, e);
});

/* =========================================================
   Modal
   ========================================================= */
function openModal(html, size = '') {
  const box = $('modal-box');
  box.className = 'modal ' + size;
  box.innerHTML = html;
  $('modal').classList.add('show');
  const f = box.querySelector('input,textarea,select');
  if (f && window.innerWidth > 720) setTimeout(() => f.focus(), 30);
}
function closeModal() { $('modal').classList.remove('show'); $('modal-box').innerHTML = ''; }
$('modal').addEventListener('click', e => { if (e.target.id === 'modal') closeModal(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && $('modal').classList.contains('show')) closeModal(); });
function confirmBox(title, copy, okLabel = 'Confirm') {
  return new Promise(res => {
    openModal(`<h2>${esc(title)}</h2><p>${esc(copy)}</p><div class="modalfoot"><button class="btn" id="cb-no">Cancel</button><button class="btn primary" id="cb-yes">${esc(okLabel)}</button></div>`);
    $('cb-no').onclick = () => { closeModal(); res(false); };
    $('cb-yes').onclick = () => { closeModal(); res(true); };
  });
}
// Generic form modal. fields: {id,label,type,value,options,rows,full,placeholder}
function formModal({ eyebrow = '', title, copy = '', fields, saveLabel = 'Save', size = '', extra = '', onSave }) {
  const f = fields.map(x => {
    const id = 'ff-' + x.id;
    const full = x.full || x.type === 'textarea' || x.type === 'checkbox' ? ' full' : '';
    if (x.type === 'textarea') return `<div class="formfield${full}"><label for="${id}">${esc(x.label)}</label><textarea id="${id}" rows="${x.rows || 5}" placeholder="${attr(x.placeholder || '')}">${esc(x.value || '')}</textarea></div>`;
    if (x.type === 'select') return `<div class="formfield${full}"><label for="${id}">${esc(x.label)}</label><select id="${id}">${x.options.map(o => { const [v, l] = Array.isArray(o) ? o : [o, o]; return `<option value="${attr(v)}" ${String(v) === String(x.value) ? 'selected' : ''}>${esc(l)}</option>`; }).join('')}</select></div>`;
    if (x.type === 'checkbox') return `<label class="checkline full"><input type="checkbox" id="${id}" ${x.value ? 'checked' : ''}> ${esc(x.label)}</label>`;
    if (x.type === 'file') return `<div class="formfield${full}"><label for="${id}">${esc(x.label)}</label><input type="file" id="${id}" accept="${attr(x.accept || '')}"></div>`;
    return `<div class="formfield${full}"><label for="${id}">${esc(x.label)}</label><input id="${id}" type="${x.type || 'text'}" value="${attr(x.value ?? '')}" placeholder="${attr(x.placeholder || '')}"></div>`;
  }).join('');
  openModal(`<div class="eyebrow">${esc(eyebrow)}</div><h2>${esc(title)}</h2>${copy ? `<p>${esc(copy)}</p>` : ''}<div class="formgrid">${f}</div><div class="modalfoot">${extra}<button class="btn" data-act="closeModal">Cancel</button><button class="btn primary" id="ff-save">${esc(saveLabel)}</button></div>`, size);
  $('ff-save').onclick = async () => {
    const v = {};
    fields.forEach(x => { const el = $('ff-' + x.id); v[x.id] = x.type === 'checkbox' ? el.checked : x.type === 'file' ? el.files[0] : el.value; });
    const r = await onSave(v);
    if (r !== false) closeModal();
  };
}
// Formatted document viewer with a PDF button
function docModal({ title, md, filename, kind = 'doc', eyebrow = '' }) {
  openModal(`<div class="eyebrow">${esc(eyebrow)}</div><div class="panel-head"><h2 style="margin:0">${esc(title)}</h2><div class="actions" style="margin:0"><button class="btn sm" id="dm-pdf">⇩ PDF</button><button class="btn sm" data-act="closeModal">Close</button></div></div><div class="paper tall ${kind === 'letter' ? 'letter' : ''}" style="margin:0">${mdToHtml(md)}</div>`, 'wide');
  $('dm-pdf').onclick = () => savePdf(md, filename, { title, kind });
}

/* =========================================================
   Rendering
   ========================================================= */
function renderAll() {
  document.querySelectorAll('[data-market]').forEach(b => b.classList.toggle('on', b.dataset.market === activeMarket));
  $('n-discovery').textContent = S.jobs.filter(j => j.stage === 'discovery').length;
  $('n-review').textContent = S.jobs.filter(j => j.stage === 'review' || j.stage === 'drafting').length;
  $('n-application').textContent = S.jobs.filter(j => j.stage === 'application').length;
  $('n-interview').textContent = S.interviews.filter(i => !i.finished).length;
  setStatus();
  renderPage(currentPage);
}
function renderPage(p) {
  if (!S) return;
  ({ home: renderHome, discovery: renderDiscovery, review: renderReview, application: renderApps, interview: renderInterviews, profile: renderProfile })[p]?.();
}
function setStatus() {
  $('st-ext').innerHTML = `<span class="dot ${ext.ready ? 'ok' : ''}"></span>Chrome extension: ${ext.ready ? 'connected' + (ext.version ? ' · v' + esc(ext.version) : '') : isMobile() ? 'desktop only' : 'not connected'}`;
  $('st-ai').innerHTML = `<span class="dot ${apiKey() ? 'ok' : ''}"></span>Assistant: ${apiKey() ? 'ready' : 'not set up'}`;
}
function isMobile() { return /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent); }

/* ---------- Home ---------- */
let homeShowAll = false;
function renderHome() {
  const q = $('f-q').value.toLowerCase(), st = $('f-status').value, fit = +$('f-fit').value || 0;
  const pipe = S.jobs.filter(j => STAGES_PIPE.includes(j.stage) && visible(j));
  const statuses = [...new Set(pipe.map(statusOf))];
  const sel = $('f-status');
  const want = '<option value="">All open stages</option>' + statuses.map(s => `<option ${s === st ? 'selected' : ''}>${esc(s)}</option>`).join('');
  if (sel.innerHTML !== want) sel.innerHTML = want;
  const order = s => STAGES_PIPE.indexOf(s);
  const rows = pipe.filter(j => (st ? statusOf(j) === st : j.stage !== 'closed') && (!q || norm(j.company + ' ' + j.role).includes(norm(q))) && (!fit || (j.fit || 0) >= fit))
    .sort((a, b) => order(a.stage) - order(b.stage) || (b.fit || 0) - (a.fit || 0));
  $('home-count').textContent = rows.length;
  const shown = homeShowAll ? rows : rows.slice(0, 10);
  $('home-rows').innerHTML = rows.length ? `<div class="rowhead"><div>Role</div><div class="c-loc">Location</div><div class="c-fit">Fit</div><div>Status</div><div></div></div>` + shown.map(j => {
    const s = statusOf(j);
    return `<div class="rowitem"><div><div class="role"><a href="#" data-act="openJob" data-arg="${attr(j.id)}" style="color:inherit;text-decoration:none">${esc(j.role)}</a></div><div class="org">${esc(j.company)}${j.industry ? ' · ' + esc(j.industry) : ''}</div></div><div class="c-loc tiny" style="font-size:14px">${esc(j.location || '')}</div><div class="c-fit">${fitCell(j)}</div><div class="status">${statusMenu(j)}</div><div class="act">${nextButton(j, s)}</div></div>`;
  }).join('') + (rows.length > 10 ? `<div class="showall"><button class="btn sm" data-act="toggleHomeAll">${homeShowAll ? 'Show fewer' : `Show all ${rows.length}`}</button></div>` : '')
    : `<div class="empty">No approved roles yet. Add a role or run a search, then add the ones you like to your shortlist in Discovery.</div>`;

  const all = S.jobs.filter(visible);
  $('s-short').textContent = all.filter(j => ['shortlisted', 'drafting', 'review', 'application', 'submitted', 'interview'].includes(j.stage)).length;
  $('s-strong').textContent = all.filter(j => ['shortlisted', 'drafting', 'review', 'application', 'submitted', 'interview'].includes(j.stage) && (j.fit || 0) >= 4).length;
  $('s-review').textContent = all.filter(j => j.stage === 'review').length;
  const t0 = Date.now() - 864e5, t1 = Date.now() + 30 * 864e5;
  $('s-int').textContent = S.interviews.filter(i => { const t = Date.parse(i.when_local); return t >= t0 && t <= t1 && visible(job(i.job_id)); }).length;

  // next actions
  const open = all.filter(j => ['review', 'application', 'interview', 'shortlisted'].includes(j.stage));
  const rank = { review: 0, application: 1, interview: 2, shortlisted: 3 };
  open.sort((a, b) => rank[a.stage] - rank[b.stage]);
  const na = open.map(j => {
    const s = statusOf(j);
    const label = { 'Ready to review': 'Review the pack for', 'Changes requested': 'Build a new version for', 'No draft yet': 'Write or draft the pack for', 'Shortlisted': 'Start an application for', 'Approved to fill': 'Fill the form for', 'Needs you': 'Finish what the form needs for', 'Filled · check it': 'Check the filled form for', 'Submit approved': 'Record the submission for', 'Interview': 'Prepare for the interview with', 'Fill queued': 'Send the fill request for' }[s] || 'Open';
    return `<div class="listrow"><span>${esc(label)} <b>${esc(j.company)}</b><br><span class="tiny">${esc(j.role)}</span></span>${badge(s)}</div>`;
  });
  renderGmail();
  $('next-actions').innerHTML = na.length ? collapsible(na, 5, 'next') : '<div class="empty">Nothing waiting for you.</div>';

  // runs with per-market funnel
  const runs = S.runs.filter(r => r.kind === 'search').slice(0, 20);
  renderCloud();
  $('run-list').innerHTML = runs.length ? runs.map((r, i) => runCard(r, i === 0)).join('') : '<div class="empty">No search has been run yet. Press Run search when you want one.</div>';
}
function nextButton(j, s) {
  if (s === 'Shortlisted') return `<button class="btn sm primary" data-act="startApplication" data-arg="${attr(j.id)}">Start application</button>`;
  if (['Ready to review', 'Changes requested', 'No draft yet'].includes(s)) return `<button class="btn sm" data-act="goReview" data-arg="${attr(j.id)}">Review</button>`;
  if (j.stage === 'application') return `<button class="btn sm" data-act="go" data-arg="application">Open</button>`;
  if (s === 'Interview') return `<button class="btn sm" data-act="go" data-arg="interview">Prep</button>`;
  return `<button class="btn sm" data-act="openJob" data-arg="${attr(j.id)}">Details</button>`;
}
const collapseState = {};
function collapsible(items, n, key) {
  if (items.length <= n) return items.join('');
  const open = collapseState[key];
  return (open ? items : items.slice(0, n)).join('') + `<div class="showall"><button class="btn sm" data-act="toggleCollapse" data-arg="${key}">${open ? 'Show fewer' : `Show all ${items.length}`}</button></div>`;
}
function runCard(r, open) {
  const label = { running: 'Running…', done: 'Completed', blocked: 'Not run', failed: 'Failed' }[r.status] || r.status;
  const mk = Object.entries(r.funnel || {});
  const fun = mk.map(([m, f]) => {
    const top = Math.max(1, f.looked_at || 0);
    const steps = [
      ['Looked at', f.looked_at || 0],
      ['After duplicates and tracked roles', (f.looked_at || 0) - (f.duplicates || 0)],
      ['After blocklist', (f.looked_at || 0) - (f.duplicates || 0) - (f.blocked || 0)],
      ['After knock-outs (fit 1)', (f.looked_at || 0) - (f.duplicates || 0) - (f.blocked || 0) - (f.knockout || 0)],
      ['Saved to Discovery (fit 3+)', f.saved || 0],
    ];
    const reasons = Object.entries(f.knockout_reasons || {}).sort((a, b) => b[1] - a[1]);
    return `<div style="margin-top:10px"><b>${esc(m)}</b><div class="funnel">${steps.map(([l, v]) => `<div class="fstep"><div class="fbar"><i style="width:${Math.max(0, v) / top * 100}%"></i><span>${esc(l)}</span></div><b>${Math.max(0, v)}</b></div>`).join('')}</div>
      <div class="tiny">Dropped: ${f.duplicates || 0} duplicate or already tracked · ${f.blocked || 0} blocklist · ${f.knockout || 0} knock-out · ${f.archived || 0} fit 2 archived</div>
      ${reasons.length ? `<details class="more"><summary>Knock-out reasons</summary><ul class="bullets gap">${reasons.map(([k, v]) => `<li>${esc(k)}: ${v}</li>`).join('')}</ul></details>` : ''}</div>`;
  }).join('');
  return `<details class="more" ${open ? 'open' : ''} style="border-top:1px solid var(--line);padding:6px 0"><summary><span class="runhead" style="display:inline-flex;width:calc(100% - 20px)"><span>${esc((r.markets || []).join(' + '))} · ${fmtDate(r.started_at)}</span><span class="tag ${r.status === 'done' ? 'green' : r.status === 'running' ? 'blue' : 'amber'}">${label}</span></span></summary>
   <div class="tiny" style="margin:4px 0">${esc(r.summary || '')}</div>${fun}
   </details>`;
}

/* ---------- Discovery ---------- */
function renderDiscovery() {
  const rows = S.jobs.filter(j => j.stage === 'discovery' && visible(j)).sort((a, b) => (b.fit_score || 0) - (a.fit_score || 0));
  const arch = S.jobs.filter(j => j.stage === 'archived' && visible(j));
  const byMarket = {};
  rows.forEach(j => (byMarket[j.market || 'Other'] = byMarket[j.market || 'Other'] || []).push(j));
  const groups = Object.entries(byMarket).map(([m, list]) => group(`${m} roles to approve or dismiss`, list.length, collapsible(list.map(jobCard), 10, 'disc-' + m), true)).join('');
  $('discovery-list').innerHTML = (groups || `<div class="card empty">No roles waiting. Press Run search, or Add role with a job link.</div>`)
    + (arch.length ? group('Screened out', arch.length, arch.map(j => `<div class="listrow"><span><b>${esc(j.company)}</b> · ${esc(j.role)}<br><span class="tiny">Fit ${j.fit} · ${esc(j.reason || lines(j.gaps)[0] || '')}</span></span><button class="btn sm" data-act="openJob" data-arg="${attr(j.id)}">Details</button></div>`).join(''), false) : '');
  $('rubric-meters').innerHTML = RUBRIC.map(([k, n, max]) => `<div class="meter"><span>${n}</span><div class="meterbar"><i style="width:${max / 35 * 100}%"></i></div><b>${max}</b></div>`).join('');
  $('ko-count').textContent = `Knock-outs counted, not saved: ${S.knockouts_counted || 0}. 85+ = fit 5 · 70 = 4 · 55 = 3 · 40 = 2.`;
  const on = S.sources.filter(s => s.enabled);
  $('src-summary').innerHTML = on.length ? `${on.length} of ${S.sources.length} sources switched on: ${on.map(s => esc(s.name)).join(', ')}` : 'No sources switched on yet.';
}
function group(title, count, body, open) {
  return `<details class="group" ${open ? 'open' : ''}><summary>${esc(title)} <span class="count">${count}</span></summary><div class="gbody">${body}</div></details>`;
}
function jobCard(j) {
  const gaps = lines(j.gaps);
  return `<article class="jobcard"><div class="jobtop"><div><div class="eyebrow">${esc(j.market || '')}${j.industry ? ' · ' + esc(j.industry) : ''}${j.source ? ' · ' + esc(j.source) : ''}</div><h3>${esc(j.role)}</h3><div class="jobmeta">${esc(j.company)} · ${esc(j.location || '')}${j.deadline ? ' · closes ' + esc(j.deadline) : ''}${j.salary ? ' · ' + esc(j.salary) : ''}</div></div><div class="scorebig">${j.fit}<small>/5</small></div></div>
   <p>${esc(lines(j.evidence).slice(0, 2).join(' · '))}</p>
   <div class="chips"><span class="tag ${j.fit >= 4 ? 'green' : 'amber'}">${j.fit >= 4 ? 'Strong match' : 'Needs a closer look'}</span>${gaps.length ? `<span class="tag amber">${gaps.length} open question${gaps.length > 1 ? 's' : ''}</span>` : ''}${j.low_confidence ? '<span class="tag gray">Low confidence</span>' : ''}</div>
   <div class="actions"><button class="btn sm" data-act="openJob" data-arg="${attr(j.id)}">Why this score</button><button class="btn sm primary" data-act="shortlist" data-arg="${attr(j.id)}">Add to shortlist</button><button class="btn sm danger" data-act="dismiss" data-arg="${attr(j.id)}">Dismiss</button>${j.job_url ? `<a class="btn sm link" href="${attr(safeUrl(j.job_url))}" target="_blank" rel="noopener noreferrer">Listing ↗</a>` : ''}</div></article>`;
}
function safeUrl(u) { try { const x = new URL(u); return /^https?:$/.test(x.protocol) ? x.href : '#'; } catch { return '#'; } }

/* ---------- Review ---------- */
const reviewUI = {}; // per pack: {read, open, doc}
function renderReview() {
  const list = S.jobs.filter(j => ['drafting', 'review', 'application', 'submitted', 'interview'].includes(j.stage) && visible(j));
  const waiting = list.filter(j => j.stage === 'review' || j.stage === 'drafting');
  const approved = list.filter(j => approvedPack(j.id) && !['review', 'drafting'].includes(j.stage));
  const fixable = fixAllRoles();
  $('review-list').innerHTML = (fixable.length ? `<div class="notice" style="display:flex;gap:12px;align-items:center;justify-content:space-between;flex-wrap:wrap;margin-bottom:12px"><span>${fixable.length === 1 ? '1 role has' : fixable.length + ' roles have'} changes or answered claims waiting for a new version.</span><button class="btn primary" data-act="fixAll">Fix all</button></div>` : '') + group('Waiting for your review', waiting.length, waiting.map(reviewCard).join('') || '<div class="empty">No packs waiting. Press Start application on a shortlisted role.</div>', true)
    + (approved.length ? group('Approved versions', approved.length, approved.map(reviewCard).join(''), false) : '');
  document.querySelectorAll('details.rcard').forEach(d => d.addEventListener('toggle', () => { const k = d.dataset.job; reviewUI[k] = reviewUI[k] || {}; reviewUI[k].open = d.open; }));
}
function fixAllRoles() { return S.jobs.filter(j => j.stage === 'review' && visible(j) && needsFix(latestPack(j.id))); }
function fixWhat(p) { const n = (p.change_requests || []).length, c = freshClaims(p).length; return [n ? `${n} change${n > 1 ? 's' : ''}` : '', c ? `${c} answered claim${c > 1 ? 's' : ''}` : ''].filter(Boolean).join(' · '); }
function openFixAll() {
  const roles = fixAllRoles();
  if (!roles.length) { toast('No role has changes or answered claims waiting'); return; }
  if (!S.docs.master_cv) { toast('Import your setup file first (Career profile › Data & connections)'); return; }
  const canCloud = ext.ready && ext.runner;
  const list = roles.map(j => { const p = latestPack(j.id); return `<label class="checkline checkline-row" style="align-items:flex-start"><input type="checkbox" class="fx-pick" value="${attr(j.id)}" checked> <span><b>${esc(j.company)}</b> · ${esc(j.role)} · v${esc(p.version)}<br><span class="tiny">${esc(fixWhat(p))}</span></span></label>`; }).join('');
  openModal(`<div class="eyebrow">Review</div><h2>Fix all</h2><p>Each ticked role gets a new version that uses your change requests and claim answers. Untick any you want to leave for now.</p>${list}
   <p class="tiny">Nothing is approved for you: each new version waits in Review for you to read and approve.</p>
   ${canCloud ? `<div class="actions"><button class="btn primary" id="fx-go" style="font-size:16px;padding:12px 22px">Send to Northstar runner</button></div><p class="tiny">Each role goes as its own request, so one failing doesn't stop the others. Each takes 5–10 minutes.</p>`
      : `<div class="notice">Your Northstar runner isn't connected in this browser, so do these one at a time: press Build new version on each card and use the Claude chat steps.</div>`}
   <div class="modalfoot"><button class="btn" data-act="closeModal">Cancel</button></div>`, 'wide');
  if (!canCloud) return;
  $('fx-go').onclick = async () => {
    const ids = [...document.querySelectorAll('.fx-pick:checked')].map(x => x.value);
    if (!ids.length) { toast('Tick at least one role'); return; }
    $('fx-go').disabled = true;
    let sent = 0; const failed = [];
    for (const id of ids) {
      const j = job(id); $('fx-go').textContent = `Sending ${sent + failed.length + 1} of ${ids.length}…`;
      try { await fireCloud({ kind: 'pack', ref: { job_id: id }, title: `New version · ${j.company}`, prompt: AI.chatPrompt(AI.packPrompt(packArgs(j))) }); sent++; }
      catch (e) { failed.push(`${j.company}: ${e.message}`); }
    }
    closeModal(); renderAll();
    toast(`Sent ${sent} of ${ids.length} to your Northstar runner.` + (failed.length ? ` Not sent: ${failed.join('; ')}. Use Build new version on those cards.` : ' New versions appear in Review as they finish.'));
  };
}
function reviewCard(j) {
  const p = j.stage === 'review' || j.stage === 'drafting' ? latestPack(j.id) : approvedPack(j.id);
  const s = statusOf(j);
  const ui = reviewUI[j.id] || {};
  const head = `<summary><span class="rsum-title">${esc(j.role)} <span>· ${esc(j.company)}${p ? ' · v' + p.version : ''}</span></span><span class="c-fit">${fitCell(j)}</span>${badge(p && p.status === 'approved' ? 'Approved' : s)}</summary>`;
  let body;
  if (j.stage === 'drafting') { const rq = (S.cloud || []).find(r => r.status === 'waiting' && r.kind === 'pack' && r.ref?.job_id === j.id); body = `<p class="tiny"><span class="spin"></span>${rq ? `Your Northstar runner is drafting this pack (sent ${esc(fmtDate(rq.fired_at))}). It usually takes 5–10 minutes.` : 'The assistant is drafting this pack.'}</p>${rq && rq.error ? `<p class="tiny" style="color:var(--amber)">${esc(rq.error)}</p>` : ''}<div class="actions">${rq && rq.session_url ? `<a class="btn sm" href="${attr(rq.session_url)}" target="_blank" rel="noopener noreferrer">Watch ↗</a>` : ''}<button class="btn sm" data-act="stopDrafting" data-arg="${attr(j.id)}">Stop waiting</button></div>`; }
  else if (!p) body = `<p class="tiny">No draft yet for this role.</p><div class="actions"><button class="btn sm primary" data-act="draftPack" data-arg="${attr(j.id)}">${apiKey() ? 'Draft with the assistant' : 'Copy prompt for Claude'}</button><button class="btn sm" data-act="editDraft" data-arg="${attr(j.id)}">Write it myself</button></div>${apiKey() ? '' : '<p class="tiny">No API key: Northstar gives you a prompt to paste into a Claude chat, then you paste the reply back.</p>'}`;
  else body = packBody(j, p);
  body = `<div class="actions" style="margin:0 0 10px"><a href="#" class="btn sm" data-act="openJob" data-arg="${attr(j.id)}">Role details</a>${j.job_url ? `<a class="btn sm" href="${attr(safeUrl(j.job_url))}" target="_blank" rel="noopener noreferrer">Listing ↗</a>` : ''}</div>` + body;
  return `<details class="rcard" data-job="${attr(j.id)}" ${ui.open ? 'open' : ''}>${head}<div class="rbody">${body}</div></details>`;
}
function packBody(j, p) {
  const q = p.quality || {};
  const approved = p.status === 'approved';
  const claims = p.claims || [];
  const ui = reviewUI[j.id] || {};
  const openClaims = claims.filter(c => c.state === 'open').length;
  const cr = p.change_requests || [];
  const cv = p.cv_md, cl = p.cl_md;
  const score = q.overall != null ? `<div class="scoreline"><span>Editorial check</span><span>Relevance <b>${esc(q.relevance ?? '—')}</b></span><span>Evidence <b>${esc(q.evidence ?? '—')}</b></span><span>Natural <b>${esc(q.natural ?? '—')}</b></span><span>AI-sounding <b>${esc(q.ai_sounding ?? '—')}</b></span><span>Overall <b>${esc(q.overall)}/10</b></span></div>
    <details class="more"><summary>Details</summary><ul class="bullets">${(q.notes || []).map(n => `<li>${esc(n)}</li>`).join('') || '<li>No notes</li>'}</ul>${(p.gaps || []).length ? `<b class="tiny">Gaps</b><ul class="bullets gap">${p.gaps.map(g => `<li>${esc(g)}</li>`).join('')}</ul>` : ''}<p class="tiny">Editorial checks only. Not a hiring prediction or AI detection. AI-sounding: 10 means strongly.</p></details>`
    : `<div class="scoreline"><span>Editorial check</span><span class="tiny">${p.origin === 'old tracker' ? 'Checked in your old tracker (see its Claim check below)' : 'Not scored (written by you)'}</span></div>`;
  const docsHtml = cv == null ? `<div class="notice" style="margin-top:12px">The CV and letter copies were deleted under the document lifecycle. Text answers and outcomes are kept.</div>` :
    `<div class="docs"><div class="docwrap"><div class="dochead"><span>CV ${approved ? '' : 'draft'}</span><span class="actions" style="margin:0"><button class="btn sm" data-act="pdfPack" data-arg="${attr(p.id)}|cv">⇩ PDF</button><button class="btn sm" data-act="viewPack" data-arg="${attr(p.id)}|cv">Open</button></span></div><div class="paper">${mdToHtml(cv)}</div></div>
     <div class="docwrap"><div class="dochead"><span>Cover letter · ${words(cl)} words</span><span class="actions" style="margin:0"><button class="btn sm" data-act="pdfPack" data-arg="${attr(p.id)}|cl">⇩ PDF</button><button class="btn sm" data-act="viewPack" data-arg="${attr(p.id)}|cl">Open</button></span></div><div class="paper letter">${mdToHtml(letterDoc(p))}</div></div></div>`;
  const claimsHtml = approved ? '' : claims.length ? `<div class="claims"><b>Claims to confirm</b> <span class="tiny">${openClaims ? openClaims + ' still open' : 'all answered'}</span>${claims.map((c, i) => claimBox(p, c, i)).join('')}</div>` : `<p class="tiny" style="margin-top:12px">No claim questions were flagged in this draft.</p>`;
  const crHtml = cr.length ? `<div style="margin-top:12px"><b>Your change requests</b><ul class="bullets">${cr.map(c => `<li>${esc(c.note)} <span class="tiny">${fmtDate(c.at)}</span></li>`).join('')}</ul></div>` : '';
  const canApprove = ui.read && !openClaims;
  const actions = approved ? `<div class="actions"><button class="btn sm" data-act="downloadPack" data-arg="${attr(p.id)}">Download Markdown</button><span class="tiny">Approved ${fmtDate(p.approved_at)} · version ${esc(p.hash)}</span></div>`
    : `<label class="checkline checkline-row"><input type="checkbox" data-act="tickRead" data-arg="${attr(j.id)}" ${ui.read ? 'checked' : ''}> I have read this exact CV and cover letter version in full</label>
      <div class="actions"><button class="btn sm" data-act="editDraft" data-arg="${attr(j.id)}">Edit it myself</button><button class="btn sm" data-act="requestChange" data-arg="${attr(p.id)}">${cr.length ? 'Add another change' : 'Request changes'}</button>${needsFix(p) ? `<button class="btn sm primary" data-act="draftPack" data-arg="${attr(j.id)}">${apiKey() ? 'Build new version' : 'New version via Claude chat'}</button>` : ''}<button class="btn sm" data-act="downloadPack" data-arg="${attr(p.id)}">Download drafts</button><button class="btn sm primary" data-act="approvePack" data-arg="${attr(p.id)}" ${canApprove ? '' : 'disabled'}>Approve this version</button></div>
      <div class="tiny" style="margin-top:6px">${canApprove ? '' : 'To approve: answer or tick every claim, and tick that you read it. '}Approval covers version ${esc(p.hash)} only. It does not start form filling or submission.</div>`;
  const notesHtml = (p.notes || []).length ? `<details class="more" style="margin-top:12px"><summary>From your old tracker (${p.notes.length} sections: ${esc(p.notes.map(n => n.heading).join(', '))})</summary>${p.notes.map(n => `<details class="more"><summary>${esc(n.heading)}</summary><div class="paper">${mdToHtml(n.text)}</div></details>`).join('')}</details>` : '';
  return score + docsHtml + claimsHtml + notesHtml + crHtml + actions;
}
function claimBox(p, c, i) {
  const done = c.state !== 'open';
  return `<div class="claim ${done ? 'done' : ''}"><q>${esc(c.question)}</q>${c.why ? `<div class="why">${esc(c.why)}</div>` : ''}
   ${c.state === 'confirmed' ? `<div class="tiny" style="margin-top:6px">✓ Saved as a confirmed answer: ${esc(c.answer)}</div><button class="btn sm link" data-act="claimReopen" data-arg="${attr(p.id)}|${i}">Change</button>`
      : c.state === 'na' ? `<div class="tiny" style="margin-top:6px">✓ Marked as not applying. The next version should not rely on it.</div><button class="btn sm link" data-act="claimReopen" data-arg="${attr(p.id)}|${i}">Undo</button>`
        : `<textarea id="claim-${attr(p.id)}-${i}" placeholder="Type the facts in your own words">${esc(c.answer || '')}</textarea><div class="crow"><button class="btn sm primary" data-act="claimSave" data-arg="${attr(p.id)}|${i}">Save as confirmed answer</button><label class="checkline"><input type="checkbox" data-act="claimNA" data-arg="${attr(p.id)}|${i}"> This doesn't apply to me</label></div>`}</div>`;
}

/* ---------- Applications ---------- */
function renderApps() {
  const cols = [['needs', 'Needs your input'], ['ready', 'Ready to fill'], ['active', 'Filled · check it'], ['submitted', 'Submitted']];
  const all = S.jobs.filter(j => ['application', 'submitted', 'interview'].includes(j.stage) && visible(j));
  const col = j => { if (j.stage !== 'application') return 'submitted'; const f = activeFill(j.id); if (!f || f.status === 'pending') return 'ready'; if (['needs_you', 'blocked'].includes(f.status) || noForm(f)) return 'needs'; return 'active'; };
  $('board').innerHTML = cols.map(([k, t]) => { const r = all.filter(j => col(j) === k); return `<div class="column"><div class="colhead">${t}<span class="tag gray">${r.length}</span></div>${collapsible(r.map(appCard), 6, 'col-' + k) || '<div class="tiny">No roles at this stage.</div>'}</div>`; }).join('');
  $('app-notice').innerHTML = ext.ready
    ? 'Chrome extension connected. Filling opens the employer form in a new tab and fills only confirmed answers and your approved documents. Submit stays locked on that page until you approve this one application here.'
    : isMobile() ? 'Form filling needs Chrome on a computer with the Northstar extension. On this phone you can review, approve and record submissions.'
      : 'Chrome extension not connected. Install it from the extension folder (see README), then reload this page. Fill requests stay queued until then.';
}
// The page opened but nothing was filled or attached: usually a job listing (LinkedIn) where the form only opens after Apply / Easy Apply
const noForm = f => !!f && !['pending', 'sent', 'blocked'].includes(f.status) && !!f.report && !(f.report.filled || []).length && !(f.report.attached || []).length && !(f.report.needs || []).length;
function appCard(j) {
  const f = activeFill(j.id), p = approvedPack(j.id), appr = approvalFor(j.id), rep = f?.report || {};
  let body = '';
  if (j.stage !== 'application') {
    body = j.stage === 'interview' ? `<p>Interview stage.</p><button class="btn sm" data-act="go" data-arg="interview">Open interview</button>`
      : `<p>Submitted ${esc(fmtDate(j.submitted_at, false))}. ${j.receipt ? 'Reference: ' + esc(j.receipt) + (j.receipt_verified ? ' (verified)' : '') : 'No reference recorded.'}</p><div class="actions"><span class="tag gray">${esc(j.outcome || 'Awaiting response')}</span><button class="btn sm" data-act="openInterview" data-arg="${attr(j.id)}">＋ Interview</button><button class="btn sm danger" data-act="closeJob" data-arg="${attr(j.id)}">Mark Closed</button></div>`;
  } else {
    const url = `<input class="field" placeholder="Application form link" value="${attr(j.apply_url || j.job_url || '')}" data-change="applyUrl" data-arg="${attr(j.id)}">`;
    if (!f) body = `<p>Approved pack v${p ? p.version : '?'} is ready. Filling starts only when you choose.</p>${url}<label class="checkline"><input type="checkbox" class="batchpick" value="${attr(j.id)}"> Include in the next batch</label><div class="actions"><button class="btn sm primary" data-act="fillOne" data-arg="${attr(j.id)}">Fill this one now</button></div>`;
    else if (f.status === 'pending') body = `<p>Fill request saved ${fmtDate(f.created_at)}. ${ext.ready ? '' : 'Waiting for the Chrome extension; the form has not been touched.'}</p><div class="actions">${ext.ready ? `<button class="btn sm primary" data-act="sendFill" data-arg="${attr(f.id)}">Send to Chrome</button>` : ''}<button class="btn sm" data-act="cancelFill" data-arg="${attr(f.id)}">Cancel request</button></div>`;
    else if (noForm(f) && !appr) {
      const li = /linkedin\./i.test(rep.url_host || '');
      body = `<p>Opened ${esc(rep.url_host || 'the page')}, but there was no application form on it, so nothing was filled.</p>
       <p class="tiny">${li ? 'A LinkedIn job page has no form until you press <b>Easy Apply</b> or <b>Apply</b>. Press Open in Chrome again, then press that button on the page: Northstar fills the form as it opens, or follows you to the employer\'s site.' : 'Press Open in Chrome again, then press the Apply button on the page: Northstar fills the form as it opens. If you know the direct link to the form, paste it here first.'}</p>${url}
       <div class="actions"><button class="btn sm primary" data-act="sendFill" data-arg="${attr(f.id)}" ${ext.ready ? '' : 'disabled'}>Open in Chrome again</button></div>`;
    }
    else {
      const needs = rep.needs || [];
      body = `<p>${f.status === 'sent' ? 'Sent to Chrome ' + fmtDate(f.updated_at) + '. Waiting for the page report.' : f.status === 'blocked' ? 'Blocked: ' + esc(rep.blocked || 'the page stopped the fill') : `Filled ${(rep.filled || []).length} field(s) on ${esc(rep.url_host || 'the form')}${rep.pages > 1 ? ` across ${rep.pages} pages` : ''}.`}</p>
       ${(rep.steps || []).length ? `<details class="more"><summary>What Northstar did (${rep.steps.length})</summary><ul class="bullets">${rep.steps.slice(-12).map(t => `<li>✓ ${esc(t)}</li>`).join('')}</ul></details>` : ''}
       ${rep.stage === 'final' ? `<p class="tiny"><b>Reached the final page.</b> Check it in Chrome, approve, then press Submit yourself.</p>` : rep.stage === 'blocked' ? `<p class="tiny"><b>Stopped: something needs you.</b> Do it on the page in Chrome, then press Continue application in the Northstar box there.</p>` : ''}
       ${needs.length ? `<b class="tiny">Needs you (${needs.length})</b><ul>${needs.slice(0, 8).map(n => `<li>${esc(n.label)}${n.required ? ' · required' : ''}: ${esc(n.why)}</li>`).join('')}${needs.length > 8 ? `<li>…and ${needs.length - 8} more</li>` : ''}</ul>` : ''}
       ${(rep.attached || []).length ? `<p class="tiny">Attached: ${rep.attached.map(esc).join(', ')}. Check they show on the form.</p>` : ''}
       <div class="actions"><button class="btn sm" data-act="sendFill" data-arg="${attr(f.id)}" ${ext.ready ? '' : 'disabled'}>Open in Chrome again</button>${appr ? `<button class="btn sm primary" data-act="recordSubmitted" data-arg="${attr(j.id)}">I submitted · record confirmation</button>` : `<button class="btn sm primary" data-act="approveSubmit" data-arg="${attr(j.id)}">Approve submit</button>`}</div>
       ${appr ? `<p class="tiny">Submit approved for this application only${appr.source === 'page' ? ' (from the employer page)' : ''}. Press Submit yourself on the employer page, then record the confirmation.</p>` : ''}`;
    }
  }
  return `<article class="application"><b>${esc(j.role)}</b><small>${esc(j.company)} · ${esc(j.location || '')} · Fit ${esc(j.fit || '—')}</small>${body}</article>`;
}
document.addEventListener('change', e => {
  const el = e.target.closest('[data-change]');
  if (el && el.dataset.change === 'applyUrl') { const j = job(el.dataset.arg); j.apply_url = el.value.trim(); j.updated_at = now(); save(); toast('Application link saved'); }
});

/* ---------- Interviews ---------- */
function renderInterviews() {
  const list = S.interviews.filter(i => visible(job(i.job_id))).sort((a, b) => String(a.when_local).localeCompare(String(b.when_local)));
  const up = list.filter(i => !i.finished), done = list.filter(i => i.finished);
  $('interview-list').innerHTML = (up.length ? group('Upcoming and active', up.length, up.map(interviewCard).join(''), true) : '<div class="card empty">No interviews yet. Add one when an invitation arrives.</div>')
    + (done.length ? group('Finished', done.length, done.map(interviewCard).join(''), false) : '');
}
function interviewCard(i) {
  const j = job(i.job_id) || {};
  const d = i.when_local ? new Date(i.when_local) : null, ok = d && !isNaN(d);
  return `<article class="card interview"><div class="interview-head"><div class="datebox">${ok ? d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }).toUpperCase() : 'DATE TBC'}</div><div style="flex:1;min-width:0"><h3>${esc(j.role || '')}</h3><p>${esc(j.company || '')} · ${esc(i.stage || 'Interview')}${i.outcome ? ' · <b>' + esc(i.outcome) + '</b>' : ''}</p><p>${ok ? esc(d.toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })) + ' ' + esc(i.tz || '') : 'Time to confirm'}${i.link ? ` · <a href="${attr(safeUrl(i.link))}" target="_blank" rel="noopener noreferrer">Meeting link ↗</a>` : ''}</p></div></div>
   <details class="more" style="margin-top:10px"><summary>Interview prep ${i.prep_md ? '' : '(empty)'}</summary>${i.prep_md ? `<div class="docwrap" style="margin-top:8px"><div class="dochead"><span>Prep document</span><span class="actions" style="margin:0"><button class="btn sm" data-act="pdfPrep" data-arg="${attr(i.id)}">⇩ PDF</button><button class="btn sm" data-act="viewPrep" data-arg="${attr(i.id)}">Open</button></span></div><div class="paper">${mdToHtml(prepDoc(i))}</div></div>` : '<p class="tiny">No notes yet.</p>'}</details>
   <div class="actions"><button class="btn sm" data-act="openInterview" data-arg="|${attr(i.id)}">Edit</button><button class="btn sm" data-act="draftPrep" data-arg="${attr(i.id)}">${apiKey() ? 'Draft prep notes' : 'Prep notes via Claude chat'}</button><button class="btn sm" data-act="recordOutcome" data-arg="${attr(i.id)}">Record outcome</button></div></article>`;
}
function prepDoc(i) {
  const j = job(i.job_id) || {};
  const d = i.when_local ? fmtDate(i.when_local) : 'Date to confirm';
  return `# ${j.company || ''} · ${j.role || ''}\n*${i.stage || 'Interview'} · ${d} ${i.tz || ''}*\n\n${i.link ? `Meeting link: ${i.link}\n\n` : ''}${i.prep_md || ''}\n${(i.artifacts || []).length ? '\n## Materials\n' + i.artifacts.map(a => '- ' + a).join('\n') : ''}`;
}

/* ---------- Profile ---------- */
let profileTab = 'settings';
document.querySelectorAll('[data-ptab]').forEach(b => b.addEventListener('click', () => { profileTab = b.dataset.ptab; document.querySelectorAll('[data-ptab]').forEach(x => x.classList.toggle('on', x === b)); renderProfile(); }));
const revealed = {};
function renderProfile() {
  const v = $('profile-view'), p = S.profile, c = p.contact || {};
  if (profileTab === 'settings') {
    const mk = m => S.sources.filter(s => s.market === m || (m === 'Both' && s.market === 'Both'));
    v.innerHTML = `<div class="grid2" style="margin-top:0">
     <div class="card panel"><div class="panel-head"><div><h2>Search preferences</h2><small>Run search uses these, only when you press it</small></div></div>
      <div class="formgrid">
       <div class="formfield"><label>Market order (first is priority)</label><input data-pref="markets" value="${attr((p.markets || []).join(', '))}"></div>
       <div class="formfield"><label>Talent-pool / future-jobs box on forms</label><select data-pref="talent_pool_box"><option value="false">Leave unticked</option><option value="true" ${p.talent_pool_box ? 'selected' : ''}>Tick it</option></select></div>
       <div class="formfield"><label>First name</label><input data-contact="first_name" value="${attr(c.first_name || '')}"></div>
       <div class="formfield"><label>Last name</label><input data-contact="last_name" value="${attr(c.last_name || '')}"></div>
       <div class="formfield"><label>Email</label><input data-contact="email" value="${attr(c.email || '')}"></div>
       <div class="formfield"><label>Phone</label><input data-contact="phone" value="${attr(c.phone || '')}"></div>
       <div class="formfield"><label>LinkedIn</label><input data-contact="linkedin" value="${attr(c.linkedin || '')}"></div>
       <div class="formfield"><label>City</label><input data-contact="city" value="${attr(c.city || '')}"></div>
       <div class="formfield"><label>Country</label><input data-contact="country" value="${attr(c.country || '')}"></div>
       <div class="formfield"><label>Current employer</label><input data-pref="current_employer" value="${attr(p.current_employer || '')}"></div>
      </div><div class="actions"><button class="btn primary" data-act="saveProfile">Save preferences</button></div></div>
     <div class="card panel"><div class="panel-head"><div><h2>Search sources <span class="tag gray">${S.sources.filter(s => s.enabled).length} on</span></h2><small>Switch sources on or off. Run search uses only the ones that are on. Never signs in.</small></div><button class="btn sm primary" data-act="editSource">＋ Add source</button></div>
      ${['UAE', 'UK', 'Both'].map(m => { const r = mk(m); return r.length ? group(m === 'Both' ? 'Both markets' : m, r.length, r.map(srcRow).join(''), true) : ''; }).join('') || '<div class="empty">No sources yet.</div>'}
     </div></div>`;
  } else if (profileTab === 'answers') {
    v.innerHTML = `<div class="card panel"><div class="panel-head"><div><h2>Saved answers <span class="tag gray">${S.answers.length}</span></h2><small>Only confirmed answers are used on forms and in packs. Tap an answer to see it in full or edit it.</small></div><button class="btn primary sm" data-act="editAnswer">＋ Add answer</button></div>
     <input class="field search" id="ans-q" placeholder="Search questions and answers" value="${attr(ansQuery)}" style="width:100%;margin-bottom:12px">
     <div id="ans-groups">${answerGroupsHtml()}</div></div>`;
    $('ans-groups').addEventListener('toggle', e => { const t = e.target.dataset?.ansgroup; if (t && !ansQuery) { if (e.target.open) ansOpen.add(t); else ansOpen.delete(t); } }, true);
    $('ans-q').oninput = e => { ansQuery = e.target.value; $('ans-groups').innerHTML = answerGroupsHtml(); };
  } else if (profileTab === 'cv') {
    v.innerHTML = `<div class="card panel"><div class="panel-head"><div><h2>Master CV</h2><small>The source of truth for every pack. Only Summary, Highlights and Competencies are tailored per job.</small></div><div class="actions" style="margin:0"><button class="btn sm" data-act="pdfMaster">⇩ PDF</button><button class="btn sm" data-act="newMaster">New Master CV version</button></div></div>
     <p class="tiny">${S.master_versions.length ? `Current version from ${fmtDate(S.master_versions[0].created_at)}${S.master_versions[0].note ? ' (' + esc(S.master_versions[0].note) + ')' : ''}. Approved packs never change.` : 'From your setup file.'}</p>
     <div class="docwrap"><div class="paper tall">${mdToHtml(S.docs.master_cv || '*No Master CV yet. Import your setup file in Data & connections.*')}</div></div>
     <div class="actions"><button class="btn sm" data-act="openSource" data-arg="playbook">Cover letter playbook</button><button class="btn sm" data-act="openSource" data-arg="search_profile">Search profile</button><button class="btn sm" data-act="openSource" data-arg="rubric">Fit rubric</button><button class="btn sm" data-act="openSource" data-arg="workflow_rules">Workflow rules</button></div></div>`;
  } else if (profileTab === 'blocklist') {
    v.innerHTML = `<div class="card panel"><div class="panel-head"><div><h2>Blocklist <span class="tag gray">${S.blocklist.length}</span></h2><small>Kept out of future searches. Dismissing a role adds it here.</small></div><button class="btn primary sm" data-act="addBlock">＋ Add entry</button></div>
     ${S.blocklist.length ? collapsible(S.blocklist.map(x => `<div class="listrow"><span><b>${esc(x.value)}</b><br><span class="tiny">${esc(x.kind)} · ${esc(x.reason || 'No reason recorded')} · ${esc((x.created_at || '').slice(0, 10))}</span></span><button class="btn sm" data-act="unblock" data-arg="${attr(x.id)}">Remove</button></div>`), 15, 'block') : '<div class="empty">Nothing blocked.</div>'}</div>`;
  } else if (profileTab === 'reports') {
    v.innerHTML = `<div class="card panel"><div class="panel-head"><div><h2>Weekly progress report</h2><small>Covers the seven days ending when you press the button. Uses recorded data only.</small></div><button class="btn primary sm" data-act="makeReport">Make weekly report</button></div>
     ${S.reports.length ? S.reports.map((r, i) => `<details class="group" ${i === 0 ? 'open' : ''}><summary>Week ending ${esc(fmtDate(r.period_end, false))}</summary><div class="gbody"><div class="docwrap"><div class="dochead"><span>Weekly report</span><span class="actions" style="margin:0"><button class="btn sm" data-act="pdfReport" data-arg="${attr(r.id)}">⇩ PDF</button><button class="btn sm" data-act="viewReport" data-arg="${attr(r.id)}">Open</button></span></div><div class="paper">${mdToHtml(r.body_md)}</div></div></div></details>`).join('') : '<div class="empty">No report yet.</div>'}
     <div class="notice" style="margin-top:12px">Nothing is scheduled. Reports never start a search or an email check.</div></div>`;
  } else {
    const key = apiKey();
    v.innerHTML = `<div class="grid2" style="margin-top:0">
     <div class="card panel"><div class="panel-head"><div><h2>Assistant</h2><small>Used by Run search, Add role, Start application and Draft prep notes</small></div><span class="tag ${key ? 'green' : 'amber'}">${key ? 'Ready' : 'Not set up'}</span></div>
      <div class="formgrid"><div class="formfield full"><label>Claude API key (stored only on this device, never exported)</label><input id="api-key" type="password" autocomplete="off" value="${attr(key)}" placeholder="sk-ant-…"></div>
      <div class="formfield"><label>Model</label><select id="api-model">${[['claude-opus-5-5', 'Claude Opus 5.5 (default)'], ['claude-sonnet-5-5', 'Claude Sonnet 5.5']].map(([v, l]) => `<option value="${v}" ${model() === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div></div>
      <div class="actions"><button class="btn primary sm" data-act="saveKey">Save</button>${key ? '<button class="btn sm danger" data-act="clearKey">Remove key</button>' : ''}</div>
      <p class="tiny">Each button sends one request with only what that action needs (for example your Master CV and one job ad). Nothing runs in the background.</p><p class="tiny"><b>No key?</b> Every assistant button still works through your Claude subscription: it gives you a prompt to paste into a Claude chat, and you paste the reply back.</p></div>
     <div class="card panel"><div class="panel-head"><div><h2>Cloud runner</h2><small>Your Northstar routine does assistant steps on your Claude subscription</small></div><span class="tag ${ext.runner && ghRepo() && ghToken() ? 'green' : 'amber'}">${ext.runner && ghRepo() && ghToken() ? 'Ready' : `${[ext.runner, ghRepo(), ghToken()].filter(Boolean).length} of 3 done`}</span></div>
      <ul class="checks" style="list-style:none;padding:0;margin:0 0 10px">
       <li>${ext.runner ? '✅' : '⬜'} <b>Starting runs</b>: ${ext.runner ? 'on, set in the extension menu' : ext.ready ? 'paste the routine\'s Fire URL and token in the <b>extension menu</b> (puzzle icon › Northstar Autofill)' : 'install the Chrome extension first'}</li>
       <li>${ghRepo() ? '✅' : '⬜'} <b>Results repository</b>: ${ghRepo() ? esc(ghRepo()) : 'type it below'}</li>
       <li>${ghToken() ? '✅' : '⬜'} <b>Read-only token</b>: ${ghToken() ? 'saved on this device' : 'paste it below'}</li></ul>
      <div class="formgrid"><div class="formfield"><label>Results repository (owner/name)</label><input id="gh-repo" value="${attr(ghRepo())}" placeholder="e.g. SerenaGall9/northstar-results"></div>
      <div class="formfield"><label>Read-only GitHub token (this device only, never exported)</label><input id="gh-token" type="password" autocomplete="off" value="${ghToken() ? '••••••••' : ''}" placeholder="github_pat_…"></div></div>
      <div class="actions"><button class="btn primary sm" data-act="saveRunner">Save</button>${ghToken() ? '<button class="btn sm danger" data-act="clearRunner">Remove token</button>' : ''}</div>
      ${local.get('gh_problem', '') ? `<div class="notice warn">${esc(local.get('gh_problem', ''))}</div>` : ''}</div>
     <div class="card panel"><div class="panel-head"><div><h2>Chrome extension</h2><small>Fills forms from your approved pack. Never submits without your approval.</small></div><span class="tag ${ext.ready ? 'green' : 'amber'}">${ext.ready ? 'Connected' : 'Not connected'}</span></div>
      <ul class="bullets"><li>Install: chrome://extensions → Developer mode → Load unpacked → choose the <b>extension</b> folder.</li><li>If this page is not on localhost, open the extension's menu on this page and press <b>Trust this Northstar page</b>.</li><li>Phones: form filling is not available, everything else works.</li></ul></div>
     <div class="card panel"><div class="panel-head"><div><h2>Your data</h2><small>Saved in this browser on this device only</small></div></div>
      <div class="actions"><button class="btn sm" data-act="importSetup">Import setup file</button><button class="btn sm" data-act="exportSync">⇩ Export sync file</button><button class="btn sm" data-act="importSync">Import sync file</button><button class="btn sm" data-act="exportCsv">⇩ Roles as CSV</button></div>
      <p class="tiny">To use the same tracker on your phone and computer, export a sync file on one and import it on the other. Sync files contain personal data: keep them private. API keys and tokens are never included.</p>
      <div id="backup-list" class="tiny" style="margin:8px 0">Loading safety copies…</div>
      <p class="tiny">Last saved ${fmtDate(S.updated_at)} · ${S.jobs.length} roles · ${S.packs.length} pack versions · ${S.answers.length} answers</p></div>
     <div class="card panel"><div class="panel-head"><h2>Appearance</h2></div><div class="seg" style="display:inline-flex">${['auto', 'light', 'dark'].map(t => `<button data-act="theme" data-arg="${t}" class="${(local.get('theme', 'auto')) === t ? 'on' : ''}">${t[0].toUpperCase() + t.slice(1)}</button>`).join('')}</div>
      <div class="divider"></div><button class="btn sm danger" data-act="resetAll">Erase everything on this device</button></div></div>`;
    renderBackups();
  }
}
function srcRow(s) {
  return `<div class="srcrow"><input type="checkbox" data-act="toggleSource" data-arg="${attr(s.id)}" ${s.enabled ? 'checked' : ''} aria-label="Use ${attr(s.name)}"><div><b>${esc(s.name)}</b>${s.notes ? `<div class="tiny">${esc(s.notes)}</div>` : ''}${s.url ? `<div class="tiny">${esc(s.url)}</div>` : ''}</div><span class="c-mkt tiny">${esc(s.market)}</span><span class="c-kind tag gray">${esc(s.kind || 'board')}</span><button class="btn sm" data-act="editSource" data-arg="${attr(s.id)}">Edit</button></div>`;
}
const ANSWER_GROUPS = [
  ['Needs your answer', a => !(a.answer || '').trim() || (a.draft && !a.confirmed)],
  ['Stories', a => a.kind === 'story'],
  ['Confirmed claims', a => a.kind === 'claim'],
  ['Pay', a => /salary|day rate|pay\b|compensation|remuneration|bonus/i.test(a.question)],
  ['Diversity', a => /gender|sex you were|age band|ethnic|disabilit|orientation|religion|caring|socio-economic|armed forces|pronoun/i.test(a.question)],
  ['Basics', a => /\blocation\b|where .*based|right to work|authori[sz]ed to work|visa|sponsor|notice|nationality|citizenship|address|first name|last name|full name|linked\s*in|start date|tax resident|phone|e-?mail/i.test(a.question)],
  ['Work pattern', a => /on-?site|office|hybrid|remote|working pattern|relocat|travel|days a week|shift/i.test(a.question)],
  ['Experience and certs', a => /experience|years|qualification|education|degree|certif|languages|employer|job title|driving|licen[cs]e|clearance|vetting/i.test(a.question)],
  ['Personal "why" answers', a => /^(why|what|how|which|tell us|describe)\b|introduction|about yourself/i.test(a.question) && !/hear about/i.test(a.question)],
  ['Other', () => true],
];
let ansQuery = '';
const ansOpen = new Set(['Needs your answer']);
function answerGroupOf(a) { return ANSWER_GROUPS.find(([, f]) => f(a))[0]; }
function answerGroupsHtml() {
  const q = norm(ansQuery);
  const hit = a => !q || norm(a.question).includes(q) || (!a.sensitive && norm(a.answer || '').includes(q));
  const by = {}; for (const a of S.answers) if (hit(a)) (by[answerGroupOf(a)] ||= []).push(a);
  if (by['Needs your answer']) by['Needs your answer'].sort((x, y) => (y.seen || 1) - (x.seen || 1) || (x.draft ? 1 : 0) - (y.draft ? 1 : 0));
  const body = ANSWER_GROUPS.map(([t]) => { const rs = by[t]; if (!rs) return '';
    const bar = t === 'Needs your answer' ? suggestBar(rs) : ''; return `<details class="group" data-ansgroup="${attr(t)}" ${q || ansOpen.has(t) ? 'open' : ''}><summary>${esc(t)} <span class="count">${rs.length}</span></summary><div class="gbody">${bar}${rs.map(answerRow).join('')}</div></details>`; }).join('');
  const merged = (S.answer_merged || []).map((m, i) => ({ ...m, i })).filter(m => !m.alias);
  const mergedHtml = !q && merged.length ? `<details class="group"><summary>Merged duplicates <span class="count">${merged.length}</span></summary><div class="gbody"><p class="tiny">These repeated another answer, so Northstar keeps only one. They are stored here so nothing is lost; Restore puts one back.</p>${merged.map(m => `<div class="listrow"><span style="min-width:0"><b>${esc(m.item.question)}</b><br><span class="tiny">${m.item.sensitive ? '••••••' : esc((m.item.answer || '(empty)').slice(0, 120))} · merged into “${esc(m.into_question || '')}”</span></span><button class="btn sm" data-act="restoreMerged" data-arg="${m.i}">Restore</button></div>`).join('')}</div></details>` : '';
  return (body || `<div class="empty">${q ? 'No answers match your search.' : 'No saved answers yet.'}</div>`) + mergedHtml;
}
function answerRow(a) {
  const shown = revealed[a.key];
  const full = a.answer || '';
  const first = full.split('\n').find(l => l.trim()) || '';
  const preview = !full.trim() ? '<i>No answer yet</i>' : a.sensitive && !shown ? '••••••' : esc(first);
  const fullHtml = !full.trim() ? '<i>No answer yet</i>' : a.sensitive && !shown ? '••••••' : esc(full).replace(/\n/g, '<br>');
  const waiting = !full.trim(), isDraft = a.draft && !a.confirmed;
  const tags = `${(a.seen || 1) > 1 ? `<span class="tag blue">Seen on ${a.seen} forms</span>` : ''}${isDraft ? '<span class="tag amber">Draft to review</span>' : ''}`;
  const draftHtml = isDraft ? `<div class="notice" style="margin-top:8px"><b>${a.draft.source === 'form' ? 'You typed this on a form.' : `Suggested by ${a.draft.source === 'match' ? 'Northstar' : 'Claude'}.`}</b> Based on: ${esc(a.draft.based_on || 'not stated')}.${(a.draft.flags || []).length ? `<div style="margin-top:4px;color:var(--amber)"><b>Check before approving:</b> ${a.draft.flags.map(esc).join('; ')}</div>` : ''}<div class="tiny" style="margin-top:4px">Not used on forms or in packs until you approve it.</div></div>` : '';
  const ns = waiting && a.no_suggestion;
  const suggestHtml = waiting ? (noDraft(a) ? '<div class="tiny" style="margin-top:6px">Pay, diversity and private details are never suggested. Please fill this one in yourself.</div>'
    : ns ? `<div class="notice warn" style="margin-top:8px"><b>Claude didn't suggest an answer, on purpose.</b> ${esc(ns.reason || "Your documents don't cover this question.")}${ns.flags.length ? `<div class="tiny" style="margin-top:4px">Not backed up by your documents: ${ns.flags.map(esc).join('; ')}</div>` : ''}<div class="tiny" style="margin-top:4px">Please answer it yourself with Edit.</div></div>` : '') : '';
  const btns = isDraft
    ? `<button class="btn sm primary" data-act="approveDraft" data-arg="${attr(a.key)}">Approve</button><button class="btn sm" data-act="editAnswer" data-arg="${attr(a.key)}">Edit</button><button class="btn sm" data-act="discardDraft" data-arg="${attr(a.key)}">Discard draft</button>`
    : `${waiting && !noDraft(a) ? `<button class="btn sm ${ns ? '' : 'primary'}" data-act="suggestAnswer" data-arg="${attr(a.key)}">${ns ? 'Try again' : 'Suggest answer'}</button>` : ''}${a.sensitive && full.trim() ? `<button class="btn sm" data-act="reveal" data-arg="${attr(a.key)}">${shown ? 'Hide' : 'Show'}</button>` : ''}<button class="btn sm ${waiting && !noDraft(a) && !ns ? '' : 'primary'}" data-act="editAnswer" data-arg="${attr(a.key)}">Edit</button>`;
  return `<details class="ansrow"><summary><b>${esc(a.question)}</b>${tags ? `<span class="anstags">${tags}</span>` : ''}<span class="ansprev">${preview}</span></summary><div class="ansfull"><div>${fullHtml}</div>${draftHtml}${suggestHtml}<div class="tiny" style="margin-top:6px">${esc(a.scope === 'both' || !a.scope ? 'Both markets' : a.scope + ' only')} · ${a.confirmed ? 'confirmed' : '<b style="color:var(--amber)">not confirmed</b>'}</div><div class="actions" style="margin:8px 0 0">${btns}</div></div></details>`;
}
/* ----- Suggested answers: drafts only, never used until approved ----- */
const NO_DRAFT_RE = /salary|day rate|\bpay\b|compensation|remuneration|bonus|gender|sex you were|age band|\bage\b|ethnic|disabilit|orientation|religion|caring|socio-economic|armed forces|pronoun|address|phone|mobile|e-?mail|date of birth|\bdob\b|passport|national insurance|\bni number|social security|bank|criminal|convict|health|medical|referee|next of kin/i;
function noDraft(a) { return a.sensitive || NO_DRAFT_RE.test(a.question || ''); }
const STOP = new Set('a an the of to in on for and or with your you do are is be have has as at by any this that from what which how did does please if yes no work role job position company'.split(' '));
const qTokens = q => new Set(norm(q).split(/[^a-z0-9]+/).filter(w => w.length > 1 && !STOP.has(w)));
function sameQuestion(a, b) {
  // a = the waiting question, b = one you answered. Match only when every key word of the new question is covered,
  // so "Years of experience with Scrum" never borrows a general "Years of experience" answer.
  const x = qTokens(a), y = qTokens(b); if (!x.size || !y.size) return false;
  let inter = 0; for (const w of x) if (y.has(w)) inter++;
  return inter === x.size && inter / y.size >= 0.5;
}
function suggestable() { return S.answers.filter(a => !(a.answer || '').trim() && !noDraft(a) && !a.no_suggestion); }
function suggestBar(rs) {
  const n = rs.filter(a => !(a.answer || '').trim() && !noDraft(a) && !a.no_suggestion).length;
  const d = rs.filter(a => a.draft && !a.confirmed).length;
  return n || d ? `<div class="notice" style="margin:0 0 8px;display:flex;gap:10px;align-items:center;flex-wrap:wrap"><span style="flex:1;min-width:200px">${n ? `${n} question${n > 1 ? 's' : ''} can get a suggested answer from your CV, stories and saved answers.` : ''}${d ? ` ${d} draft${d > 1 ? 's' : ''} waiting for you to approve.` : ''} Questions seen on more forms are first.</span>${n ? `<button class="btn sm primary" data-act="suggestAll">Suggest all (${n})</button>` : ''}</div>` : '';
}
// Step 1: new wording for a question you already answered? Reuse that answer as a draft.
function matchExisting(list) {
  const done = S.answers.filter(x => x.confirmed && (x.answer || '').trim() && !x.sensitive && x.kind !== 'story');
  let n = 0;
  for (const a of list) {
    const m = done.find(x => x !== a && (x.scope || 'both') !== (a.scope === 'UK' ? 'UAE' : a.scope === 'UAE' ? 'UK' : '-') && sameQuestion(a.question, x.question));
    if (m) { a.answer = m.answer; a.confirmed = false; a.draft = { source: 'match', based_on: `your saved answer to “${m.question}”`, flags: [], at: now() }; a.updated_at = now(); n++; }
  }
  return n;
}
async function suggestAnswers(keys) {
  const list = keys.map(k => S.answers.find(a => a.key === k)).filter(a => a && !(a.answer || '').trim() && !noDraft(a));
  if (!list.length) { toast('Nothing to suggest here'); return; }
  const matched = matchExisting(list);
  if (matched) { await save(); renderProfile(); }
  const rest = list.filter(a => !(a.answer || '').trim());
  if (!rest.length) { toast(`${matched} answer${matched > 1 ? 's' : ''} matched questions you had already answered. Review and approve them.`); return; }
  if (matched) toast(`${matched} matched questions you had already answered. Claude can draft the other ${rest.length}.`);
  const qs = rest.map((a, i) => ({ id: 'q' + (i + 1), key: a.key, question: a.question, scope: a.scope }));
  const letters = S.packs.filter(p => p.status === 'approved' && p.cl_md).slice(-4).map(p => { const j = job(p.job_id) || {}; return `### ${j.company || ''} · ${j.role || ''}\n${p.cl_md.slice(0, 3000)}`; }).join('\n\n');
  const prompt = AI.chatPrompt(AI.answersPrompt({ questions: qs, docs: docs(), answers: S.answers, letters }));
  chatHandoff({ eyebrow: 'Saved answers', title: `Suggest ${rest.length > 1 ? rest.length + ' answers' : 'an answer'} with Claude chat`, cloudTitle: `Suggest ${rest.length > 1 ? rest.length + ' answers' : 'an answer'}`, prompt,
    onReply: async text => { applySuggestions(qs, text); await save(); renderProfile(); }, cloud: { kind: 'answers', ref: { qs: qs.map(({ id, key }) => ({ id, key })) }, title: `Suggested answers · ${rest.length}` } });
}
function applySuggestions(qs, text) {
  const res = AI.extractJson(text); let n = 0, skipped = 0;
  for (const r of res.answers || []) {
    const q = qs.find(x => x.id === r.id); const a = q && S.answers.find(x => x.key === q.key);
    if (!a || (a.answer || '').trim() || noDraft(a)) continue; // never overwrite something you wrote meanwhile
    const ans = String(r.answer || '').trim();
    if (!ans) { skipped++; a.no_suggestion = { reason: String(r.skip_reason || '').slice(0, 500), flags: (r.unsupported || []).map(String).filter(Boolean).slice(0, 4), at: now() }; continue; }
    delete a.no_suggestion;
    a.answer = ans; a.confirmed = false; a.updated_at = now();
    a.draft = { source: 'claude', based_on: String(r.based_on || '').slice(0, 300), flags: (r.unsupported || []).map(String).filter(Boolean).slice(0, 6), at: now() };
    n++;
  }
  toast(`${n} draft${n === 1 ? '' : 's'} added for you to review${skipped ? `; ${skipped} left empty because your documents don't cover them` : ''}.`);
  return n;
}

/* Duplicate answers (LinkedIn, home address, location): keep one per market, store the rest in answer_merged so nothing is lost. */
const MERGE_TOPICS = [
  ['linkedin', q => /linked\s*in/i.test(q), true],
  ['address', q => /address/i.test(q) && !/e-?mail|web|ip address/i.test(q), true],
  ['location', q => /\blocation\b|where (are you|do you live|.*based)/i.test(q) && !/willing|relocat|prefer/i.test(q)],
];
function answerQuality(a) { const t = (a.answer || '').trim(); return (t ? 1000 : 0) + (a.confirmed ? 500 : 0) + (/^[A-Z0-9]/.test(t) ? 100 : 0) + (t.includes(',') ? 50 : 0) + Math.min(t.length, 200) / 10 + (Date.parse(a.updated_at || a.created_at || 0) || 0) / 1e13; }
function mergeDuplicateAnswers() {
  S.answer_merged ||= []; let n = 0;
  for (const [topic, test, anyMarket] of MERGE_TOPICS) {
    const list = S.answers.filter(a => a.kind !== 'story' && a.kind !== 'claim' && test(a.question || ''));
    if (list.length < 2) continue;
    if (anyMarket) {
      // one LinkedIn link and one home address serve every market
      const sorted = [...list].sort((x, y) => answerQuality(y) - answerQuality(x)), keep = sorted[0];
      for (const a of sorted.slice(1)) { if (a.sensitive) keep.sensitive = true; S.answer_merged.push({ key: a.key, topic, into: keep.key, into_question: keep.question, at: now(), item: a }); S.answers = S.answers.filter(x => x !== a); n++; }
      if ((keep.scope || 'both') !== 'both' && list.some(a => (a.scope || 'both') === 'both')) {
        const old = keep.key; keep.scope = 'both'; keep.key = answerKey(keep.question, 'both');
        if (S.answers.some(x => x !== keep && x.key === keep.key)) { keep.key = old; keep.scope = list[0].scope; }
        else S.answer_merged.push({ key: old, topic, into: keep.key, alias: true, at: now() });
      }
      continue;
    }
    const scopes = new Set(list.map(a => a.scope || 'both'));
    const drop = [];
    // a "both markets" entry is redundant when there is one for the UK and one for the UAE
    if (scopes.has('UK') && scopes.has('UAE')) for (const a of list) if ((a.scope || 'both') === 'both') drop.push([a, list.filter(x => x.scope === 'UK' || x.scope === 'UAE').sort((x, y) => answerQuality(y) - answerQuality(x))[0]]);
    for (const sc of scopes) {
      const same = list.filter(a => (a.scope || 'both') === sc && !drop.some(([d]) => d === a)).sort((x, y) => answerQuality(y) - answerQuality(x));
      for (const a of same.slice(1)) drop.push([a, same[0]]);
    }
    for (const [a, keep] of drop) {
      if (!keep || a === keep) continue;
      if (a.sensitive) keep.sensitive = true;
      S.answer_merged.push({ key: a.key, topic, into: keep.key, into_question: keep.question, at: now(), item: a });
      S.answers = S.answers.filter(x => x !== a); n++;
    }
  }
  return n;
}

/* =========================================================
   Actions
   ========================================================= */
const ACT = {
  async cloudCheck() { await pollCloud(true); pullMissedResults(true).catch(() => { }); },
  async restoreBackup(i) {
    const list = (await dbGet('backups')) || []; const b = list[+i]; if (!b) return;
    if (!await confirmBox('Restore this safety copy?', `From ${fmtDate(b.at)} (${b.reason}): ${b.counts.roles} roles, ${b.counts.packs} packs, ${b.counts.answers} answers, ${b.counts.blocklist} blocklist entries. What you have now is kept as another safety copy first.`, 'Restore')) return;
    await backup('before restoring a safety copy', true);
    const keepBase = (await dbGet('state'))?.updated_at || null; S = { ...blankState(), ...b.state }; baseAt = keepBase; await save(); renderAll(); toast('Safety copy restored');
  },
  saveRunner() {
    if (!saveRunnerField('gh-repo') || !saveRunnerField('gh-token')) return;
    renderProfile();
    if (!ghRepo()) { toast('Token saved. Now type the repository name, for example SerenaGall9/northstar-results, and press Save.'); return; }
    if (!ghToken()) { toast('Repository saved. Now paste the read-only token and press Save.'); return; }
    toast('Saved on this device: ' + ghRepo() + ' with its read-only token'); pollCloud();
  },
  clearRunner() { local.set('gh_token', ''); renderProfile(); },
  cloudPaste(id) {
    const req = (S.cloud || []).find(r => r.id === id); if (!req) return;
    openModal(`<div class="eyebrow">Northstar runner</div><h2>${esc(req.title)}</h2><p class="tiny">If the result has not arrived by itself, open the run with Watch, copy the runner's final answer and paste it here.</p><textarea id="cp-text" class="field" style="width:100%;min-height:180px" placeholder="Paste the runner's answer"></textarea><div class="modalfoot"><button class="btn" data-act="closeModal">Cancel</button><button class="btn primary" id="cp-use">Use this result</button></div>`, 'wide');
    $('cp-use').onclick = async () => { const t = $('cp-text').value.trim(); if (!t) { toast('Paste the result first'); return; } try { await applyCloudResult(req, t); closeModal(); } catch (e) { toast(e.message); } };
  },
  async stopDrafting(jid) {
    const j = job(jid); if (!j) return;
    const rq = (S.cloud || []).find(r => r.status === 'waiting' && r.kind === 'pack' && r.ref?.job_id === jid);
    if (rq) cloudCleanup(rq, 'removed'); else if (j.stage === 'drafting') j.stage = latestPack(jid) ? 'review' : 'shortlisted';
    j.updated_at = now(); await save(); renderAll(); toast('Stopped waiting. You can send the pack again.');
  },
  async cloudRemove(id) {
    const req = (S.cloud || []).find(r => r.id === id); if (!req) return;
    if (!await confirmBox('Stop waiting for this run?', 'Northstar stops waiting for its result. The run itself is not stopped; you can close it from the Watch page.', 'Stop waiting')) return;
    cloudCleanup(req, 'removed'); await save(); renderAll();
  },
  closeModal, go: p => go(p),
  toggleHomeAll() { homeShowAll = !homeShowAll; renderHome(); },
  toggleCollapse(k) { collapseState[k] = !collapseState[k]; renderPage(currentPage); },
  goSettings() { profileTab = 'settings'; document.querySelectorAll('[data-ptab]').forEach(x => x.classList.toggle('on', x.dataset.ptab === 'settings')); go('profile'); },
  goReview(id) { reviewUI[id] = { ...(reviewUI[id] || {}), open: true }; go('review'); },
  theme(t) { local.set('theme', t); applyTheme(); renderProfile(); },

  /* ----- Add role from a link ----- */
  openAddRole() {
    openModal(`<div class="eyebrow">Add role</div><h2>Paste the job link</h2><p>Northstar reads the ad and fills in the details. You can check and change everything before saving.</p>
     <div class="formfield"><label for="ar-url">Job link</label><input id="ar-url" type="url" placeholder="https://…" inputmode="url"></div>
     <details class="more" style="margin-top:8px"><summary>The page needs a login or won't load? Paste the ad text instead</summary><textarea id="ar-text" class="field" style="width:100%;min-height:120px;margin-top:6px" placeholder="Paste the job ad text"></textarea></details>
     <p class="tiny" id="ar-how">${howRead()}</p>
     <div class="modalfoot"><button class="btn" data-act="closeModal">Cancel</button><button class="btn primary" id="ar-go">Read the ad</button></div>`);
    $('ar-go').onclick = () => readAd($('ar-url').value.trim(), $('ar-text').value.trim());
    $('ar-url').addEventListener('keydown', e => { if (e.key === 'Enter') $('ar-go').click(); });
  },
  openJob(id) { openJobModal(id); },
  changeStatus(id) { closeModal(); openStatusForm(id); },
  checkGmail: () => checkGmail(),
  pickSearchMarket(m) { local.set('search_market', m); closeModal(); runSearch(); },
  async gmailAccept(gid) { const x = S.gmail.suggestions.find(s => s.id === gid); if (!x) return; x.status = 'accepted'; x.done_at = now(); await setManualStatus(x.job_id, GMAIL_TO[x.kind], x.date, 'From Gmail: ' + GMAIL_WORD[x.kind]); },
  async gmailDismiss(gid) { const x = S.gmail.suggestions.find(s => s.id === gid); if (!x) return; x.status = 'dismissed'; x.done_at = now(); await save(); renderAll(); },
  async shortlist(id) { const j = job(id); j.stage = 'shortlisted'; j.shortlisted_at = now(); j.updated_at = now(); await save(); closeModal(); renderAll(); toast('Added to your shortlist. A pack is made only when you press Start application.'); },
  async dismiss(id) {
    const j = job(id);
    if (!await confirmBox('Dismiss this role?', `${j.company} · ${j.role} is removed and added to your blocklist.`, 'Dismiss')) return;
    j.stage = 'dismissed'; j.updated_at = now();
    S.blocklist.unshift({ id: uid('b'), kind: 'role', value: `${j.company} ${j.role}`, reason: 'Dismissed in Discovery', created_at: now(), job_url: j.job_url || '' });
    await save(); renderAll(); toast('Dismissed and added to the blocklist');
  },
  async closeJob(id) {
    const j = job(id), hadInt = S.interviews.some(i => i.job_id === id);
    if (!await confirmBox('Mark this application Closed?', hadInt ? `${j.company} · ${j.role}` : `${j.company} · ${j.role}. It closed without an interview, so its CV and letter copies in the tracker are deleted.`, 'Mark Closed')) return;
    j.stage = 'closed'; j.closed_at = now(); j.updated_at = now(); runCleanup(true); await save(); renderAll(); toast('Marked Closed');
  },
  runSearch: () => runSearch(),
  startApplication: id => startApplication(id),
  draftPack: id => draftPackFor(id),
  fixAll: () => openFixAll(),
  editDraft: id => editDraft(id),
  tickRead(id, el) { reviewUI[id] = { ...(reviewUI[id] || {}), read: el.checked, open: true }; renderReview(); },
  async claimSave(arg) {
    const [pid, i] = arg.split('|'); const p = S.packs.find(x => x.id === pid); const c = p.claims[+i];
    const text = $(`claim-${pid}-${i}`).value.trim();
    if (!text) { toast('Type the facts first, or tick that it does not apply'); return; }
    c.state = 'confirmed'; c.answer = text; delete c.carried;
    upsertAnswer({ question: c.question, answer: text, kind: 'claim', confirmed: true, scope: 'both' });
    await save(); renderReview(); toast('Saved as a confirmed answer. Packs can now use it.');
  },
  async claimNA(arg) { const [pid, i] = arg.split('|'); const p = S.packs.find(x => x.id === pid); p.claims[+i].state = 'na'; delete p.claims[+i].carried; await save(); renderReview(); },
  async claimReopen(arg) { const [pid, i] = arg.split('|'); const p = S.packs.find(x => x.id === pid); p.claims[+i].state = 'open'; await save(); renderReview(); },
  requestChange(pid) {
    formModal({ eyebrow: 'Request changes', title: 'What should change in the next version?', copy: 'Your words are passed on as written. A new version is built only when you press Build new version, and it needs a fresh approval.', fields: [{ id: 'note', label: 'Change request', type: 'textarea' }], onSave: async v => { if (!v.note.trim()) { toast('Write what should change'); return false; } const p = S.packs.find(x => x.id === pid); (p.change_requests = p.change_requests || []).push({ note: v.note.trim(), at: now() }); await save(); renderAll(); toast('Saved. Press Build new version, or Edit it myself.'); } });
  },
  async approvePack(pid) {
    const p = S.packs.find(x => x.id === pid), j = job(p.job_id);
    if (!await confirmBox('Approve this exact version?', `${j.company} · ${j.role}, version ${p.hash}. Form filling and submission still need their own clicks.`, 'Approve')) return;
    S.packs.filter(x => x.job_id === p.job_id && x.status === 'approved').forEach(x => x.status = 'superseded');
    p.status = 'approved'; p.approved_at = now(); j.stage = 'application'; j.updated_at = now();
    await save(); renderAll(); toast('Approved and moved to Application.');
  },
  pdfPack(arg) { const [pid, d] = arg.split('|'); const p = S.packs.find(x => x.id === pid), j = job(p.job_id); const nm = `${slug([S.profile.contact.first_name, S.profile.contact.last_name].join(' '))}-${slug(j.company)}`; d === 'cv' ? savePdf(p.cv_md, `${nm}-CV.pdf`, { title: 'CV', kind: 'cv' }) : savePdf(letterDoc(p), `${nm}-Cover-letter.pdf`, { title: 'Cover letter', kind: 'letter' }); },
  viewPack(arg) { const [pid, d] = arg.split('|'); const p = S.packs.find(x => x.id === pid), j = job(p.job_id); d === 'cv' ? docModal({ eyebrow: `${j.company} · v${p.version}`, title: 'CV', md: p.cv_md, filename: `${slug(j.company)}-CV.pdf`, kind: 'cv' }) : docModal({ eyebrow: `${j.company} · v${p.version}`, title: 'Cover letter', md: letterDoc(p), filename: `${slug(j.company)}-Cover-letter.pdf`, kind: 'letter' }); },
  downloadPack(pid) { const p = S.packs.find(x => x.id === pid), j = job(p.job_id); download(`northstar-${slug(j.company)}-v${p.version}.md`, `# ${j.company} · ${j.role} · pack v${p.version} (${p.status})\n\n---\n\n${p.cv_md || ''}\n\n---\n\n# Cover letter\n\n${p.cl_md || ''}\n`); },

  /* ----- Application ----- */
  fillOne: id => queueFills([id]),
  fillBatch() { const ids = [...document.querySelectorAll('.batchpick:checked')].map(x => x.value); if (!ids.length) { toast('Tick “Include in the next batch” on the roles you want first'); return; } if (ids.length > 5) { toast('Up to five applications per batch'); return; } queueFills(ids); },
  sendFill: fid => sendFill(fid),
  async cancelFill(fid) { const f = S.fills.find(x => x.id === fid); f.status = 'cancelled'; f.updated_at = now(); await save(); renderAll(); },
  approveSubmit(id) {
    const j = job(id), f = activeFill(id), rep = f?.report || {};
    openModal(`<div class="eyebrow">One application · one approval</div><h2>Approve submitting this application?</h2><p><b>${esc(j.company)} · ${esc(j.role)}</b>, approved pack v${approvedPack(id)?.version}.</p>${rep.required_left ? `<div class="notice warn">The last page report still shows ${rep.required_left} empty required field(s).</div>` : ''}
     <div class="notice" style="margin-top:10px">This covers this one application only. It never comes from a batch fill or a pack approval. The extension unlocks Submit on the employer page; you press it yourself.</div>
     <label class="checkline" style="margin-top:12px"><input type="checkbox" id="ap-ok"> I checked every answer and document on the employer form</label>
     <div class="modalfoot"><button class="btn" data-act="closeModal">Cancel</button><button class="btn primary" id="ap-go" disabled>Approve submit</button></div>`);
    $('ap-ok').onchange = e => $('ap-go').disabled = !e.target.checked;
    $('ap-go').onclick = async () => { await recordApproval(id, 'tracker'); closeModal(); };
  },
  recordSubmitted(id) {
    const j = job(id);
    formModal({ eyebrow: `${j.company} · ${j.role}`, title: 'Record the submission', copy: 'Do this after the employer confirms it. The PDFs held by the extension are deleted now; tracker copies are kept through any interview.', fields: [{ id: 'ref', label: 'Confirmation or reference' }, { id: 'date', label: 'Date submitted', type: 'date', value: new Date().toISOString().slice(0, 10) }, { id: 'verified', label: 'I saw the employer’s confirmation', type: 'checkbox' }], onSave: async v => {
      j.stage = 'submitted'; j.submitted_at = v.date || now(); j.receipt = v.ref.trim(); j.receipt_verified = v.verified; j.updated_at = now();
      const a = approvalFor(id); if (a) a.used_at = now();
      const f = activeFill(id); if (f) { f.status = 'done'; f.updated_at = now(); extSend({ type: 'clear', fill_id: f.id }); }
      await save(); renderAll(); toast('Submission recorded');
    } });
  },

  /* ----- Interviews ----- */
  openInterview(arg = '') { const [jid, iid] = String(arg).split('|'); openInterviewForm(jid, iid); },
  async draftPrep(iid) {
    const i = S.interviews.find(x => x.id === iid), j = job(i.job_id);
    const addPrep = async md => { i.prep_md = (i.prep_md ? i.prep_md + '\n\n---\n\n' : '') + md.trim(); await save(); renderInterviews(); toast('Prep notes added. Edit them any time.'); };
    if (!apiKey()) { chatHandoff({ eyebrow: `${j.company} · ${i.stage || 'Interview'}`, title: 'Prep notes with Claude chat', cloudTitle: 'Make prep notes', prompt: AI.chatPrompt(AI.prepPrompt({ job: j, pack: approvedPack(j.id), interview: i, docs: docs() })), onReply: addPrep, cloud: { kind: 'prep', ref: { interview_id: iid }, title: `Prep notes · ${j.company}` } }); return; }
    busy('Drafting prep notes…');
    try { const md = await AI.draftPrep({ key: apiKey(), model: model(), job: j, pack: approvedPack(j.id), interview: i, docs: docs() }); i.prep_md = (i.prep_md ? i.prep_md + '\n\n---\n\n' : '') + md; await save(); renderInterviews(); toast('Prep notes added. Edit them any time.'); }
    catch (e) { toast(e.message); } finally { busy(); }
  },
  pdfPrep(iid) { const i = S.interviews.find(x => x.id === iid), j = job(i.job_id) || {}; savePdf(prepDoc(i), `${slug(j.company)}-interview-prep.pdf`, { title: 'Interview prep' }); },
  viewPrep(iid) { const i = S.interviews.find(x => x.id === iid), j = job(i.job_id) || {}; docModal({ eyebrow: 'Interview prep', title: `${j.company} · ${i.stage || 'Interview'}`, md: prepDoc(i), filename: `${slug(j.company)}-interview-prep.pdf` }); },
  recordOutcome(iid) {
    const i = S.interviews.find(x => x.id === iid);
    formModal({ eyebrow: 'Interview outcome', title: 'Record the outcome', copy: 'When the interview process is finished, the CV and letter copies in the tracker are deleted. Answers and outcomes are kept.', fields: [{ id: 'outcome', label: 'Outcome', type: 'select', options: ['Waiting to hear', 'Next round', 'Offer', 'Rejected', 'Withdrawn'], value: i.outcome || 'Waiting to hear' }, { id: 'finished', label: 'This interview process is finished', type: 'checkbox', value: i.finished }, { id: 'close', label: 'Also mark the application Closed', type: 'checkbox' }], onSave: async v => {
      i.outcome = v.outcome; i.finished = v.finished; const j = job(i.job_id); if (j) { j.outcome = v.outcome; if (v.close) { j.stage = 'closed'; j.closed_at = now(); } j.updated_at = now(); }
      runCleanup(true); await save(); renderAll();
    } });
  },

  /* ----- Profile ----- */
  async saveProfile() {
    document.querySelectorAll('[data-pref]').forEach(el => { const k = el.dataset.pref; S.profile[k] = k === 'markets' ? el.value.split(',').map(x => x.trim().toUpperCase()).filter(x => ['UK', 'UAE'].includes(x)) : k === 'talent_pool_box' ? el.value === 'true' : el.value.trim(); });
    if (!S.profile.markets.length) S.profile.markets = ['UAE', 'UK'];
    S.profile.contact = S.profile.contact || {};
    document.querySelectorAll('[data-contact]').forEach(el => S.profile.contact[el.dataset.contact] = el.value.trim());
    await save(); toast('Preferences saved');
  },
  async toggleSource(id, el) { const s = S.sources.find(x => x.id === id); s.enabled = el.checked; await save(); renderProfile(); },
  editSource(id) {
    const s = id ? S.sources.find(x => x.id === id) : null;
    formModal({ eyebrow: 'Search settings', title: s ? 'Edit source' : 'Add a search source', copy: 'Public sources only. Run search never signs in and skips any source that asks for a login or CAPTCHA.', fields: [{ id: 'name', label: 'Name', value: s?.name || '' }, { id: 'market', label: 'Market', type: 'select', options: ['UAE', 'UK', 'Both'], value: s?.market || 'UAE' }, { id: 'kind', label: 'Type', type: 'select', options: [['board', 'Job board'], ['careers', 'Employer careers page'], ['agency', 'Agency']], value: s?.kind || 'board' }, { id: 'url', label: 'Web address (optional)', value: s?.url || '', full: true }, { id: 'notes', label: 'Notes (optional)', value: s?.notes || '', full: true }, { id: 'enabled', label: 'Use in Run search', type: 'checkbox', value: s ? s.enabled : true }],
      extra: s ? `<button class="btn danger" id="src-del">Delete</button>` : '',
      onSave: async v => { if (!v.name.trim()) { toast('Give the source a name'); return false; } const rec = s || { id: uid('s') }; Object.assign(rec, { name: v.name.trim(), market: v.market, kind: v.kind, url: v.url.trim(), notes: v.notes.trim(), enabled: v.enabled }); if (!s) S.sources.push(rec); await save(); renderAll(); } });
    if (s) $('src-del').onclick = async () => { S.sources = S.sources.filter(x => x.id !== id); await save(); closeModal(); renderAll(); };
  },
  editAnswer(key) { openAnswerForm(key); },
  suggestAnswer(key) { suggestAnswers([key]); },
  suggestAll() { suggestAnswers(suggestable().map(a => a.key)); },
  async approveDraft(key) { const a = S.answers.find(x => x.key === key); if (!a) return; a.confirmed = true; a.approved_from_draft = a.draft; delete a.draft; a.updated_at = now(); await save(); renderProfile(); toast('Approved. Northstar can now use this answer on forms.'); },
  async discardDraft(key) { const a = S.answers.find(x => x.key === key); if (!a || !a.draft) return; a.answer = ''; a.confirmed = false; delete a.draft; a.updated_at = now(); await save(); renderProfile(); },
  async restoreMerged(i) { const m = (S.answer_merged || [])[+i]; if (!m || m.alias) return; S.answer_merged.splice(+i, 1); if (!S.answers.some(x => x.key === m.item.key)) S.answers.push(m.item); await save(); renderProfile(); toast('Answer restored'); },
  reveal(key) { if (revealed[key]) delete revealed[key]; else revealed[key] = true; renderProfile(); },
  addBlock() { formModal({ eyebrow: 'Blocklist', title: 'Add an entry', fields: [{ id: 'kind', label: 'Type', type: 'select', options: ['company', 'role', 'url'], value: 'company' }, { id: 'value', label: 'Company, “Company Role”, or listing link' }, { id: 'reason', label: 'Reason (optional)', full: true }], onSave: async v => { if (!v.value.trim()) return false; S.blocklist.unshift({ id: uid('b'), kind: v.kind, value: v.value.trim(), reason: v.reason.trim(), created_at: now() }); await save(); renderProfile(); } }); },
  async unblock(id) { S.blocklist = S.blocklist.filter(x => x.id !== id); await save(); renderProfile(); },
  async makeReport() { const r = weeklyReport(); S.reports.unshift(r); S.runs.unshift({ id: uid('r'), kind: 'report', status: 'done', started_at: r.period_end, summary: 'Weekly report' }); await save(); renderProfile(); toast('Weekly report made from recorded data'); },
  pdfReport(id) { const r = S.reports.find(x => x.id === id); savePdf(r.body_md, `northstar-weekly-report-${r.period_end.slice(0, 10)}.pdf`, { title: 'Weekly report' }); },
  viewReport(id) { const r = S.reports.find(x => x.id === id); docModal({ eyebrow: 'Weekly report', title: 'Week ending ' + fmtDate(r.period_end, false), md: r.body_md, filename: `northstar-weekly-report-${r.period_end.slice(0, 10)}.pdf` }); },
  pdfMaster() { savePdf(S.docs.master_cv, 'Master-CV.pdf', { title: 'Master CV', kind: 'cv' }); },
  newMaster() {
    openModal(`<div class="eyebrow">Only when you ask for one</div><h2>New Master CV version</h2><p>Approved packs are never changed by this. New packs use the new version.</p>${editorHtml([{ id: 'master', label: 'Master CV', value: S.docs.master_cv }], 'cv')}<div class="formfield" style="margin-top:10px"><label for="mv-note">What changed</label><input id="mv-note"></div><div class="modalfoot"><button class="btn" data-act="closeModal">Cancel</button><button class="btn primary" id="mv-save">Save new version</button></div>`, 'xwide');
    wireEditor(v => v.master);
    $('mv-save').onclick = async () => { const body = editorValues().master; S.master_versions.unshift({ created_at: now(), note: $('mv-note').value.trim(), previous: S.docs.master_cv }); S.master_versions = S.master_versions.slice(0, 10); S.docs.master_cv = body; await save(); closeModal(); renderProfile(); toast('New Master CV version saved'); };
  },
  openSource(name) { const titles = { rubric: 'Fit score rubric', playbook: 'Cover letter playbook', search_profile: 'Search profile', workflow_rules: 'Workflow rules', master_cv: 'Master CV' }; docModal({ eyebrow: 'Read-only source', title: titles[name] || name, md: S.docs[name] || '*Not imported yet.*', filename: `${name}.pdf` }); },
  async saveKey() { if (/^sk-ant-oat/.test($('api-key').value.trim())) { toast('That is a runner token, not an API key. Paste it in the extension menu under Cloud runner instead.'); return; } local.set('api_key', $('api-key').value.trim()); local.set('model', $('api-model').value); setStatus(); renderProfile(); toast('Assistant settings saved on this device'); },
  async clearKey() { local.set('api_key', ''); setStatus(); renderProfile(); },
  importSetup: () => pickFile('.json', importSetup),
  importSync: () => pickFile('.json', importSync),
  exportSync() { download(`northstar-sync-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify({ northstar_sync: 3, exported_at: now(), state: S }), 'application/json'); },
  exportCsv() {
    const cols = ['company', 'role', 'market', 'location', 'industry', 'stage', 'fit', 'fit_score', 'salary', 'deadline', 'source', 'job_url', 'submitted_at', 'receipt', 'outcome'];
    const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
    download('northstar-roles.csv', [cols.join(','), ...S.jobs.map(j => cols.map(c => q(j[c])).join(','))].join('\n'), 'text/csv');
  },
  async resetAll() { if (!await confirmBox('Erase everything on this device?', 'All roles, packs, answers and reports in this browser are deleted. Export a sync file first if you want a copy.', 'Erase')) return; await backup('before erasing', true); const keepBase = baseAt; S = blankState(); baseAt = keepBase; await save(); renderAll(); go('home'); showOnboarding(); },
};

/* ----- Add role helpers ----- */
function howRead() {
  if (ext.ready && apiKey()) return 'The Chrome extension reads the page, then the assistant fills in and scores it.';
  if (ext.ready) return 'The Chrome extension reads the page. Then press “Fill and score with Claude chat”, or set the six scores yourself.';
  if (apiKey()) return 'The assistant opens the link, fills in the details and scores it.';
  return 'Northstar fills what it can from the link. Then press “Fill and score with Claude chat”, or add the rest yourself.';
}
async function readAd(url, pasted) {
  if (!url && !pasted) { toast('Paste the job link'); return; }
  if (url && !/^https?:\/\//i.test(url)) url = 'https://' + url;
  const dup = url && S.jobs.find(j => j.job_url && norm(j.job_url) === norm(url));
  if (dup) { toast(`Already tracked: ${dup.company} · ${dup.role} (${statusOf(dup)})`); return; }
  const blocked = url && S.blocklist.find(b => b.kind === 'url' && norm(b.value) === norm(url));
  if (blocked) { toast('That listing is on your blocklist'); return; }
  closeModal();
  busy('Reading the ad…');
  let page = null, fields = { job_url: url, apply_url: url, source: url ? new URL(url).hostname.replace(/^www\./, '') : 'Manual' };
  try {
    if (pasted) page = { text: pasted };
    else if (ext.ready) { const r = await extRequest({ type: 'fetch', url }, 25000); if (r.ok) page = parsePage(r.html, url); else toast('The extension could not read the page: ' + (r.error || 'unknown') + '.'); }
    if (page?.posting) Object.assign(fields, page.posting);
    let ai = null;
    if (apiKey()) {
      busy('Scoring the ad with the assistant…');
      ai = await AI.readJobAd({ key: apiKey(), model: model(), url, pageText: page?.text || '', docs: docs() });
      if (ai.blocked) toast('The assistant could not open the page: ' + ai.blocked + '. Paste the ad text instead.');
      for (const [k, v] of Object.entries(ai)) if (v !== '' && v != null && !(Array.isArray(v) && !v.length)) fields[k] = v;
      if (ai.jd_summary) fields.jd_text = ai.jd_summary;
    }
    if (!fields.company && url) fields.company = guessCompany(url);
    if (!fields.market) fields.market = /dubai|abu dhabi|uae|emirates|sharjah/i.test([fields.location, page?.text?.slice(0, 3000)].join(' ')) ? 'UAE' : 'UK';
    if (!fields.jd_text && page?.text) fields.jd_text = page.text.slice(0, 6000);
    fields._scored = !!ai;
    fields._page = page?.text || '';
  } catch (e) { toast(e.message); }
  finally { busy(); }
  openRoleForm(fields);
}
function guessCompany(url) { try { const h = new URL(url).hostname.replace(/^www\.|^careers\.|^jobs\./, ''); const n = h.split('.')[0]; return /linkedin|indeed|bayt|naukri|glassdoor|greenhouse|lever|workday|myworkday|smartrecruiters|foundit|reed|totaljobs/.test(h) ? '' : n.charAt(0).toUpperCase() + n.slice(1); } catch { return ''; } }
function parsePage(html, url) {
  const d = new DOMParser().parseFromString(html, 'text/html');
  let posting = null;
  for (const s of d.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const data = JSON.parse(s.textContent);
      const flat = [].concat(data, data['@graph'] || []).flat();
      const jp = flat.find(x => x && [].concat(x['@type']).includes('JobPosting'));
      if (jp) {
        const loc = [].concat(jp.jobLocation || [])[0]?.address || {};
        const sal = jp.baseSalary?.value;
        const strip = h => new DOMParser().parseFromString(String(h || ''), 'text/html').body.textContent.replace(/\s+\n/g, '\n').trim();
        posting = {
          role: jp.title || '', company: jp.hiringOrganization?.name || '',
          location: [loc.addressLocality, loc.addressRegion, loc.addressCountry?.name || loc.addressCountry].filter(x => typeof x === 'string' && x).join(', ') + (jp.jobLocationType === 'TELECOMMUTE' ? ' (remote)' : ''),
          deadline: (jp.validThrough || '').slice(0, 10),
          salary: sal ? `${jp.baseSalary.currency || ''} ${sal.minValue || sal.value || ''}${sal.maxValue ? '–' + sal.maxValue : ''} ${sal.unitText ? 'per ' + sal.unitText.toLowerCase() : ''}`.trim() : '',
          jd_text: strip(jp.description).slice(0, 8000),
        };
        break;
      }
    } catch { }
  }
  d.querySelectorAll('script,style,noscript,svg,nav,footer,header').forEach(x => x.remove());
  const text = (d.querySelector('main') || d.body)?.textContent.replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim() || '';
  if (!posting) { const t = d.querySelector('meta[property="og:title"]')?.content || d.title || ''; posting = { role: t.split(/[|–-]/)[0].trim() }; }
  return { posting, text: text.slice(0, 60000) };
}
function openRoleForm(f) {
  const b = f.breakdown || { experience: 20, role: 15, location: f.market === 'UAE' ? 15 : 10, pay: 9, industry: 10, timing: 3 };
  const num = (k, max) => `<div class="formfield"><label for="rb-${k}">${RUBRIC.find(r => r[0] === k)[1]} (0–${max})</label><input id="rb-${k}" type="number" min="0" max="${max}" value="${+b[k] || 0}"></div>`;
  openModal(`<div class="eyebrow">Check before saving</div><h2>${esc(f.role || 'New role')}</h2><p>${f._scored ? 'Filled in and scored by Claude from the ad. Change anything that looks wrong.' : 'Filled from the ad where possible. Add what is missing and set the six scores.'}</p>
   <div class="formgrid">
    <div class="formfield"><label for="r-company">Company</label><input id="r-company" value="${attr(f.company || '')}"></div>
    <div class="formfield"><label for="r-role">Job title</label><input id="r-role" value="${attr(f.role || '')}"></div>
    <div class="formfield"><label for="r-market">Market</label><select id="r-market"><option ${f.market === 'UAE' ? 'selected' : ''}>UAE</option><option ${f.market === 'UK' ? 'selected' : ''}>UK</option></select></div>
    <div class="formfield"><label for="r-location">Location</label><input id="r-location" value="${attr(f.location || '')}"></div>
    <div class="formfield"><label for="r-industry">Industry</label><input id="r-industry" value="${attr(f.industry || '')}"></div>
    <div class="formfield"><label for="r-salary">Pay (as stated)</label><input id="r-salary" value="${attr(f.salary || '')}"></div>
    <div class="formfield"><label for="r-deadline">Closing date</label><input id="r-deadline" type="date" value="${attr(/^\d{4}-\d\d-\d\d$/.test(f.deadline || '') ? f.deadline : '')}"></div>
    <div class="formfield"><label for="r-source">Source</label><input id="r-source" value="${attr(f.source || '')}"></div>
    <div class="formfield full"><label for="r-url">Job link</label><input id="r-url" value="${attr(f.job_url || '')}"></div>
    <div class="formfield full"><label for="r-apply">Application form link (if different)</label><input id="r-apply" value="${attr(f.apply_url && f.apply_url !== f.job_url ? f.apply_url : '')}"></div>
    <div class="formfield full"><label for="r-jd">Ad summary</label><textarea id="r-jd" rows="5">${esc(f.jd_text || '')}</textarea></div>
    <div class="formfield full"><label for="r-ev">Evidence (one per line)</label><textarea id="r-ev" rows="3">${esc(lines(f.evidence).join('\n'))}</textarea></div>
    <div class="formfield full"><label for="r-gaps">Gaps and open questions (one per line)</label><textarea id="r-gaps" rows="3">${esc(lines(f.gaps).join('\n'))}</textarea></div>
    ${RUBRIC.map(([k, , max]) => num(k, max)).join('')}
    <label class="checkline full"><input type="checkbox" id="r-adj" ${f.adjacent_title ? 'checked' : ''}> Adjacent title (scored one point lower on fit)</label>
    <label class="checkline full"><input type="checkbox" id="r-ko" ${f.knockout ? 'checked' : ''}> Knock-out${f.knockout_reason ? ': ' + esc(f.knockout_reason) : ''} (counted only, not saved)</label>
   </div>
   <div class="notice" id="r-preview" style="margin-top:12px"></div>
   <div class="modalfoot">${f._scored ? '' : `<button class="btn" id="r-chat" title="Opens a prompt to paste into a Claude chat. Edits made here are replaced by Claude's reading.">Fill and score with Claude chat</button>`}<button class="btn" data-act="closeModal">Cancel</button><button class="btn primary" id="r-save">Save role</button></div>`, 'wide');
  const read = () => Object.fromEntries(RUBRIC.map(([k]) => [k, +$('rb-' + k).value || 0]));
  const prev = () => { const { score, fit } = computeFit(read(), { adjacent: $('r-adj').checked, knockout: $('r-ko').checked }); $('r-preview').textContent = `Fit score ${score}/100 · Fit ${fit} · ${fit >= 3 ? 'goes to Discovery' : fit === 2 ? 'goes to the screened-out archive' : 'counted only, not saved'}`; };
  $('modal-box').querySelectorAll('input').forEach(i => i.addEventListener('input', prev)); prev();
  if ($('r-chat')) $('r-chat').onclick = () => chatHandoff({ eyebrow: 'Add role', title: 'Read and score the ad with Claude chat', prompt: AI.chatPrompt(AI.jobAdPrompt({ url: f.job_url || '', pageText: f._page || f.jd_text || '', docs: docs() })), note: f._page || f.jd_text ? '' : 'Claude will open the job link itself.',
    onReply: async text => { const ai = AI.extractJson(text); const m = { ...f }; for (const [k, v] of Object.entries(ai)) if (v !== '' && v != null && !(Array.isArray(v) && !v.length)) m[k] = v; if (ai.jd_summary) m.jd_text = ai.jd_summary; m._scored = true; closeModalKeep = false; openRoleForm(m); if (ai.blocked) toast('Claude could not open the page: ' + ai.blocked); } });
  $('r-save').onclick = async () => {
    const g = id => $(id).value.trim();
    if (!g('r-company') || !g('r-role')) { toast('Company and job title are needed'); return; }
    const br = read(), { score, fit } = computeFit(br, { adjacent: $('r-adj').checked, knockout: $('r-ko').checked });
    const key = norm(g('r-company') + ' ' + g('r-role'));
    if (S.blocklist.some(b => norm(b.value) === norm(g('r-company')) && b.kind === 'company' || norm(b.value) === key)) { toast('That company or role is on your blocklist'); return; }
    const dup = S.jobs.find(j => norm(j.company + ' ' + j.role) === key && !['dismissed', 'closed'].includes(j.stage));
    if (dup && !await confirmBox('This looks like a duplicate', `${dup.company} · ${dup.role} is already tracked (${statusOf(dup)}). Save another copy anyway?`, 'Save anyway')) return;
    if (fit === 1) { S.knockouts_counted = (S.knockouts_counted || 0) + 1; await save(); closeModal(); renderAll(); toast('Fit 1: counted only, not saved.'); return; }
    const j = { id: uid('j'), company: g('r-company'), role: g('r-role'), market: g('r-market'), location: g('r-location'), industry: g('r-industry'), salary: g('r-salary'), deadline: g('r-deadline'), source: g('r-source') || 'Manual', job_url: g('r-url'), apply_url: g('r-apply') || g('r-url'), jd_text: g('r-jd'), evidence: lines(g('r-ev')), gaps: lines(g('r-gaps')), breakdown: br, fit_score: score, fit, adjacent: $('r-adj').checked, low_confidence: !!f.low_confidence || !g('r-jd') || !g('r-salary'), years_asked: f.years_asked || '', certs_asked: f.certs_asked || '', stage: fit >= 3 ? 'discovery' : 'archived', reason: fit === 2 ? lines(g('r-gaps'))[0] || 'Fit 2' : '', created_at: now(), updated_at: now(), first_seen: now().slice(0, 10), added_by: 'Add role' };
    S.jobs.unshift(j); await save(); closeModal(); renderAll();
    toast(fit >= 3 ? `Saved to Discovery · fit ${fit}` : 'Fit 2: saved to the screened-out archive');
    if (fit >= 3) go('discovery');
  };
}
function openJobModal(id) {
  const j = job(id); if (!j) return;
  const b = j.breakdown;
  const meta = [j.salary && 'Pay: ' + esc(j.salary), j.years_asked && 'Years asked: ' + esc(j.years_asked), j.certs_asked && 'Certifications asked: ' + esc(j.certs_asked), j.source && 'Source: ' + esc(j.source), j.first_seen && 'First seen: ' + esc(j.first_seen), j.deadline && 'Closes: ' + esc(j.deadline)].filter(Boolean).join(' · ');
  const canShort = ['discovery', 'archived'].includes(j.stage);
  openModal(`<div class="eyebrow">${esc([j.market, j.location, j.industry].filter(Boolean).join(' · '))}</div><h2>${esc(j.company)} · ${esc(j.role)}</h2><p>${meta}${j.job_url ? ` · <a href="${attr(safeUrl(j.job_url))}" target="_blank" rel="noopener noreferrer">Open listing ↗</a>` : ''}</p>
   <div class="panel-head"><h2 style="font-size:17px">Why this score</h2><span class="tag green">Fit ${esc(j.fit || '—')}${j.fit_score ? ' · ' + j.fit_score + '/100' : ''}</span></div>
   ${b ? RUBRIC.map(([k, n, max]) => `<div class="meter"><span>${n}</span><div class="meterbar"><i style="width:${(+b[k] || 0) / max * 100}%"></i></div><b>${+b[k] || 0}/${max}</b></div>`).join('') : '<p class="tiny">No subscores recorded.</p>'}
   <b class="tiny">Evidence</b><ul class="bullets">${lines(j.evidence).map(x => `<li>${esc(x)}</li>`).join('') || '<li>None saved</li>'}</ul>
   <b class="tiny">Gaps and open questions</b><ul class="bullets gap">${lines(j.gaps).map(x => `<li>${esc(x)}</li>`).join('') || '<li>None recorded</li>'}</ul>
   ${j.low_confidence ? '<p class="tiny">Low confidence: thin ad or pay not stated.</p>' : ''}
   ${j.jd_text ? `<details class="more"><summary>Ad summary</summary><p style="white-space:pre-wrap;font-size:14.5px">${esc(j.jd_text)}</p></details>` : ''}
   ${(j.history || []).length ? `<details class="more"><summary>Status history (${j.history.length})</summary><ul class="bullets">${[...j.history].reverse().map(h => `<li>${esc(fmtDate(h.date, false))} · ${esc(h.from)} → <b>${esc(h.to)}</b>${h.note ? ' · ' + esc(h.note) : ''}</li>`).join('')}</ul></details>` : ''}
   <div class="modalfoot">${canShort ? `<button class="btn danger" data-act="dismiss" data-arg="${attr(id)}">Dismiss</button><button class="btn primary" data-act="shortlist" data-arg="${attr(id)}">Add to shortlist</button>` : ['shortlisted', 'review', 'application', 'submitted', 'interview'].includes(j.stage) ? `<button class="btn danger" data-act="closeJob" data-arg="${attr(id)}">Mark Closed</button>` : ''}${j.stage === 'shortlisted' ? `<button class="btn primary" data-act="startApplication" data-arg="${attr(id)}">Start application</button>` : ''}<button class="btn" data-act="changeStatus" data-arg="${attr(id)}">Change status</button><button class="btn" data-act="closeModal">Close</button></div>`, 'wide');
}

/* ----- Run search ----- */
function searchMarkets() {
  const all = S.profile.markets || ['UAE', 'UK'];
  const pick = local.get('search_market', '') || (activeMarket === 'all' ? 'Both' : activeMarket);
  return pick === 'Both' ? all : all.includes(pick) ? [pick] : all;
}
function marketPicker(markets) {
  const cur = markets.length > 1 ? 'Both' : markets[0];
  return `<div class="seg" role="group" aria-label="Markets to search" style="margin:0 0 12px">${['UK', 'UAE', 'Both'].map(m => `<button class="btn sm ${m === cur ? 'primary' : ''}" data-act="pickSearchMarket" data-arg="${m}" aria-pressed="${m === cur}">${m}</button>`).join(' ')}</div>`;
}
// Only what is new since the last finished search of these markets (saves Claude usage).
function searchSince(markets) {
  const r = S.runs.find(r => r.kind === 'search' && ['done', 'complete', 'completed'].includes(r.status) && markets.every(m => (r.markets || []).includes(m)));
  return r ? (r.started_at || '').slice(0, 10) : '';
}
async function runSearch() {
  const markets = searchMarkets();
  if (S.runs.some(r => r.kind === 'search' && r.status === 'running')) { toast('A search is already running'); return; }
  const sources = S.sources.filter(s => s.enabled && (markets.includes(s.market) || s.market === 'Both'));
  if (!sources.length) { S.runs.unshift({ id: uid('r'), kind: 'search', markets, status: 'blocked', started_at: now(), funnel: {}, skipped: [], summary: 'No search sources are switched on for ' + markets.join(' and ') + '.' }); await save(); renderAll(); toast('No search sources are switched on. Choose them in Search settings.'); return; }
  const args = { markets, since: searchSince(markets), sources, known: S.jobs.map(j => `${j.company} — ${j.role} — ${j.location || ''}`), blocked: S.blocklist.map(b => b.value), docs: docs() };
  if (!apiKey()) {
    chatHandoff({ eyebrow: `Run search · ${markets.length > 1 ? 'Both' : markets[0]}`, top: marketPicker(markets), title: 'Search with Claude chat', prompt: AI.chatPrompt(AI.searchPrompt(args)), note: 'Use a Claude chat with web search switched on. The search takes a few minutes there.', cloud: { kind: 'search', ref: { markets }, title: 'Run search · ' + markets.join(' + ') },
      onReply: async text => { const res = AI.extractJson(text); const run = { id: uid('r'), kind: 'search', markets, status: 'running', started_at: now(), funnel: {}, skipped: [], via: 'chat' }; S.runs.unshift(run); applySearch(run, markets, res); await save(); renderAll(); go('home'); } });
    return;
  }
  const run = { id: uid('r'), kind: 'search', markets, status: 'running', started_at: now(), funnel: {}, skipped: [] };
  S.runs.unshift(run);
  await save(); renderAll(); go('home');
  busy(`Searching ${markets.join(' and ')}…`);
  try {
    const res = await AI.searchRoles({ key: apiKey(), model: model(), ...args, onProgress: t => busy(t.slice(0, 90)) });
    applySearch(run, markets, res);
  } catch (e) { run.status = 'failed'; run.summary = e.message; toast('Search failed: ' + e.message); }
  finally { busy(); await save(); renderAll(); }
}
function applySearch(run, markets, res) {
  let savedTotal = 0;
  for (const m of markets) {
    const r = res.markets?.[m] || {};
    const f = { looked_at: +r.looked_at || 0, duplicates: (+r.duplicates || 0) + (+r.already_tracked || 0), blocked: +r.blocked || 0, knockout: +r.knockout || 0, knockout_reasons: r.knockout_reasons || {}, archived: 0, saved: 0 };
    for (const x of r.roles || []) {
      if (!x || !x.company || !x.role) continue;
      const key = norm(x.company + ' ' + x.role);
      if (S.jobs.some(j => norm(j.company + ' ' + j.role) === key || (x.job_url && j.job_url === x.job_url))) { f.duplicates++; continue; }
      if (S.blocklist.some(b => norm(b.value) === key || (b.kind === 'company' && norm(b.value) === norm(x.company)) || (b.kind === 'url' && b.value === x.job_url))) { f.blocked++; continue; }
      const { score, fit } = computeFit(x.breakdown, { adjacent: x.adjacent_title });
      if (fit <= 1) { f.knockout++; S.knockouts_counted++; continue; }
      S.jobs.unshift({ id: uid('j'), company: x.company, role: x.role, market: m, location: x.location, industry: x.industry, salary: x.salary, deadline: x.deadline, source: x.source, also_seen_on: x.also_seen_on || [], job_url: x.job_url, apply_url: x.apply_url || x.job_url, jd_text: x.jd_summary, evidence: x.evidence || [], gaps: x.gaps || [], breakdown: x.breakdown, fit_score: score, fit, adjacent: !!x.adjacent_title, low_confidence: !!x.low_confidence, years_asked: x.years_asked || '', certs_asked: x.certs_asked || '', stage: fit >= 3 ? 'discovery' : 'archived', reason: fit === 2 ? (x.gaps || [])[0] || 'Fit 2' : '', created_at: now(), updated_at: now(), first_seen: now().slice(0, 10), added_by: 'Run search', run_id: run.id });
      fit >= 3 ? (f.saved++, savedTotal++) : f.archived++;
    }
    f.looked_at = Math.max(f.looked_at, f.duplicates + f.blocked + f.knockout + f.archived + f.saved);
    run.funnel[m] = f;
  }
  run.skipped = res.skipped_sources || [];
  run.status = 'done'; run.ended_at = now();
  run.summary = `${savedTotal} new role${savedTotal === 1 ? '' : 's'} in Discovery.`;
  toast(run.summary);
}

/* ----- Copy prompt for Claude chat (no API key) ----- */
const CLOUD_COPY = {
  search: ['Takes 5–10 minutes. Results appear on Home under Search runs.'],
  pack: ['Takes a few minutes. The pack appears in Review.'],
  prep: ['Takes a few minutes. The notes appear on this interview.'],
  gmail: ['Takes a few minutes. Suggestions appear on Home under From Gmail.'],
  answers: ['Takes a few minutes. The drafts appear under Needs your answer for you to approve.'],
};
function chatHandoff({ eyebrow = '', title, prompt, note = '', onReply, cloud, cloudTitle, top = '' }) {
  const canCloud = cloud && ext.ready && ext.runner;
  const chatSteps = `<ol class="steps"><li><b>Copy the prompt and open Claude.</b> The prompt holds what this step needs: your documents and rules, and the job.<div class="actions" style="margin-top:6px"><button class="btn sm ${canCloud ? '' : 'primary'}" id="ch-copy">Copy prompt &amp; open Claude ↗</button></div></li>
   <li><b>Paste it into the new Claude chat</b> and send it.${note ? ` <span class="tiny">${esc(note)}</span>` : ''}</li>
   <li><b>Copy Claude's whole reply</b> and paste it here.<div id="ch-paste" hidden><textarea id="ch-reply" class="field" style="width:100%;min-height:150px;margin-top:6px" placeholder="Paste Claude's reply"></textarea><div class="actions" style="margin-top:6px"><button class="btn primary" id="ch-use" disabled>Use this reply</button></div></div><div class="tiny" id="ch-wait">The paste box appears once you have copied the prompt. <a href="#" id="ch-skip">I already have a reply</a></div></li></ol>
   <textarea readonly id="ch-prompt" style="position:absolute;left:-9999px;width:1px;height:1px">${esc(prompt)}</textarea>`;
  openModal(canCloud
    ? `${eyebrow && eyebrow !== (cloudTitle || eyebrow) ? `<div class="eyebrow">${esc(eyebrow)}</div>` : ''}<h2>${esc(cloudTitle || eyebrow || title)}</h2>${top}
   <p>Your Northstar runner does this on your Claude subscription and sends the result back here. No copy-paste.</p>
   <div class="actions"><button class="btn primary" id="ch-cloud" style="font-size:16px;padding:12px 22px">Send to Northstar runner</button></div>
   <p class="tiny">${esc((CLOUD_COPY[cloud.kind] || ['Takes a few minutes. The result appears here by itself.'])[0])}</p>
   <details class="more" id="ch-more"><summary>Do it in a Claude chat instead</summary>${chatSteps}</details>
   <div class="modalfoot"><button class="btn" data-act="closeModal">Cancel</button></div>`
    : `<div class="eyebrow">${esc(eyebrow)}</div><h2>${esc(title)}</h2>${top}${chatSteps}
   <div class="modalfoot"><button class="btn" data-act="closeModal">Cancel</button></div>`, 'wide');
  if (canCloud) $('ch-cloud').onclick = async () => { $('ch-cloud').disabled = true; $('ch-cloud').textContent = 'Sending…'; try { await fireCloud({ ...cloud, prompt }); closeModal(); } catch (e) { toast(e.message); $('ch-cloud').disabled = false; $('ch-cloud').textContent = 'Send to Northstar runner'; } };
  const showPaste = () => { $('ch-paste').hidden = false; $('ch-wait').hidden = true; $('ch-reply').focus(); };
  $('ch-skip').onclick = e => { e.preventDefault(); showPaste(); };
  $('ch-reply').oninput = () => { $('ch-use').disabled = !$('ch-reply').value.trim(); };
  $('ch-copy').onclick = async () => {
    // copy while this page still has focus, then open Claude (still inside the click, so it is not blocked)
    try { await navigator.clipboard.writeText(prompt); }
    catch { const t = $('ch-prompt'); t.select(); document.execCommand('copy'); }
    window.open('https://claude.ai/new', '_blank', 'noopener');
    $('ch-copy').textContent = 'Copied ✓ Claude opened in a new tab'; toast('Prompt copied. Paste it into the new Claude chat.');
    showPaste();
  };
  $('ch-use').onclick = async () => {
    const text = $('ch-reply').value.trim();
    if (!text) { toast("Paste Claude's reply first"); return; }
    try { closeModalKeep = true; await onReply(text); if (closeModalKeep) closeModal(); }
    catch (e) { toast(e.message); }
  };
}
let closeModalKeep = false;

/* ----- Northstar runner (cloud routine fired through the extension) ----- */
const CLOUD_MAX = 65000;
function cloudText(id, kind, prompt) {
  const head = `NORTHSTAR CLOUD REQUEST\nrequest_id: ${id}\nkind: ${kind === 'answers' ? 'pack' : kind}\nsent_at: ${now()}\n\nDo the task below for Sere. Finish with the answer exactly in the form the task asks for.\n\n=====\n\n`;
  let p = prompt;
  // Too long for one runner request: leave out the search profile first (a pack or prep does not need it);
  // the CV, playbook and answers are never cut. If it still does not fit, stop here instead of sending a request the runner cannot do.
  if ((head + p).length > CLOUD_MAX && kind !== 'search') p = p.replace(/<search_profile>[\s\S]*?<\/search_profile>/, '<search_profile>Left out of this request to keep it short. Use the master CV, playbook and confirmed answers.</search_profile>');
  if ((head + p).length > CLOUD_MAX) throw Error('This request is too long for the cloud runner. Use "Do it in a Claude chat instead".');
  return head + p;
}
async function fireCloud({ kind, ref, title, prompt }) {
  const id = uid('c');
  const text = cloudText(id, kind, prompt);
  const r = await extRequest({ type: 'fire', text, request_id: id }, 30000);
  if (!r.ok) throw Error(r.error || 'The runner did not start');
  const req = { id, kind, ref, title, status: 'waiting', fired_at: now(), session_url: r.session_url || '' };
  S.cloud = S.cloud || []; S.cloud.unshift(req);
  if (kind === 'search') S.runs.unshift({ id: uid('r'), kind: 'search', markets: ref.markets, status: 'running', started_at: now(), funnel: {}, skipped: [], via: 'cloud', cloud_id: id, summary: 'Running in the cloud.' });
  if (kind === 'pack') { const j = job(ref.job_id); if (j) { j.stage = 'drafting'; j.updated_at = now(); } }
  await save(); renderAll();
  toast('Sent to your Northstar runner. The result appears here when it is done, usually within 10 minutes.');
  return req;
}
async function applyCloudResult(req, text) {
  if (req.kind === 'search') {
    const res = AI.extractJson(text);
    let run = S.runs.find(r => r.cloud_id === req.id);
    if (!run) { run = { id: uid('r'), kind: 'search', markets: req.ref.markets, status: 'running', started_at: req.fired_at, funnel: {}, skipped: [], via: 'cloud', cloud_id: req.id }; S.runs.unshift(run); }
    applySearch(run, req.ref.markets, res);
  } else if (req.kind === 'pack') {
    const j = job(req.ref.job_id); if (!j) throw Error('That role is no longer in Northstar');
    applyPackResult(j, AI.extractJson(text), 'northstar-runner'); j.stage = 'review'; j.updated_at = now();
    toast(`${j.company}: draft added. Answer the claims, read it, then approve.`);
  } else if (req.kind === 'gmail') {
    applyGmail(text, req.fired_at);
  } else if (req.kind === 'answers') {
    applySuggestions(req.ref.qs || [], text);
  } else if (req.kind === 'prep') {
    const i = S.interviews.find(x => x.id === req.ref.interview_id); if (!i) throw Error('That interview is no longer in Northstar');
    const md = String(text).replace(/^\s*```(?:markdown|md)?\s*\n([\s\S]*?)\n```\s*$/i, '$1').trim();
    if (!md) throw Error('The result is empty');
    i.prep_md = (i.prep_md ? i.prep_md + '\n\n---\n\n' : '') + md;
    toast('Prep notes added. Edit them any time.');
  }
  req.status = 'done'; req.done_at = now(); req.error = '';
  await save(); renderAll();
}
function cloudCleanup(req, why) {
  req.status = why; req.done_at = now();
  if (req.kind === 'search') { const run = S.runs.find(r => r.cloud_id === req.id); if (run && run.status === 'running') { run.status = 'failed'; run.summary = 'Cloud run removed before a result arrived.'; } }
  if (req.kind === 'pack') { const j = job(req.ref.job_id); if (j && j.stage === 'drafting') j.stage = latestPack(j.id) ? 'review' : 'shortlisted'; }
}
// Results come back through a private GitHub repository: the runner commits results/<request_id>.json,
// and this device reads it with a read-only token kept in this browser only.
const RESULTS_BRANCH = 'claude/results';
const ghRepo = () => local.get('gh_repo', ''), ghToken = () => local.get('gh_token', '');
let cloudPolling = false;
async function pollCloud(manual = false) {
  const waiting = (S?.cloud || []).filter(r => r.status === 'waiting');
  if (!waiting.length || cloudPolling) { if (manual && !waiting.length) toast('No cloud run is waiting'); return; }
  if (!ghRepo() || !ghToken()) { if (manual) toast('Add the results repository and token in Career profile › Data & connections'); return; }
  cloudPolling = true; let got = 0, problem = '';
  try {
    for (const req of waiting) {
      let r;
      try { r = await fetch(`https://api.github.com/repos/${ghRepo()}/contents/results/${encodeURIComponent(req.id)}.json?ref=${encodeURIComponent(RESULTS_BRANCH)}&t=${Date.now()}`, { headers: { Authorization: 'Bearer ' + ghToken(), Accept: 'application/vnd.github.raw+json', 'X-GitHub-Api-Version': '2022-11-28' }, cache: 'no-store' }); }
      catch (e) { problem = 'GitHub could not be reached'; break; }
      if (r.status === 404) { if (Date.now() - Date.parse(req.fired_at) > 3 * 36e5 && !req.error) { req.error = 'No result after 3 hours. Open Watch to see what happened.'; await save(); renderCloud(); } continue; }
      if (r.status === 401 || r.status === 403) { problem = 'GitHub refused the results token. Check it in Data & connections.'; break; }
      if (!r.ok) { problem = 'GitHub answered ' + r.status; break; }
      let d; try { d = JSON.parse(await r.text()); } catch { req.error = 'The result file could not be read. Use Paste result.'; continue; }
      if (d.request_id && d.request_id !== req.id) continue;
      if (!d.ok) { req.error = 'The runner could not finish: ' + String(d.error || 'no reason given').slice(0, 300); cloudCleanup(req, 'failed'); await save(); renderAll(); toast(`${req.title}: ${req.error} You can send it again.`); continue; }
      try { await applyCloudResult(req, String(d.answer || '')); got++; }
      catch (e) { req.error = e.message + ' Use Paste result to try again.'; await save(); renderCloud(); }
    }
  } finally { cloudPolling = false; }
  if (problem && manual) toast(problem);
  else if (manual && !got) toast('No new results yet');
  local.set('gh_last_check', now()); if (problem) local.set('gh_problem', problem); else local.set('gh_problem', '');
}
// Search results this device never received (for example after its data was reset) are picked up from the repository too.
async function pullMissedResults(manual = false) {
  if (!ghRepo() || !ghToken() || !S) return 0;
  const h = { Authorization: 'Bearer ' + ghToken(), 'X-GitHub-Api-Version': '2022-11-28' };
  let r; try { r = await fetch(`https://api.github.com/repos/${ghRepo()}/contents/results?ref=${encodeURIComponent(RESULTS_BRANCH)}&t=${Date.now()}`, { headers: { ...h, Accept: 'application/vnd.github+json' }, cache: 'no-store' }); } catch { return 0; }
  if (!r.ok) return 0;
  const files = (await r.json()).filter(f => /^[a-z0-9]+\.json$/.test(f.name));
  S.cloud = S.cloud || []; let got = 0;
  for (const f of files) {
    const id = f.name.replace(/\.json$/, '');
    if (S.cloud.some(x => x.id === id)) continue;
    let d; try { const g = await fetch(`https://api.github.com/repos/${ghRepo()}/contents/results/${f.name}?ref=${encodeURIComponent(RESULTS_BRANCH)}`, { headers: { ...h, Accept: 'application/vnd.github.raw+json' }, cache: 'no-store' }); d = JSON.parse(await g.text()); } catch { continue; }
    const req = { id, kind: d.kind, ref: {}, title: 'Earlier ' + (d.kind || 'run') + ' result', status: 'waiting', fired_at: d.finished_at || now(), session_url: '' };
    if (d.kind !== 'search' || !d.ok) { req.status = 'removed'; req.done_at = now(); req.error = d.ok ? 'Only search results can be matched without the original request' : String(d.error || ''); S.cloud.push(req); continue; }
    try { const res = AI.extractJson(String(d.answer || '')); req.ref = { markets: Object.keys(res.markets || {}) }; req.title = 'Run search · ' + req.ref.markets.join(' + '); S.cloud.push(req); await applyCloudResult(req, String(d.answer || '')); got++; }
    catch (e) { req.status = 'removed'; req.error = e.message; }
  }
  await save();
  if (manual && got) toast(`Picked up ${got} earlier search result${got === 1 ? '' : 's'}.`);
  return got;
}
setInterval(() => { if (document.visibilityState === 'visible') pollCloud(); }, 60000);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') pollCloud(); });

// Each field is kept as soon as you leave it, so switching tabs to copy the token can't wipe the other one.
function saveRunnerField(id) {
  const el = $(id); if (!el) return true;
  if (id === 'gh-repo') {
    const repo = el.value.trim().replace(/^https?:\/\/(www\.)?github\.com\//i, '').replace(/\.git$/i, '').replace(/\/+$/, '');
    if (repo && !/^[\w.-]+\/[\w.-]+$/.test(repo)) { toast('Write the repository as owner/name, for example SerenaGall9/northstar-results'); return false; }
    local.set('gh_repo', repo); el.value = repo;
  } else {
    const t = el.value.trim(); if (t && t !== '••••••••') local.set('gh_token', t);
  }
  return true;
}
document.addEventListener('change', e => { if (e.target && (e.target.id === 'gh-repo' || e.target.id === 'gh-token')) saveRunnerField(e.target.id); });

async function renderBackups() {
  const box = $('backup-list'); if (!box) return;
  const list = (await dbGet('backups')) || [];
  box.innerHTML = list.length ? `<b>Safety copies</b> (kept automatically in this browser)<ul class="bullets">${list.map((b, i) => `<li>${esc(fmtDate(b.at))} · ${esc(b.reason)} · ${b.counts.roles} roles, ${b.counts.packs} packs, ${b.counts.answers} answers <button class="btn sm" data-act="restoreBackup" data-arg="${i}">Restore</button></li>`).join('')}</ul>` : 'No safety copies yet. One is made automatically when you open Northstar and before any import.';
}
function renderCloud() {
  const box = $('cloud-card'); if (!box) return;
  const list = (S.cloud || []).filter(r => r.status === 'waiting' || Date.parse(r.done_at || r.fired_at) > Date.now() - 3 * 864e5).slice(0, 12);
  box.hidden = !list.length;
  if (!list.length) return;
  const tag = r => r.status === 'waiting' ? '<span class="tag blue">Working…</span>' : r.status === 'done' ? '<span class="tag green">Added</span>' : '<span class="tag gray">Removed</span>';
  $('cloud-list').innerHTML = (list.some(r => r.status === 'waiting') ? `<div class="tiny" style="margin-bottom:6px">${ghRepo() && ghToken() ? 'Northstar checks for results every minute while this page is open.' : 'Results arrive by themselves once the results repository is set in Data & connections. Until then, use Paste result.'} <a href="#" data-act="cloudCheck">Check now</a></div>` : '') + list.map(r => `<div class="listrow"><span><b>${esc(r.title)}</b><br><span class="tiny">Sent ${fmtDate(r.fired_at)}${r.error ? ' · ' + esc(r.error) : ''}</span></span><span style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;justify-content:flex-end">${tag(r)}${r.session_url ? `<a class="btn sm" href="${attr(r.session_url)}" target="_blank" rel="noopener noreferrer">Watch ↗</a>` : ''}${r.status === 'waiting' ? `<button class="btn sm" data-act="cloudPaste" data-arg="${attr(r.id)}">Paste result</button><button class="btn sm" data-act="cloudRemove" data-arg="${attr(r.id)}">Remove</button>` : ''}</span></div>`).join('');
}

/* ----- Packs ----- */
async function startApplication(id) {
  const j = job(id);
  closeModal();
  j.stage = 'review'; j.updated_at = now();
  await save();
  if (apiKey()) return draftPackFor(id);
  renderAll(); ACT.goReview(id);
  chatPack(id);
}
// Claims answered on this version (not carried over from an earlier one) that a new version has not used yet
const freshClaims = p => (p?.claims || []).filter(c => c.state !== 'open' && !c.carried);
const needsFix = p => !!p && p.status === 'draft' && ((p.change_requests || []).length > 0 || freshClaims(p).length > 0);
function packArgs(j) {
  const prev = latestPack(j.id), redo = needsFix(prev);
  const claimNotes = redo ? freshClaims(prev).map(c => c.state === 'na' ? `${c.question}: does not apply` : `${c.question}: ${c.answer}`) : [];
  return { job: j, docs: docs(), answers: S.answers, changeRequests: prev?.change_requests || [], previous: redo ? prev : null, claimNotes };
}
function applyPackResult(j, r, origin) {
  if (!r.sections || !r.cover_letter) throw Error('The reply is missing the CV sections or the cover letter. Copy the whole reply and try again.');
  addPack(j, { sections: r.sections, cl_md: r.cover_letter, claims: (r.claims || []).map(c => ({ question: c.question || String(c), why: c.why || '', state: 'open', answer: '' })), quality: r.quality, gaps: r.gaps, origin });
}
function chatPack(id) {
  const j = job(id);
  if (!S.docs.master_cv) { toast('Import your setup file first (Career profile › Data & connections)'); return; }
  const isNew = !!latestPack(id);
  chatHandoff({ eyebrow: `${j.company} · ${j.role}`, title: isNew ? 'New version with Claude chat' : 'Draft the pack with Claude chat', cloudTitle: isNew ? 'Make a new version' : 'Draft the pack', prompt: AI.chatPrompt(AI.packPrompt(packArgs(j))), cloud: { kind: 'pack', ref: { job_id: id }, title: `${isNew ? 'New version' : 'Pack'} · ${j.company}` },
    onReply: async text => { applyPackResult(j, AI.extractJson(text), 'claude-chat'); j.stage = 'review'; await save(); renderAll(); ACT.goReview(id); toast('Draft added. Answer the claims, read it, then approve.'); } });
}
async function draftPackFor(id) {
  const j = job(id);
  if (!S.docs.master_cv) { toast('Import your setup file first (Career profile › Data & connections)'); return; }
  if (!apiKey()) return chatPack(id);
  j.stage = 'drafting'; await save(); renderAll(); ACT.goReview(id);
  busy(`Drafting the ${j.company} pack…`);
  try {
    applyPackResult(j, await AI.draftPack({ key: apiKey(), model: model(), ...packArgs(j) }), 'assistant');
    toast('Draft ready for your review');
  } catch (e) { toast('Drafting failed: ' + e.message); }
  finally { j.stage = 'review'; busy(); await save(); renderAll(); }
}
function addPack(j, { sections, cl_md, claims = [], quality = null, gaps = [], origin }) {
  const prev = latestPack(j.id);
  if (prev && prev.status === 'draft') prev.status = 'superseded';
  const cv_md = composeCV(sections, j.market);
  const p = { id: uid('p'), job_id: j.id, version: (prev?.version || 0) + 1, status: 'draft', sections, cv_md, cl_md, claims, quality, gaps, change_requests: [], origin, created_at: now() };
  p.hash = hash(cv_md + '\n' + cl_md);
  // carry over claims already answered in the previous version
  if (prev) p.claims.forEach(c => { const o = (prev.claims || []).find(x => norm(x.question) === norm(c.question) && x.state !== 'open'); if (o) { c.state = o.state; c.answer = o.answer; c.carried = true; } });
  S.packs.push(p);
  reviewUI[j.id] = { open: true, read: false };
  return p;
}
function editorHtml(fields, kind) {
  return `<div class="editor"><div><div class="edtabs">${fields.map((f, i) => `<button class="btn sm ${i ? '' : 'soft'}" data-edtab="${i}">${esc(f.label)}</button>`).join('')}</div>${fields.map((f, i) => `<textarea data-edfield="${attr(f.id)}" style="${i ? 'display:none' : ''}" spellcheck="true">${esc(f.value || '')}</textarea>`).join('')}</div><div><div class="tiny" style="margin-bottom:8px">Live preview</div><div class="paper ${kind === 'letter' ? 'letter' : ''}" id="ed-preview"></div></div></div>`;
}
let previewFn = null;
function editorValues() { return Object.fromEntries([...document.querySelectorAll('[data-edfield]')].map(t => [t.dataset.edfield, t.value])); }
function wireEditor(fn) {
  previewFn = fn;
  const upd = () => { $('ed-preview').innerHTML = mdToHtml(previewFn(editorValues(), currentEdTab)); };
  let currentEdTab = 0;
  document.querySelectorAll('[data-edtab]').forEach(b => b.onclick = () => { currentEdTab = +b.dataset.edtab; document.querySelectorAll('[data-edtab]').forEach(x => x.classList.toggle('soft', x === b)); document.querySelectorAll('[data-edfield]').forEach((t, i) => t.style.display = i === currentEdTab ? '' : 'none'); upd(); });
  document.querySelectorAll('[data-edfield]').forEach(t => t.addEventListener('input', upd));
  upd();
}
function editDraft(id) {
  const j = job(id), p = latestPack(id);
  const secs = p?.sections || {};
  const fields = [...TAILORED.map(s => ({ id: s, label: s.charAt(0) + s.slice(1).toLowerCase(), value: secs[s] ?? splitSections(S.docs.master_cv).body[s]?.join('\n').trim() ?? '' })), { id: 'cover_letter', label: 'Cover letter', value: p?.cl_md || '' }];
  openModal(`<div class="eyebrow">${esc(j.company)} · ${esc(j.role)}</div><h2>${p ? 'Edit draft v' + p.version : 'Write the draft'}</h2><p>Saved as a new version for your review. Only these three CV sections change; every other section stays your Master CV word for word.</p>${editorHtml(fields)}<div class="modalfoot"><button class="btn" data-act="closeModal">Cancel</button><button class="btn primary" id="ed-save">Save as new version</button></div>`, 'xwide');
  wireEditor((v, tab) => tab === 3 ? letterDoc({ job_id: id, created_at: now(), cl_md: v.cover_letter }) : composeCV(Object.fromEntries(TAILORED.map(s => [s, v[s]])), j.market));
  $('ed-save').onclick = async () => {
    const v = editorValues();
    if (!v.cover_letter.trim()) { toast('Write the cover letter too'); return; }
    const keepClaims = (p?.claims || []).map(c => ({ ...c }));
    addPack(j, { sections: Object.fromEntries(TAILORED.map(s => [s, v[s]])), cl_md: v.cover_letter, claims: keepClaims, quality: null, gaps: p?.gaps || [], origin: 'you' });
    j.stage = 'review'; await save(); closeModal(); renderAll(); toast('Saved as a new version. Read it and approve when ready.');
  };
}
function answerKey(question, scope) { return norm(question).slice(0, 80) + (scope && scope !== 'both' ? '|' + scope : ''); }
function upsertAnswer({ question, answer, kind = 'form', confirmed = true, scope = 'both', sensitive = false }) {
  const key = answerKey(question, scope);
  let a = S.answers.find(x => x.key === key);
  if (!a) { a = { key, question, created_at: now() }; S.answers.push(a); }
  Object.assign(a, { answer, kind, confirmed, scope, sensitive, updated_at: now() });
  return a;
}
function openAnswerForm(key) {
  const a = key ? S.answers.find(x => x.key === key) : null;
  formModal({ eyebrow: a ? 'Edit answer' : 'New answer', title: a ? a.question : 'Add a reusable answer', copy: 'Only confirmed answers are used on forms and in packs. Never put passwords here.', fields: [{ id: 'question', label: 'Question as forms ask it', value: a?.question || '', full: true }, { id: 'answer', label: 'Answer', type: 'textarea', value: a?.answer || '' }, { id: 'scope', label: 'Used for', type: 'select', options: [['both', 'Both markets'], ['UK', 'UK only'], ['UAE', 'UAE only']], value: a?.scope || 'both' }, { id: 'confirmed', label: 'Confirmed by me', type: 'checkbox', value: a ? a.confirmed : true }, { id: 'sensitive', label: 'Sensitive (masked; demographic or private)', type: 'checkbox', value: a?.sensitive }],
    extra: a ? `<button class="btn danger" id="ans-del">Delete</button>` : '',
    onSave: async v => { if (!v.question.trim()) return false; if (a && a.key !== answerKey(v.question, v.scope)) S.answers = S.answers.filter(x => x !== a); if (a && v.confirmed) delete a.draft; if (a && v.answer.trim()) delete a.no_suggestion; upsertAnswer({ question: v.question.trim(), answer: v.answer.trim(), kind: a?.kind === 'question' && v.answer.trim() ? 'form' : (a?.kind || 'form'), confirmed: v.confirmed, scope: v.scope, sensitive: v.sensitive }); await save(); renderProfile(); } });
  if (a) $('ans-del').onclick = async () => { S.answers = S.answers.filter(x => x !== a); await save(); closeModal(); renderProfile(); };
}
function openInterviewForm(jid, iid) {
  const i = iid ? S.interviews.find(x => x.id === iid) : null;
  const opts = S.jobs.filter(j => ['application', 'submitted', 'interview'].includes(j.stage) || j.id === i?.job_id);
  if (!opts.length) { toast('Interviews attach to a submitted application. Record a submission first.'); return; }
  formModal({ eyebrow: 'Interview details', title: i ? 'Edit interview' : 'Add an invitation or stage', copy: 'Nothing is read from your calendar or email.', size: 'wide', fields: [
    { id: 'job', label: 'Application', type: 'select', options: opts.map(j => [j.id, `${j.company} · ${j.role}`]), value: i?.job_id || jid || opts[0].id, full: true },
    { id: 'stage', label: 'Stage', value: i?.stage || '', placeholder: 'e.g. Hiring manager, 45 min' },
    { id: 'when', label: 'Date and time', type: 'datetime-local', value: (i?.when_local || '').slice(0, 16) },
    { id: 'tz', label: 'Time zone', value: i?.tz || Intl.DateTimeFormat().resolvedOptions().timeZone },
    { id: 'link', label: 'Meeting link', value: i?.link || '' },
    { id: 'prep', label: 'Prep notes (Markdown: # headings, - bullets, **bold**)', type: 'textarea', rows: 10, value: i?.prep_md || '' },
    { id: 'artifacts', label: 'Materials (one per line)', type: 'textarea', rows: 3, value: (i?.artifacts || []).join('\n') }],
    onSave: async v => {
      const rec = i || { id: uid('i'), created_at: now() };
      Object.assign(rec, { job_id: v.job, stage: v.stage.trim(), when_local: v.when, tz: v.tz.trim(), link: v.link.trim(), prep_md: v.prep, artifacts: lines(v.artifacts) });
      if (!i) S.interviews.push(rec);
      const j = job(v.job); if (j && j.stage !== 'closed') { j.stage = 'interview'; j.updated_at = now(); }
      await save(); renderAll();
    } });
}

/* ----- Weekly report (recorded data only) ----- */
function weeklyReport() {
  const end = new Date(), start = new Date(end - 7 * 864e5);
  const inWk = t => t && new Date(t) >= start && new Date(t) <= end;
  const by = m => S.jobs.filter(j => !m || j.market === m);
  const runs = S.runs.filter(r => r.kind === 'search' && inWk(r.started_at));
  const sec = m => {
    const J = by(m);
    const added = J.filter(j => inWk(j.created_at));
    return `| Step | Count |\n|---|---|\n| Roles added to Discovery | ${added.filter(j => j.fit >= 3).length} |\n| Screened out (fit 2) | ${added.filter(j => j.fit === 2).length} |\n| Shortlisted | ${J.filter(j => inWk(j.shortlisted_at)).length} |\n| Pack versions drafted | ${S.packs.filter(p => inWk(p.created_at) && J.some(j => j.id === p.job_id)).length} |\n| Packs approved | ${S.packs.filter(p => inWk(p.approved_at) && J.some(j => j.id === p.job_id)).length} |\n| Applications submitted | ${J.filter(j => inWk(j.submitted_at)).length} |\n| Interviews scheduled | ${S.interviews.filter(i => inWk(i.created_at) && J.some(j => j.id === i.job_id)).length} |\n| Closed | ${J.filter(j => inWk(j.closed_at)).length} |`;
  };
  const sub = S.jobs.filter(j => inWk(j.submitted_at));
  const ints = S.interviews.filter(i => inWk(i.when_local) || inWk(i.created_at));
  const funnel = runs.map(r => `- ${fmtDate(r.started_at)} · ${(r.markets || []).join(' + ')} · ${r.summary || r.status}` + Object.entries(r.funnel || {}).map(([m, f]) => `\n  - ${m}: looked at ${f.looked_at}, ${f.duplicates} duplicates, ${f.blocked} blocked, ${f.knockout} knock-outs, ${f.archived} fit 2, ${f.saved} saved`).join('')).join('\n');
  const body = `# Weekly report\n*${fmtDate(start.toISOString(), false)} to ${fmtDate(end.toISOString(), false)} · made from recorded tracker data*\n\n## Summary\n- Searches run: ${runs.length}\n- New roles in Discovery: ${S.jobs.filter(j => inWk(j.created_at) && j.fit >= 3).length}\n- Applications submitted: ${sub.length}\n- Interviews: ${ints.length}\n- Open in Review: ${S.jobs.filter(j => j.stage === 'review').length} · ready to fill: ${S.jobs.filter(j => j.stage === 'application').length}\n\n## UAE\n${sec('UAE')}\n\n## UK\n${sec('UK')}\n\n## Search runs\n${funnel || 'No searches this week.'}\n\n## Submitted\n${sub.map(j => `- **${j.company}** · ${j.role}${j.receipt ? ' · ref ' + j.receipt : ''}`).join('\n') || 'None this week.'}\n\n## Interviews\n${ints.map(i => { const j = job(i.job_id) || {}; return `- **${j.company}** · ${i.stage || 'Interview'} · ${i.when_local ? fmtDate(i.when_local) : 'date to confirm'}${i.outcome ? ' · ' + i.outcome : ''}`; }).join('\n') || 'None this week.'}\n`;
  return { id: uid('w'), period_start: start.toISOString(), period_end: end.toISOString(), body_md: body };
}

/* ----- Document lifecycle cleanup: runs on open (at most once a day) and on state changes ----- */
function runCleanup(force) {
  const today = new Date().toISOString().slice(0, 10);
  if (!force && S.last_cleanup === today) return false;
  let n = 0;
  for (const j of S.jobs) {
    const ints = S.interviews.filter(i => i.job_id === j.id);
    const interviewDone = ints.length && ints.every(i => i.finished);
    const closedNoInterview = j.stage === 'closed' && !ints.length;
    if (interviewDone || closedNoInterview) for (const p of S.packs.filter(p => p.job_id === j.id && p.cv_md != null)) { p.cv_md = null; p.cl_md = null; p.sections = null; p.deleted_at = now(); n++; }
    if (['submitted', 'interview', 'closed'].includes(j.stage)) S.fills.filter(f => f.job_id === j.id && !f.cleared).forEach(f => { extSend({ type: 'clear', fill_id: f.id }); f.cleared = true; });
  }
  S.last_cleanup = today;
  return n;
}

/* ----- Files ----- */
function pickFile(accept, fn) { const i = document.createElement('input'); i.type = 'file'; i.accept = accept; i.onchange = async () => { const f = i.files[0]; if (f) fn(await f.text()); }; i.click(); }
async function importSetup(text) {
  let d; try { d = JSON.parse(text); } catch { toast('That file is not a Northstar setup file'); return; }
  if (!d.northstar_setup) { toast('That file is not a Northstar setup file'); return; }
  await backup('before importing the setup file', true);
  // A second import never overwrites documents you already have (you may have edited them here).
  for (const [k, v] of Object.entries(d.docs || {})) if (v && !S.docs[k]) S.docs[k] = v;
  const before = { a: S.answers.length, b: S.blocklist.length };
  S.profile = { ...S.profile, ...d.profile, contact: { ...(S.profile.contact || {}), ...(d.profile?.contact || {}) } };
  // Answers the setup file replaces are removed only if you have not edited them since.
  for (const r of d.remove_answers || []) S.answers = S.answers.filter(x => !(x.key === answerKey(r.question, r.scope) && x.answer === r.answer));
  const mergedKeys = new Set((S.answer_merged || []).map(m => m.key));
  for (const a of d.answers || []) { const k = answerKey(a.question, a.scope); if (!S.answers.some(x => x.key === k) && !mergedKeys.has(k)) upsertAnswer(a); }
  mergeDuplicateAnswers();
  for (const s of d.sources || []) if (!S.sources.some(x => norm(x.name) === norm(s.name) && x.market === s.market)) S.sources.push({ id: uid('s'), enabled: true, kind: 'board', ...s });
  for (const b of d.blocklist || []) if (b && b.value && !S.blocklist.some(x => x.kind === b.kind && norm(x.value) === norm(b.value))) S.blocklist.push({ id: uid('b'), created_at: now(), ...b });
  // Past roles from the old tracker: kept as Closed or Archived so they show in your history and searches skip them.
  let past = 0;
  for (const r of d.archive || []) {
    if (!r || !r.company || !r.role) continue;
    const key = norm(r.company + ' ' + r.role);
    if (S.jobs.some(j => norm(j.company + ' ' + j.role) === key || (r.job_url && j.job_url === r.job_url))) continue;
    S.jobs.push({ ...r, id: uid('j'), stage: r.stage === 'closed' ? 'closed' : 'archived', evidence: r.evidence || [], gaps: r.gaps || [] }); past++;
  }
  // Packs from the old tracker: the CV and letter text are kept exactly as they were, linked to their role.
  let packsIn = 0;
  for (const it of d.old_packs || []) {
    if (!it || !it.job || !it.pack || S.packs.some(p => p.old_app === it.app_id)) continue;
    const key = norm(it.job.company + ' ' + it.job.role);
    let j = S.jobs.find(x => x.old_id === it.app_id || norm(x.company + ' ' + x.role) === key || (it.job.job_url && x.job_url === it.job.job_url));
    if (!j) { j = { ...it.job, id: uid('j') }; S.jobs.push(j); }
    const prev = latestPack(j.id);
    const pk = { id: uid('p'), job_id: j.id, version: (prev?.version || 0) + 1, change_requests: [], quality: null, gaps: [], created_at: j.updated_at || now(), ...it.pack, old_app: it.app_id };
    pk.hash = hash(pk.cv_md + '\n' + pk.cl_md);
    if (pk.status === 'approved') pk.approved_at = pk.created_at;
    S.packs.push(pk); packsIn++;
    if (it.interview && !S.interviews.some(i => i.job_id === j.id)) S.interviews.push({ id: uid('i'), created_at: now(), job_id: j.id, ...it.interview });
  }
  await save(); closeModal(); renderAll(); toast(`Setup imported. Added ${Math.max(0, S.answers.length - before.a)} answers, ${S.blocklist.length - before.b} blocklist entries, ${past} past roles and ${packsIn} packs; nothing you already had was duplicated.`);
}
async function importSync(text) {
  let d; try { d = JSON.parse(text); } catch { toast('That file is not a Northstar sync file'); return; }
  if (!d.northstar_sync || !d.state) { toast('That file is not a Northstar sync file'); return; }
  if (S.jobs.length && !await confirmBox('Replace the tracker on this device?', `The sync file was exported ${fmtDate(d.exported_at)}. Your data here (last saved ${fmtDate(S.updated_at)}) is replaced by it.`, 'Replace')) return;
  await backup('before importing a sync file', true);
  const keepBase = baseAt; S = { ...blankState(), ...d.state }; baseAt = keepBase; await save(); closeModal(); renderAll(); toast('Sync file imported. Your previous data is kept as a safety copy in Data & connections.');
}

/* =========================================================
   Chrome extension bridge (window.postMessage <-> content script)
   ========================================================= */
const ext = { ready: false, version: '' };
const pending = new Map();
function extSend(msg) { if (ext.ready) window.postMessage({ ns: 'northstar-app', ...msg }, location.origin); }
function extRequest(msg, timeout = 15000) {
  return new Promise((res, rej) => {
    if (!ext.ready) return rej(Error('Chrome extension not connected'));
    const id = uid('m');
    const t = setTimeout(() => { pending.delete(id); rej(Error('The extension did not answer')); }, timeout);
    pending.set(id, v => { clearTimeout(t); res(v); });
    window.postMessage({ ns: 'northstar-app', id, ...msg }, location.origin);
  });
}
window.addEventListener('message', async e => {
  if (e.source !== window || e.origin !== location.origin) return;
  const m = e.data || {};
  if (m.ns !== 'northstar-ext') return;
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.type === 'ready') { const was = ext.ready; ext.ready = true; ext.version = m.version || ''; extRequest({ type: 'runner' }).then(r => { const had = ext.runner; ext.runner = !!r.configured; if (had !== ext.runner && S) renderAll(); }).catch(() => { }); if (!was && S) renderAll(); return; }
  if (!S) return;
  if (m.type === 'fill-report') {
    const f = S.fills.find(x => x.id === m.fill_id); if (!f) return;
    if (m.report && m.report.url_host === location.host) return; // a Northstar page opened in the fill tab is not an employer form
    f.report = m.report; f.updated_at = now();
    f.status = m.report.blocked ? 'blocked' : (m.report.needs || []).length ? 'needs_you' : 'filled';
    // new questions from forms wait in Answers, unanswered
    for (const n of m.report.needs || []) { const ex = n.kind === 'unknown' && n.label && S.answers.find(a => a.key === norm(n.label).slice(0, 80)); if (ex && !(ex.answer || '').trim()) ex.seen = (ex.seen || 1) + 1; }
    for (const n of m.report.needs || []) if (n.kind === 'unknown' && n.label && !S.answers.some(a => a.key === norm(n.label).slice(0, 80)) && !(S.answer_merged || []).some(m => m.key === norm(n.label).slice(0, 80))) S.answers.push({ key: norm(n.label).slice(0, 80), question: n.label, answer: '', kind: 'question', confirmed: false, scope: 'both', seen: 1, created_at: now() });
    await save(); renderAll();
  }
  if (m.type === 'fill-learned') {
    // Answers you typed on an employer form for questions Northstar had no answer for: offered as drafts, used only once you approve them
    const f = S.fills.find(x => x.id === m.fill_id); const j = f && job(f.job_id);
    let n = 0;
    for (const l of m.learned || []) {
      if (!l || !l.label || !l.value) continue;
      const key = norm(l.label).slice(0, 80);
      let a = S.answers.find(x => x.key === key);
      if (a && a.confirmed && (a.answer || '').trim()) continue;
      if (!a) { a = { key, question: l.label, kind: 'question', scope: 'both', seen: 1, created_at: now() }; S.answers.push(a); }
      a.answer = String(l.value).slice(0, 1000); a.confirmed = false; delete a.no_suggestion;
      a.draft = { source: 'form', based_on: `what you typed on the ${j ? j.company + ' ' : ''}form${m.host ? ' (' + m.host + ')' : ''}`, flags: [], at: now() }; a.updated_at = now(); n++;
    }
    if (n) { await save(); renderAll(); toast(`${n} answer${n > 1 ? 's' : ''} you typed on the form ${n > 1 ? 'are' : 'is'} waiting in Career profile › Answers for you to approve.`); }
  }
  if (m.type === 'submit-unlocked') { const f = S.fills.find(x => x.id === m.fill_id); if (f && !approvalFor(f.job_id)) { await recordApproval(f.job_id, 'page'); } }
  if (m.type === 'submit-clicked') { const f = S.fills.find(x => x.id === m.fill_id); if (f) { const j = job(f.job_id); toast(`Submit pressed for ${j.company}. Record the confirmation once the employer shows it.`); go('application'); } }
});
function pingExt() { window.postMessage({ ns: 'northstar-app', type: 'ping' }, location.origin); }
async function recordApproval(jid, source) {
  const p = approvedPack(jid); if (!p) return;
  S.approvals.push({ id: uid('a'), job_id: jid, pack_id: p.id, at: now(), source });
  const f = activeFill(jid); if (f) extSend({ type: 'approve', fill_id: f.id });
  await save(); renderAll();
  toast(source === 'page' ? 'Submit unlocked on the employer page and recorded here for this one application.' : 'Submit approved for this one application. Press Submit yourself on the employer page.');
}
async function queueFills(ids) {
  for (const id of ids) { if (activeFill(id)) continue; const p = approvedPack(id); if (!p) continue; S.fills.push({ id: uid('f'), job_id: id, pack_id: p.id, status: 'pending', created_at: now(), updated_at: now() }); }
  await save(); renderAll();
  if (!ext.ready) { toast('Fill request saved. It waits until the Chrome extension is connected.'); return; }
  for (const id of ids) { const f = activeFill(id); if (f) await sendFill(f.id); }
}
async function sendFill(fid) {
  const f = S.fills.find(x => x.id === fid), j = job(f.job_id), p = S.packs.find(x => x.id === f.pack_id);
  const url = j.apply_url || j.job_url;
  if (!url) { toast('Add the application form link first'); return; }
  if (p.cv_md == null) { toast('This pack’s documents were deleted. Build and approve a new version.'); return; }
  busy('Preparing your documents…');
  try {
    const c = S.profile.contact || {};
    const nm = slug([c.first_name, c.last_name].join(' ')) || 'CV';
    const scope = a => !a.scope || a.scope === 'both' || a.scope === j.market;
    const payload = {
      fill_id: f.id, url, job: { company: j.company, role: j.role, market: j.market },
      contact: { ...c, full_name: [c.first_name, c.last_name].filter(Boolean).join(' ') },
      current_employer: S.profile.current_employer || '',
      talent_pool_box: !!S.profile.talent_pool_box,
      answers: S.answers.filter(a => a.confirmed && a.answer && scope(a)).map(a => ({ q: a.question, a: a.answer, sensitive: !!a.sensitive })),
      cover_letter_text: p.cl_md,
      files: { cv: { name: `${nm}-CV.pdf`, b64: pdfBase64(p.cv_md, { title: 'CV', kind: 'cv' }) }, cl: { name: `${nm}-Cover-letter.pdf`, b64: pdfBase64(letterDoc(p), { title: 'Cover letter', kind: 'letter' }) } },
      submit_approved: !!approvalFor(j.id),
    };
    const r = await extRequest({ type: 'fill', payload }, 20000);
    if (!r.ok) throw Error(r.error || 'The extension refused the request');
    f.status = 'sent'; f.updated_at = now(); await save(); renderAll();
    toast(`Opening the ${j.company} form in a new tab…`);
  } catch (e) { toast(e.message); } finally { busy(); }
}

/* =========================================================
   Onboarding, theme, start
   ========================================================= */
function applyTheme() { const t = local.get('theme', 'auto'); if (t === 'auto') document.documentElement.removeAttribute('data-theme'); else document.documentElement.dataset.theme = t; }
function showOnboarding() {
  openModal(`<div class="eyebrow">Welcome to Northstar</div><h2>Load your profile</h2><p>Import your private setup file (northstar-setup.json) to load your Master CV, cover letter playbook, fit rubric, saved answers and search sources. It stays in this browser on this device.</p>
   <ul class="bullets"><li>Moving from another device? Import a sync file instead.</li><li>Your data never leaves this device unless you press a button that uses the assistant or export a file.</li></ul>
   <div class="modalfoot"><button class="btn" data-act="closeModal">Later</button><button class="btn" data-act="importSync">Import sync file</button><button class="btn primary" data-act="importSetup">Import setup file</button></div>`);
}
async function start() {
  applyTheme();
  const stored = await dbGet('state');
  if (stored) adopt(stored); else { S = blankState(); baseAt = null; await save(); }
  await backup('opened Northstar');
  if ((S.answers || []).length && mergeDuplicateAnswers()) { await backup('before merging duplicate answers', true); await save(); }
  if (runCleanup(false)) await save();
  renderAll();
  const p = local.get('page', 'home'); if (p !== 'home' && PAGE_NAMES[p]) go(p);
  if (!S.docs.master_cv) showOnboarding();
  pingExt(); setTimeout(pingExt, 700); setTimeout(() => pollCloud(), 2500); setTimeout(() => pullMissedResults(true).catch(() => { }), 4000); setTimeout(() => { if (!ext.ready) setStatus(); renderPage(currentPage); }, 1600);
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => { });
}
window.addEventListener('focus', async () => { if (!S) return; const fresh = await dbGet('state'); if (fresh && fresh.updated_at !== S.updated_at) { adopt(fresh); renderAll(); } });
start().catch(e => { console.error(e); toast('Northstar could not open its local data: ' + e.message); });
