const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const KEY = 'trace-note-safe-state-v1';

const state = loadState();
let activeTaskId = null;
let pendingAction = null;
let tempFilter = { deadline: state.deadlineFilter, focus: state.focusFilter };

function makeId(){ return Math.random().toString(36).slice(2,10) + Date.now().toString(36).slice(-4); }
function todayISO(){ return new Date().toISOString().slice(0,10); }
function addDays(n){ const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0,10); }
function now(){ return Date.now(); }

function defaultState(){
  const tasks = [
    { id: makeId(), text: 'Revise research outline', focus: 'core', deadline: addDays(-1), done: false, archived: false, createdAt: now()-600000 },
    { id: makeId(), text: 'Submit experiment report', focus: 'core', deadline: addDays(0), done: false, archived: false, createdAt: now()-500000 },
    { id: makeId(), text: 'Prepare slides for meeting', focus: 'normal', deadline: addDays(1), done: false, archived: false, createdAt: now()-400000 },
    { id: makeId(), text: 'User interview analysis', focus: 'normal', deadline: addDays(2), done: false, archived: false, createdAt: now()-300000 },
    { id: makeId(), text: 'Design system update', focus: 'light', deadline: addDays(5), done: false, archived: false, createdAt: now()-200000 },
    { id: makeId(), text: 'Read: Design Thinking', focus: 'light', deadline: '', done: false, archived: false, createdAt: now()-100000 }
  ];
  return {
    tasks,
    page: 'tasks',
    sortMode: 'smart',
    customOrder: tasks.map(t => t.id),
    deadlineFilter: 'all',
    focusFilter: 'all',
    currentSearch: '',
    completedSearch: '',
    theme: 'ink',
    ai: { provider: 'deepseek', apiKey: '', baseUrl: 'https://api.deepseek.com', model: 'deepseek-chat' },
    analysis: null,
    selectedCategory: null
  };
}
function loadState(){
  try{
    const raw = localStorage.getItem(KEY);
    if(raw){
      const base = defaultState();
      return Object.assign(base, JSON.parse(raw));
    }
  }catch(err){ console.warn(err); }
  return defaultState();
}
function saveState(){ try{ localStorage.setItem(KEY, JSON.stringify(state)); }catch(err){ console.warn(err); } }

function escapeHTML(text){ return String(text || '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch])); }
function formatShortDate(iso){ if(!iso) return ''; const d = new Date(iso + 'T00:00:00'); return d.toLocaleDateString('en-US',{month:'short',day:'numeric'}); }
function daysUntil(iso){ if(!iso) return null; const start = new Date(todayISO()+'T00:00:00'); const end = new Date(iso+'T00:00:00'); return Math.round((end-start)/86400000); }
function deadlineMeta(task){
  if(!task.deadline) return { label: 'Open-ended', cls: 'dd-open', score: 999 };
  const d = daysUntil(task.deadline);
  if(d < 0) return { label: 'Overdue', cls: 'dd-overdue', score: -10 };
  if(d === 0) return { label: 'Due today', cls: 'dd-today', score: 0 };
  if(d === 1) return { label: '1 day left', cls: 'dd-1', score: 1 };
  if(d <= 3) return { label: `${d} days left`, cls: 'dd-3', score: d };
  if(d <= 7) return { label: `${d} days left`, cls: 'dd-7', score: d };
  return { label: formatShortDate(task.deadline), cls: 'dd-far', score: d };
}
function focusMeta(focus){
  const map = { core: ['Core','focus-core',0], normal: ['Normal','focus-normal',1], light: ['Light','focus-light',2] };
  const item = map[focus] || map.normal;
  return { label: item[0], cls: item[1], score: item[2] };
}
function smartCompare(a,b){
  const av = [a.done ? 1 : 0, focusMeta(a.focus).score, deadlineMeta(a).score, a.createdAt || 0];
  const bv = [b.done ? 1 : 0, focusMeta(b.focus).score, deadlineMeta(b).score, b.createdAt || 0];
  for(let i=0;i<av.length;i++){ if(av[i] !== bv[i]) return av[i] - bv[i]; }
  return 0;
}
function matchesDeadline(task){
  const f = state.deadlineFilter;
  const d = daysUntil(task.deadline);
  if(f === 'today') return d === 0;
  if(f === '7days') return d !== null && d >= 0 && d <= 7;
  if(f === 'overdue') return d !== null && d < 0;
  if(f === 'open') return !task.deadline;
  return true;
}
function matchesSearch(task, term){ return !term || task.text.toLowerCase().includes(term.toLowerCase()); }
function activeTasks(){
  let tasks = state.tasks.filter(t => !t.archived);
  tasks = tasks.filter(matchesDeadline).filter(t => state.focusFilter === 'all' || t.focus === state.focusFilter).filter(t => matchesSearch(t, state.currentSearch));
  if(state.sortMode === 'custom'){
    const order = state.customOrder || [];
    tasks.sort((a,b) => {
      const ia = order.indexOf(a.id), ib = order.indexOf(b.id);
      if(ia === -1 && ib === -1) return smartCompare(a,b);
      if(ia === -1) return 1;
      if(ib === -1) return -1;
      return ia - ib;
    });
  } else {
    tasks.sort(smartCompare);
  }
  return tasks;
}
function completedTasks(){
  return state.tasks.filter(t => t.archived).filter(t => matchesSearch(t, state.completedSearch)).sort((a,b) => (b.archivedAt || 0) - (a.archivedAt || 0));
}
function insertIntoCustom(taskId){
  state.customOrder = (state.customOrder || []).filter(id => id !== taskId);
  const task = state.tasks.find(t => t.id === taskId);
  if(!task){ return; }
  const orderedActive = (state.customOrder || []).map(id => state.tasks.find(t => t.id === id)).filter(t => t && !t.archived);
  let idx = orderedActive.findIndex(t => smartCompare(task,t) < 0);
  if(idx < 0) idx = orderedActive.length;
  const beforeId = orderedActive[idx]?.id;
  if(beforeId){ state.customOrder.splice(state.customOrder.indexOf(beforeId), 0, taskId); }
  else state.customOrder.push(taskId);
}

function render(){
  document.documentElement.dataset.theme = state.theme || 'ink';
  renderPage(); renderTasks(); renderCompleted(); renderFilters(); renderAI(); renderSettings(); saveState();
}
function renderPage(){
  $$('.page').forEach(p => p.classList.remove('active'));
  const map = { tasks: '#tasksPage', completed: '#completedPage', ai: '#aiPage', settings: '#settingsPage' };
  $(map[state.page] || '#tasksPage').classList.add('active');
  $$('.nav-btn').forEach(btn => btn.classList.toggle('active', btn.dataset.page === state.page));
  const title = { tasks: 'Trace Note', completed: 'Completed', ai: 'AI Report', settings: 'Settings' }[state.page] || 'Trace Note';
  $('#pageTitle').textContent = title;
  $('#sortBtn').style.visibility = state.page === 'tasks' ? 'visible' : 'hidden';
}
function taskCard(task, completed=false){
  const fm = focusMeta(task.focus), dm = deadlineMeta(task);
  const article = document.createElement('article');
  article.className = 'task-card'; article.dataset.id = task.id;
  article.innerHTML = `
    <button class="check-btn ${task.done ? 'done' : ''}" type="button" data-action="toggle">${task.done ? '✓' : ''}</button>
    <div class="task-main">
      ${task.editing ? editTemplate(task) : `<div class="task-title ${task.done ? 'done' : ''}">${escapeHTML(task.text)}</div><div class="meta-row"><span class="badge ${fm.cls}">${fm.label}</span><span class="badge ${dm.cls}">${dm.label}</span></div>`}
    </div>
    <button class="more-btn" type="button" data-action="menu" aria-label="Task actions">•••</button>`;
  return article;
}
function editTemplate(task){
  return `<div class="edit-box"><input class="edit-input" value="${escapeHTML(task.text)}" aria-label="Edit task"><div class="edit-actions"><button class="save-edit" type="button" data-action="saveEdit">Save</button><button type="button" data-action="cancelEdit">Cancel</button></div></div>`;
}
function renderTasks(){
  const list = $('#taskList'); list.innerHTML = '';
  const tasks = activeTasks();
  if(!tasks.length){ list.innerHTML = '<div class="empty">No active tasks.</div>'; return; }
  tasks.forEach(t => list.appendChild(taskCard(t,false)));
}
function renderCompleted(){
  const list = $('#completedList'); list.innerHTML = '';
  const tasks = completedTasks();
  if(!tasks.length){ list.innerHTML = '<div class="empty">No completed tasks yet.</div>'; return; }
  tasks.forEach(t => list.appendChild(taskCard(t,true)));
  $('#clearCompletedSearchBtn').classList.toggle('hidden', !state.completedSearch);
}
function renderFilters(){
  const parts = [];
  if(state.deadlineFilter !== 'all') parts.push({today:'Today','7days':'7 Days',overdue:'Overdue',open:'Open-ended'}[state.deadlineFilter]);
  if(state.focusFilter !== 'all') parts.push(focusMeta(state.focusFilter).label);
  $('#filterBtn').textContent = parts.length ? `Filter · ${parts.join(' · ')}` : 'Filter · All';
  $('#clearFilterBtn').classList.toggle('hidden', !parts.length);
  $('#searchInput').value = state.currentSearch;
  $('#completedSearchInput').value = state.completedSearch;
}
function renderSettings(){
  $('#providerInput').value = state.ai.provider || 'deepseek';
  $('#apiKeyInput').value = state.ai.apiKey || '';
  $('#baseUrlInput').value = state.ai.baseUrl || '';
  $('#modelInput').value = state.ai.model || '';
}
function renderAI(){
  const tabs = $('#categoryTabs'); const panel = $('#reportPanel'); tabs.innerHTML = '';
  if(!state.analysis){ panel.innerHTML = '<h2>AI Report</h2><p>Generate a report from completed tasks. The report can classify work, summarize traces, and suggest next steps.</p>'; return; }
  const cats = state.analysis.categories || [];
  cats.forEach(cat => {
    const btn = document.createElement('button'); btn.type = 'button'; btn.textContent = cat.name; btn.classList.toggle('active', state.selectedCategory === cat.name); btn.dataset.cat = cat.name; tabs.appendChild(btn);
  });
  const selected = cats.find(c => c.name === state.selectedCategory) || cats[0];
  if(!selected){ panel.innerHTML = '<h2>No report category</h2>'; return; }
  panel.innerHTML = reportHTML(selected);
}
function reportHTML(cat){
  return `<h2>${escapeHTML(cat.name)}</h2>
    <h3>Why this category</h3><p>${escapeHTML(cat.reason)}</p>
    <h3>Progress trace</h3><p>${escapeHTML(cat.trace)}</p>
    <h3>Reusable insight</h3><ul>${(cat.insights||[]).map(x=>`<li>${escapeHTML(x)}</li>`).join('')}</ul>
    <h3>Next suggestion</h3><p>${escapeHTML(cat.next)}</p>
    <h3>Deadline review</h3><p>${escapeHTML(cat.deadlineReview || 'No deadline pattern yet.')}</p>
    <h3>Completed tasks</h3><ul>${(cat.tasks||[]).map(x=>`<li>${escapeHTML(x)}</li>`).join('')}</ul>
    <div class="ai-export-row"><button class="secondary-btn" type="button" data-export="word">Export Word</button><button class="secondary-btn" type="button" data-export="pdf">Export PDF</button></div>`;
}

function addTask(){
  const text = $('#taskInput').value.trim(); if(!text){ toast('Write a task first'); return; }
  const task = { id: makeId(), text, focus: $('#newFocus').value || 'normal', deadline: $('#deadlineInput').value || '', done: false, archived: false, createdAt: now() };
  state.tasks.push(task); insertIntoCustom(task.id);
  $('#taskInput').value = ''; $('#deadlineInput').value = ''; $('#deadlineBtn').textContent = 'Set deadline'; $('#newFocus').value = 'normal';
  render(); toast('Task added');
}
function taskAction(id, action){
  const task = state.tasks.find(t => t.id === id); if(!task) return;
  if(action === 'toggle'){ task.done = !task.done; }
  if(action === 'edit'){ task.editing = true; }
  if(action === 'cancelEdit'){ task.editing = false; }
  if(action === 'saveEdit'){
    const card = document.querySelector(`.task-card[data-id="${CSS.escape(id)}"]`);
    const v = card?.querySelector('.edit-input')?.value.trim();
    if(v){ task.text = v; task.editing = false; }
  }
  if(action === 'archive'){ task.archived = true; task.done = true; task.archivedAt = now(); state.customOrder = state.customOrder.filter(x => x !== id); }
  if(action === 'restore'){ task.archived = false; task.done = false; task.archivedAt = null; insertIntoCustom(id); }
  if(action === 'delete'){ state.tasks = state.tasks.filter(t => t.id !== id); state.customOrder = state.customOrder.filter(x => x !== id); }
  render();
}

function openSheet(name){
  $('#sheetBackdrop').classList.remove('hidden');
  ['filterSheet','sortSheet','reorderSheet','actionSheet','confirmSheet'].forEach(id => $('#'+id).classList.add('hidden'));
  $('#'+name+'Sheet').classList.remove('hidden');
}
function closeSheets(){ $('#sheetBackdrop').classList.add('hidden'); }
function openFilter(){
  tempFilter = { deadline: state.deadlineFilter, focus: state.focusFilter };
  refreshFilterSheet(); openSheet('filter');
}
function refreshFilterSheet(){
  $$('#deadlineFilterGroup button').forEach(b => b.classList.toggle('active', b.dataset.value === tempFilter.deadline));
  $$('#focusFilterGroup button').forEach(b => b.classList.toggle('active', b.dataset.value === tempFilter.focus));
}
function openActionMenu(id){
  const task = state.tasks.find(t => t.id === id); if(!task) return; activeTaskId = id;
  $('#actionTitle').textContent = task.archived ? 'Completed Task' : 'Task Actions';
  const box = $('#actionOptions'); box.innerHTML = '';
  const actions = task.archived ? [ ['restore','Restore'], ['confirmDelete','Delete Forever'] ] : [ ['edit','Edit Task'], ['confirmMove','Move to Completed'] ];
  actions.forEach(([act,label]) => {
    const btn = document.createElement('button'); btn.type = 'button'; btn.className = act.includes('Delete') ? 'danger-btn' : 'sheet-option'; btn.textContent = label; btn.dataset.actionMenu = act; box.appendChild(btn);
  });
  openSheet('action');
}
function openConfirm(kind, id){
  pendingAction = { kind, id };
  if(kind === 'move'){ $('#confirmTitle').textContent = 'Move to Completed?'; $('#confirmText').textContent = 'This task will be saved in Completed and used as trace material.'; $('#confirmPrimaryBtn').textContent = 'Confirm Move'; $('#confirmPrimaryBtn').className = 'primary-btn'; }
  else { $('#confirmTitle').textContent = 'Delete Forever?'; $('#confirmText').textContent = 'This permanently removes the task from Trace Note.'; $('#confirmPrimaryBtn').textContent = 'Delete Forever'; $('#confirmPrimaryBtn').className = 'danger-btn'; }
  openSheet('confirm');
}
function renderReorder(){
  const list = $('#reorderList'); list.innerHTML = '';
  const ids = (state.customOrder || []).filter(id => state.tasks.some(t => t.id === id && !t.archived));
  ids.forEach(id => {
    const t = state.tasks.find(x => x.id === id); const fm = focusMeta(t.focus); const dm = deadlineMeta(t);
    const row = document.createElement('div'); row.className = 'reorder-item'; row.dataset.id = t.id;
    row.innerHTML = `<span class="drag-handle">⋮⋮</span><div><strong>${escapeHTML(t.text)}</strong><div class="meta-row"><span class="badge ${fm.cls}">${fm.label}</span><span class="badge ${dm.cls}">${dm.label}</span></div></div><button type="button" data-move="up">↑</button><button type="button" data-move="down">↓</button>`;
    list.appendChild(row);
  });
}
function moveOrder(id, dir){
  const activeIds = $$('#reorderList .reorder-item').map(el => el.dataset.id);
  const i = activeIds.indexOf(id); const j = i + dir;
  if(i < 0 || j < 0 || j >= activeIds.length) return;
  [activeIds[i], activeIds[j]] = [activeIds[j], activeIds[i]];
  const rest = state.customOrder.filter(x => !activeIds.includes(x));
  state.customOrder = activeIds.concat(rest); renderReorder();
}
function localPreview(){
  const archived = state.tasks.filter(t => t.archived);
  if(!archived.length){ toast('No completed tasks yet'); return; }
  const groups = {};
  archived.forEach(t => {
    const text = t.text.toLowerCase();
    let cat = 'General';
    if(/paper|essay|thesis|abstract|report|manuscript|submit|revise|write/.test(text)) cat = 'Paper';
    else if(/clean|laundry|room|cook|home|daily/.test(text)) cat = 'Daily';
    else if(/design|product|ui|prototype|app/.test(text)) cat = 'Design';
    if(!groups[cat]) groups[cat] = [];
    groups[cat].push(t);
  });
  const categories = Object.entries(groups).map(([name,arr]) => ({
    name,
    reason: `These tasks share a common ${name.toLowerCase()} context.`,
    trace: `You completed ${arr.length} related task${arr.length>1?'s':''}. This forms a reusable progress trace rather than a simple archive.`,
    insights: ['Keep tasks short and action-oriented.', 'Separate drafting, revision, and delivery when work becomes large.', 'Use deadline and focus together instead of deadline alone.'],
    next: 'Create the next task as a smaller, concrete action with a clear focus level.',
    deadlineReview: summarizeDeadlines(arr),
    tasks: arr.map(t => t.text)
  }));
  state.analysis = { categories }; state.selectedCategory = categories[0]?.name || null; state.page = 'ai'; render(); toast('Local report generated');
}
function summarizeDeadlines(arr){
  const withD = arr.filter(t => t.deadline && t.archivedAt);
  if(!withD.length) return 'Most completed tasks had no deadline, so deadline patterns are still limited.';
  const early = withD.filter(t => new Date(t.archivedAt).setHours(0,0,0,0) <= new Date(t.deadline+'T00:00:00').getTime()).length;
  return `${early}/${withD.length} tasks were completed on time or early.`;
}
async function generateAI(){
  if(!state.ai.apiKey){ toast('Set API key first'); return; }
  const completed = state.tasks.filter(t => t.archived).map(t => ({ text:t.text, focus:t.focus, deadline:t.deadline, completedAt:t.archivedAt }));
  const active = state.tasks.filter(t => !t.archived).map(t => ({ text:t.text, focus:t.focus, deadline:t.deadline }));
  if(!completed.length){ toast('No completed tasks yet'); return; }
  const prompt = `Analyze Trace Note tasks. Return JSON only with format {"categories":[{"name":"","reason":"","trace":"","insights":[""],"next":"","deadlineReview":"","tasks":[""]}]}. Completed=${JSON.stringify(completed)} Active=${JSON.stringify(active)}`;
  try{
    const url = (state.ai.baseUrl || '').replace(/\/$/,'') + '/chat/completions';
    const res = await fetch(url, { method:'POST', headers:{ 'Content-Type':'application/json', 'Authorization':'Bearer '+state.ai.apiKey }, body: JSON.stringify({ model: state.ai.model, messages:[{role:'user', content: prompt}], temperature:0.2 }) });
    if(!res.ok) throw new Error(await res.text());
    const data = await res.json();
    const content = data.choices?.[0]?.message?.content || '';
    const json = JSON.parse(content.replace(/^```json|```$/g,'').trim());
    state.analysis = json; state.selectedCategory = json.categories?.[0]?.name || null; state.page='ai'; render(); toast('AI report generated');
  }catch(err){ console.error(err); toast('AI failed; use Local Preview'); }
}
function buildReportDocument(scope){
  const cats = state.analysis?.categories || [];
  const selected = scope === 'all' ? cats : cats.filter(c => c.name === state.selectedCategory);
  const body = selected.map(c => `<h1>${escapeHTML(c.name)}</h1>${reportHTML(c)}`).join('<hr>');
  return `<!doctype html><html><head><meta charset="utf-8"><title>Trace Note Report</title><style>body{font-family:Arial,sans-serif;line-height:1.6;color:#222;padding:32px}h1{font-size:26px}h3{margin-top:20px}</style></head><body>${body}</body></html>`;
}
function exportWord(scope){
  if(!state.analysis){ toast('Generate a report first'); return; }
  const blob = new Blob(['\ufeff', buildReportDocument(scope)], { type:'application/msword' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `Trace_Note_${scope}_Report.doc`; a.click(); URL.revokeObjectURL(a.href);
}
function exportPDF(scope){
  if(!state.analysis){ toast('Generate a report first'); return; }
  const w = window.open('', '_blank'); if(!w){ toast('Allow pop-ups to export PDF'); return; }
  w.document.open(); w.document.write(buildReportDocument(scope)); w.document.close(); setTimeout(() => w.print(), 300);
}
function toast(msg){
  const el = $('#toast'); el.textContent = msg; el.classList.add('show'); clearTimeout(toast.timer); toast.timer = setTimeout(() => el.classList.remove('show'), 1800);
}

function bind(){
  $('#addBtn').addEventListener('click', addTask);
  $('#plusBtn').addEventListener('click', addTask);
  $('#taskInput').addEventListener('keydown', e => { if(e.key === 'Enter') addTask(); });
  $('#deadlineBtn').addEventListener('click', () => $('#deadlineInput').showPicker ? $('#deadlineInput').showPicker() : $('#deadlineInput').click());
  $('#deadlineInput').addEventListener('change', e => { $('#deadlineBtn').textContent = e.target.value ? formatShortDate(e.target.value) : 'Set deadline'; });
  $('#searchBtn').addEventListener('click', () => { state.currentSearch = $('#searchInput').value.trim(); render(); });
  $('#searchInput').addEventListener('keydown', e => { if(e.key === 'Enter') $('#searchBtn').click(); });
  $('#completedSearchBtn').addEventListener('click', () => { state.completedSearch = $('#completedSearchInput').value.trim(); render(); });
  $('#completedSearchInput').addEventListener('keydown', e => { if(e.key === 'Enter') $('#completedSearchBtn').click(); });
  $('#clearCompletedSearchBtn').addEventListener('click', () => { state.completedSearch=''; render(); });
  $('#filterBtn').addEventListener('click', openFilter);
  $('#clearFilterBtn').addEventListener('click', () => { state.deadlineFilter='all'; state.focusFilter='all'; render(); });
  $('#sortBtn').addEventListener('click', () => openSheet('sort'));
  $('#smartSortBtn').addEventListener('click', () => { state.sortMode='smart'; closeSheets(); render(); });
  $('#customSortBtn').addEventListener('click', () => { state.sortMode='custom'; closeSheets(); render(); });
  $('#adjustOrderBtn').addEventListener('click', () => { renderReorder(); openSheet('reorder'); });
  $('#closeSortBtn').addEventListener('click', closeSheets);
  $('#cancelOrderBtn').addEventListener('click', closeSheets);
  $('#confirmOrderBtn').addEventListener('click', () => { state.sortMode='custom'; closeSheets(); render(); toast('Custom order saved'); });
  $('#applyFilterBtn').addEventListener('click', () => { state.deadlineFilter=tempFilter.deadline; state.focusFilter=tempFilter.focus; closeSheets(); render(); });
  $('#cancelFilterBtn').addEventListener('click', closeSheets);
  $('#confirmCancelBtn').addEventListener('click', () => { pendingAction=null; closeSheets(); });
  $('#confirmPrimaryBtn').addEventListener('click', () => { if(!pendingAction) return; taskAction(pendingAction.id, pendingAction.kind==='move'?'archive':'delete'); pendingAction=null; closeSheets(); });
  $('#closeActionBtn').addEventListener('click', closeSheets);
  $('#localPreviewBtn').addEventListener('click', localPreview);
  $('#aiGenerateBtn').addEventListener('click', generateAI);
  $('#exportAllWordBtn').addEventListener('click', () => exportWord('all'));
  $('#exportAllPdfBtn').addEventListener('click', () => exportPDF('all'));
  $('#saveSettingsBtn').addEventListener('click', () => { state.ai = { provider: $('#providerInput').value, apiKey: $('#apiKeyInput').value.trim(), baseUrl: $('#baseUrlInput').value.trim(), model: $('#modelInput').value.trim() }; saveState(); toast('AI settings saved'); });
  $('#providerInput').addEventListener('change', e => { const v=e.target.value; if(v==='deepseek'){ $('#baseUrlInput').value='https://api.deepseek.com'; $('#modelInput').value='deepseek-chat'; } if(v==='doubao'){ $('#baseUrlInput').value='https://ark.cn-beijing.volces.com/api/v3'; $('#modelInput').value='Enter endpoint model ID'; } if(v==='proxy'){ $('#baseUrlInput').value='/api'; $('#modelInput').value='proxy'; } });
  $$('.nav-btn').forEach(btn => btn.addEventListener('click', () => { state.page = btn.dataset.page; render(); }));
  $$('.theme-btn').forEach(btn => btn.addEventListener('click', () => { state.theme = btn.dataset.theme; render(); }));
  $('#deadlineFilterGroup').addEventListener('click', e => { const b=e.target.closest('button'); if(!b) return; tempFilter.deadline = b.dataset.value; refreshFilterSheet(); });
  $('#focusFilterGroup').addEventListener('click', e => { const b=e.target.closest('button'); if(!b) return; tempFilter.focus = b.dataset.value; refreshFilterSheet(); });
  $('#taskList').addEventListener('click', cardEvents);
  $('#completedList').addEventListener('click', cardEvents);
  $('#actionOptions').addEventListener('click', e => { const b=e.target.closest('[data-action-menu]'); if(!b) return; const action=b.dataset.actionMenu; closeSheets(); if(action==='edit') taskAction(activeTaskId,'edit'); if(action==='restore') taskAction(activeTaskId,'restore'); if(action==='confirmMove') openConfirm('move', activeTaskId); if(action==='confirmDelete') openConfirm('delete', activeTaskId); });
  $('#reorderList').addEventListener('click', e => { const btn=e.target.closest('[data-move]'); if(!btn) return; const row=e.target.closest('.reorder-item'); moveOrder(row.dataset.id, btn.dataset.move === 'up' ? -1 : 1); });
  $('#categoryTabs').addEventListener('click', e => { const b=e.target.closest('[data-cat]'); if(!b) return; state.selectedCategory = b.dataset.cat; render(); });
  $('#reportPanel').addEventListener('click', e => { const b=e.target.closest('[data-export]'); if(!b) return; b.dataset.export === 'word' ? exportWord('category') : exportPDF('category'); });
  $('#sheetBackdrop').addEventListener('click', e => { if(e.target.id === 'sheetBackdrop') closeSheets(); });
}
function cardEvents(e){
  const card = e.target.closest('.task-card'); if(!card) return;
  const action = e.target.closest('[data-action]')?.dataset.action;
  if(!action) return;
  if(action === 'menu'){ openActionMenu(card.dataset.id); return; }
  taskAction(card.dataset.id, action);
}

bind(); render();
