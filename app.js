const $ = id => document.getElementById(id);
const STATUS = { healthy:'Well cared for', thirsty:'Time to reconnect', wilted:'Needs a little care', paused:'Giving this friendship some space', new:'Ready for a first hello' };
const STAGE = {sprout:'Seedling',bush:'Growing',bloom:'Blooming'};
// Opaque area of each plant sprite as [left,top,right,bottom] fractions of its frame, written by tools/normalize_plants.py.
const ART_BOUNDS = ASSETS.plantBounds;
let garden, persistedRaw = null, loadBlocked = false, writeIssue = false, currentZone = 'all', careOnly = false, currentView='garden', selectedId = null, editId = null, pendingRestore = null, lastRestore = null;
const nodeMap = new Map(), nurseryMap = new Map();
// Where the garden is kept. Published on claude.ai, the page saves to the artifact's own store (the access rules let
// only the owner and editors read or write it) and stays in step across devices. Opened as a local file, it uses this
// browser's storage, as before. Browser storage is also kept as a cache in both cases.
const DB_DOC='garden/main';
// Demo build (ASSETS.demo): fictional friends kept in memory only. Nothing is read from or written to any storage.
const DEMO=!!ASSETS.demo;
let store=DEMO?'memory':'local', dbDoc=null, lastSynced=null, opening=!DEMO&&!!(window.claude&&window.claude.use), localUnreadable=false;
if(DEMO) garden=demoGarden();
else try {
  persistedRaw = localStorage.getItem(KEY);
  if (persistedRaw !== null) garden = parseBackup(persistedRaw);
  else {
    const old=localStorage.getItem('garden_v1');
    garden = seed(ASSETS.contacts,old ? JSON.parse(old) : {});
  }
} catch(e) { garden=seed(ASSETS.contacts); localUnreadable=true; }
loadBlocked=localUnreadable&&!opening;
function storageStatus() {
  const el=$('storage-status');
  el.classList.toggle('storage-warning',loadBlocked||!!writeIssue);
  if(store==='memory') { el.textContent='Demo with fictional friends · nothing is saved. Reload or reset to start over.'; return; }
  if(store==='db') el.textContent=loadBlocked ? 'Your saved garden could not be read. Nothing was changed; restore a backup before editing.' : writeIssue ? `The last change was not saved (${writeIssue}). Export a backup before closing.` : 'Saved to your private garden · in step across your devices.';
  else el.textContent=opening ? 'Opening your garden…' : loadBlocked ? 'Saved data could not be read. Original data is kept; restore a backup before editing.' : writeIssue ? 'Changes are in memory only. Export a backup now; browser storage is unavailable.' : 'Saved on this browser · export a backup to keep it safe.';
}
function cacheLocal(raw) {try{localStorage.setItem(KEY,raw);persistedRaw=raw;}catch(e){}}
let writing=false, queuedRaw=null;
async function writeRemote(raw) {
  queuedRaw=raw;if(writing)return;writing=true;
  while(queuedRaw!==null) {
    const r=queuedRaw;queuedRaw=null;
    const body={garden:JSON.parse(r),savedAt:new Date().toISOString()};
    try { await dbDoc.set(body); writeIssue=false; }
    catch(e) {
      let err=e;
      if(e&&e.code==='unavailable') { await new Promise(s=>setTimeout(s,700+Math.random()*900)); try{await dbDoc.set(body);writeIssue=false;err=null;}catch(e2){err=e2;} }
      if(err) {
        writeIssue=err.code==='quota_exceeded'?'storage is full':err.code==='invalid_argument'?'this garden is read-only for you':'connection problem';
        toast(`This change was not saved: ${writeIssue}. Export a backup to keep it.`);
      }
    }
    storageStatus();
  }
  writing=false;
}
function persist(next, allowRestore=false) {
  if(store==='memory') { garden=next;storageStatus();return true; }
  if(opening) { toast('Still opening your garden. Try again in a moment.');return false; }
  if(loadBlocked&&!allowRestore) { toast('Your saved data needs attention. Restore a backup before editing.');return false; }
  const raw=JSON.stringify(next);
  if(store==='db') {
    // One document holds the whole garden; the store caps a document at 256 KiB.
    if(raw.length>250000) { toast('Your garden has reached its storage limit. Export a backup, then remove old moments.');return false; }
    if(raw.length>200000) toast('Your garden is close to its storage limit. Export a backup soon.');
    garden=next;loadBlocked=false;lastSynced=raw;cacheLocal(raw);writeRemote(raw);storageStatus();return true;
  }
  try {
    if(!allowRestore && localStorage.getItem(KEY)!==persistedRaw) { toast('This garden changed in another tab. Export this copy, then reload before editing.');return false; }
    localStorage.setItem(KEY,raw);persistedRaw=raw;writeIssue=false;loadBlocked=false;
  } catch(e) { if(loadBlocked) { toast('Browser storage is unavailable. Restore has not been applied.'); return false; } writeIssue=true; }
  garden=next;storageStatus();return true;
}
if(!DEMO && !opening && !loadBlocked && persistedRaw===null) persist(garden);
if(DEMO) {
  $('demo-badge').hidden=false;$('reset-demo').hidden=false;$('backup').hidden=true;$('restore').hidden=true;
  $('reset-demo').onclick=()=>{for(const d of document.querySelectorAll('dialog[open]'))d.close();garden=demoGarden();lastRestore=null;resetFilters();setView('garden');render();toast('Demo reset to the starting garden.');};
}
window.addEventListener('storage',e=>{if(store==='local'&&e.key===KEY) toast('The garden changed in another tab. Reload before recording more moments.');});
async function openStore() {
  if(!opening) return;
  let db=null;try{db=await window.claude.use('db');}catch(e){}
  if(!db) {
    opening=false;store='local';loadBlocked=localUnreadable;
    if(!loadBlocked && persistedRaw===null) persist(garden);
    render();return;
  }
  store='db';dbDoc=db.doc(DB_DOC);
  dbDoc.onSnapshot(snap=>{
    if(snap.metadata.hasPendingWrites) return;
    const first=opening;opening=false;
    if(!snap.exists) { loadBlocked=false;storageStatus();if(first)render();return; }
    const body=snap.data()||{};let raw;
    try { raw=JSON.stringify(body.garden); } catch(e) { raw=''; }
    if(raw===lastSynced) { storageStatus();return; }
    try { garden=parseBackup(raw);lastSynced=raw;loadBlocked=false;cacheLocal(raw); }
    catch(e) { loadBlocked=true;storageStatus();if(first)render();return; }
    render();if($('person-dialog').open)fillPerson();
    if(!first) toast('Your garden was updated on another device.');
  }, err=>{ writeIssue='lost connection, reload the page';storageStatus(); });
  storageStatus();
}
function node(tag,cls,text) {const el=document.createElement(tag);if(cls)el.className=cls;if(text!==undefined)el.textContent=text;return el;}
function tileKey(p, f=facts(garden,p)) {
  const key=f.stage==='bloom'?p.species:f.stage;
  return f.state==='thirsty'||f.state==='wilted' ? key+'_'+f.state : key;
}
function plantImage(p, f=facts(garden,p)) {return ASSETS.tiles[tileKey(p,f)];}
function matches(p) {return (currentZone==='all'||p.zone===currentZone)&&(!careOnly||facts(garden,p).due)&&[p.name,p.title].join(' ').toLowerCase().includes($('search').value.trim().toLowerCase());}
function toast(message,action=null) {
  const act=typeof action==='string'?{label:'Undo',run:()=>undoEntry(action)}:action;
  $('toast-text').textContent=message;$('toast').hidden=false;$('toast-undo').hidden=!act;
  $('toast-undo').textContent=act?act.label:'Undo';$('toast-undo').onclick=act?act.run:null;
}
$('toast-close').onclick=()=>{$('toast').hidden=true;};
function undoEntry(id) {
  if(!garden.entries.some(e=>e.id===id)) return;
  if(persist(undo(garden,id))) {render();toast('Moment removed. Growth and last contact have been restored.');}
}
function render() {
  const queue=careQueue(garden),due=queue.length;
  $('date-label').textContent=new Date().toLocaleDateString('en',{weekday:'long',month:'long',day:'numeric'});
  $('care-summary').textContent=due ? `${due} ${due===1?'friend could':'friends could'} use a little care. Start with one thoughtful hello.` : 'Your garden has room to breathe. Enjoy the connections you’re growing.';
  $('care-filter').classList.toggle('active',careOnly);
  $('care-filter').setAttribute('aria-pressed',String(careOnly));
  $('care-filter').textContent=careOnly?'Show all friends ↗':`Care for ${due} ${due===1?'friend':'friends'} ↗`;
  $('total-count').textContent=garden.people.length;
  $('journal-count').textContent=garden.entries.length;
  $('plants').replaceChildren();nodeMap.clear();
  for(const zone of Object.keys(ZONES)) {
    const spots=slots(zone);
    gardenPeople(garden,zone).forEach((p,i)=>{
      const f=facts(garden,p),match=matches(p),pos=spots[i];
      const el=node('div',`plant zone-${zone} state-${f.state}${match?'':' filtered'}`);
      el.style.left=pos.x+'%';el.style.top=pos.y+'%';const depth=Math.round(pos.y*10);el.style.setProperty('--depth',depth);el.style.setProperty('--label-depth',depth+1000);
      // Growth drives size; the front row of a bed is drawn slightly larger than the back row for depth.
      el.style.setProperty('--growth-scale',((0.72+Math.min(f.growth,110)/110*0.42)*(0.92+pos.depth*0.14)).toFixed(2));
      if(!match)el.setAttribute('aria-hidden','true');
      const img=node('img','plant-art');img.onload=schedulePlace;img.src=plantImage(p,f);img.alt='';img.draggable=false;
      const b=node('button','plant-hit');b.type='button';b.dataset.friend=p.id;b.title=p.name;b.tabIndex=match?0:-1;
      b.setAttribute('aria-label',`${p.name}, ${ZONES[p.zone]}, ${STAGE[f.stage]}, ${STATUS[f.state]}. Open details.`);
      b.onclick=()=>openPerson(p.id);
      const name=node('span','plant-name');name.append(node('i','dot '+f.state),node('span','label',p.name));
      el.append(img,b,node('i','dot base '+f.state),name);$('plants').append(el);nodeMap.set(p.id,{el,button:b,art:img,pos:[pos.x,pos.y],key:tileKey(p,f)});
    });
  }
  $('empty-bed').hidden=gardenPeople(garden,'stranger').length>0||careOnly||!!$('search').value||(currentZone!=='all'&&currentZone!=='stranger');
  $('no-results').hidden=garden.people.some(matches);
  placeLabels();
  renderNursery();
  renderCareQueue(queue);
  renderList();renderJournal();storageStatus();
}
function renderNursery() {
  const list=$('nursery-list');list.replaceChildren();nurseryMap.clear();
  // Friends who need care come first, in the same order as the care queue.
  const order=new Map(careQueue(garden).map((x,i)=>[x.person.id,i]));
  const resting=garden.people.filter(p=>!nodeMap.has(p.id)).sort((a,b)=>(order.get(a.id)??1e6)-(order.get(b.id)??1e6)||a.name.localeCompare(b.name));
  const dueCount=resting.filter(p=>order.has(p.id)).length;
  $('nursery-count').textContent=resting.length;
  $('nursery-due').hidden=!dueCount;$('nursery-due').textContent=`· ${dueCount} ${dueCount===1?'needs':'need'} care`;
  $('nursery-empty').hidden=resting.length>0;
  for(const p of resting.filter(matches)) {
    const f=facts(garden,p),b=node('button','nursery-card'+(f.due?' due':''));
    b.append(node('i','dot '+f.state),node('strong','',p.name),node('span','',`${ZONES[p.zone]} · ${STATUS[f.state]}`));
    b.onclick=()=>openPerson(p.id);list.append(b);nurseryMap.set(p.id,b);
  }
}
function renderCareQueue(queue) {
  const box=$('care-queue');box.hidden=!careOnly;box.replaceChildren();
  if(!careOnly)return;
  if(!queue.length){box.append(node('p','care-empty','No one needs a reminder right now. Enjoy the garden.'));return;}
  box.append(node('span','eyebrow','Start with a genuine reason to reconnect'));
  for(const {person,care} of queue.slice(0,3)){
    const b=node('button','care-queue-item');
    b.append(node('strong','',person.name),node('span','',`${ZONES[person.zone]} · ${Math.max(0,care.elapsed-person.cadence)}d past your rhythm${nodeMap.has(person.id)?'':' · nursery'}`));
    b.onclick=()=>openPerson(person.id);box.append(b);
  }
}
// The same friends as a table: who needs care first (care queue order), then paused, new and healthy friends by
// how soon their rhythm comes round. A row contacted today is highlighted, so a watering shows up here at once.
function renderList() {
  const body=$('list-body');body.replaceChildren();
  const order=new Map(careQueue(garden).map((x,i)=>[x.person.id,i]));
  const rank=(p,f)=>order.has(p.id)?order.get(p.id):f.state==='paused'?1e3:f.state==='new'?2e3:3e3+(f.daysLeft??0);
  const rows=garden.people.filter(matches).map(p=>({p,f:facts(garden,p)})).sort((a,b)=>rank(a.p,a.f)-rank(b.p,b.f)||a.p.name.localeCompare(b.p.name));
  $('list-empty').hidden=rows.length>0;
  for(const {p,f} of rows) {
    const tr=node('tr',(f.due?'due ':'')+(f.last===today()?'fresh':''));tr.onclick=()=>openPerson(p.id);
    const who=node('td','who');const b=node('button','row-name',p.name);b.type='button';b.onclick=e=>{e.stopPropagation();openPerson(p.id);};
    who.append(b,node('span','row-title',ZONES[p.zone]));
    const {role,company}=splitTitle(p),clip=(s,n)=>s.length>n?s.slice(0,n-2)+'…':s;
    const late=f.state==='thirsty'||f.state==='wilted'?` · ${Math.max(0,f.elapsed-p.cadence)}d late`:f.state==='healthy'?` · ${f.daysLeft}d left`:f.state==='paused'?` · until ${p.waitUntil}`:'';
    const status=node('td','status');status.append(node('i','dot '+f.state),node('span','',STATUS[f.state]),node('span','row-title',late.replace(' · ','')));
    const last=node('td','num',f.last?(f.last===today()?'Today':f.last):'Not yet');if(f.last&&f.last!==today())last.append(node('span','row-title',`${f.elapsed}d ago`));
    const step=(p.note||'').split('\n')[0];
    tr.append(who,node('td','',company||'·'),node('td','',role||'·'),node('td','num',p.met||'·'),node('td','offer',clip(p.theyOffer||'',90)),node('td','offer',clip(p.iOffer||'',90)),status,last,node('td','step',clip(step,70)));
    body.append(tr);
  }
}
function renderJournal() {
  const list=$('journal-list');list.replaceChildren();
  const ids=new Set(garden.people.filter(matches).map(p=>p.id));
  const entries=garden.entries.filter(e=>ids.has(e.personId)).slice().reverse().sort((a,b)=>b.date.localeCompare(a.date));
  if(!entries.length)list.append(node('div','empty-state',garden.entries.length?'No moments match this view.':'Your story starts with a hello. Select a friend in the garden to record your first moment.'));
  entries.forEach(e=>list.append(entryRow(e,true)));
}
function entryRow(e,full=false) {
  const p=garden.people.find(p=>p.id===e.personId),row=node('div','journal-row');
  row.append(node('span','journal-date',e.date));
  const info=node('div','journal-info');
  if(full) {const b=node('button','journal-person',p.name);b.onclick=()=>openPerson(p.id);info.append(b);}
  info.append(node('p','',TYPES[e.type].label+(e.note?' · '+e.note:'')));
  row.append(info,node('span','journal-points','+'+e.points));
  const b=node('button','text-button','Undo');b.setAttribute('aria-label',`Undo ${TYPES[e.type].label} with ${p.name} on ${e.date}`);
  b.onclick=()=>{undoEntry(e.id);if($('person-dialog').open)fillPerson();};row.append(b);return row;
}
// Names stay hidden until a plant is hovered, focused or selected; then the plant grows a little and the name pops up
// above its leaves. --art-h sizes the invisible click target over the plant, --art-top is the height of the visible leaves.
function placeLabels() {
  for(const it of nodeMap.values()) {
    const h=it.art.getBoundingClientRect().height,[l,top,r]=ART_BOUNDS[it.key]||[0,0,1,1];
    it.el.style.setProperty('--art-h',h.toFixed(1)+'px');it.el.style.setProperty('--art-top',(h*(1-top)).toFixed(1)+'px');
    it.el.style.setProperty('--hit-l',(l*100).toFixed(1)+'%');it.el.style.setProperty('--hit-w',((r-l)*100).toFixed(1)+'%');
  }
}
// Measured directly, not through requestAnimationFrame: frames do not run while the page is in a background tab,
// and a plant image that finished loading there would keep a zero-height click target.
function schedulePlace() {placeLabels();}
new ResizeObserver(schedulePlace).observe($('scene'));
// A LinkedIn profile's own activity page, so checking what someone posted is one click. Opens in a new tab.
function recentPosts(link) {
  try { const u=new URL(link);const m=u.pathname.match(/^\/in\/([^/]+)/);return /(^|\.)linkedin\.com$/.test(u.hostname)&&m?`https://www.linkedin.com/in/${m[1]}/recent-activity/all/`:null; } catch(e) { return null; }
}
function scrollToFriend(id) {
  const item=nodeMap.get(id);if(!item)return;
  const view=$('scene-scroll'),scene=$('scene');
  view.scrollTo({left:item.pos[0]/100*scene.offsetWidth-view.clientWidth*.48,top:item.pos[1]/100*scene.offsetHeight-view.clientHeight*.7,behavior:motionPaused?'instant':'smooth'});
}
// The water button sits in a bar pinned to the bottom of the drawer, so it is visible without scrolling.
// Its label names the moment it will save and the growth it adds.
function updateWaterLabel() {const t=TYPES[new FormData($('care-form')).get('type')]||TYPES.message;$('water-btn').textContent=`Water · ${t.label} +${t.points}`;}
$('care-form').addEventListener('change',updateWaterLabel);
function openPerson(id) {
  selectedId=id;if(nodeMap.has(id))scrollToFriend(id);else nurseryMap.get(id)?.scrollIntoView({block:'nearest',behavior:motionPaused?'instant':'smooth'});fillPerson();
  $('care-date').value=today();$('care-date').max=today();$('care-note').value='';$('care-error').textContent='';$('care-form').querySelector('input[value=message]').checked=true;updateWaterLabel();
  if(!$('person-dialog').open)$('person-dialog').showModal();
}
function fillPerson() {
  const p=garden.people.find(p=>p.id===selectedId);if(!p)return;
  const f=facts(garden,p);
  for(const [id,item]of nodeMap)item.el.classList.toggle('focused',id===p.id);for(const [id,card]of nurseryMap)card.classList.toggle('focused',id===p.id);
  const planted=nodeMap.has(p.id),room=planted||canPlace(garden,p),swap=room?null:swapSuggestion(garden,p.zone);
  $('garden-toggle').hidden=!room;$('garden-toggle').textContent=planted?'Rest in the nursery for a while':'Plant in the garden';
  $('swap-offer').hidden=room;
  if(!room) {
    $('swap-text').textContent=`The ${ZONES[p.zone]} bed is full (${CAPACITY[p.zone]} plants).`+(swap?` To plant ${p.name}, let one friend rest.`:' Everyone there needs care right now. Water one of them first, or rest one from their own page.');
    $('swap-action').hidden=!swap;$('swap-note').hidden=!swap;
    if(swap) {
      const sf=facts(garden,swap);
      $('swap-action').textContent=`Swap with ${swap.name}`;$('swap-action').onclick=()=>swapFriends(p.id,swap.id);
      $('swap-note').textContent=sf.state==='paused'?`${swap.name} is waiting for a reply; reminders are paused until ${swap.waitUntil}.`:`${swap.name} is well cared for; the next check-in is ${sf.daysLeft} ${sf.daysLeft===1?'day':'days'} away. Nothing else changes for either friend.`;
    }
  }
  $('person-zone').textContent=ZONES[p.zone];$('person-name').textContent=p.name;$('person-title').textContent=p.title;
  $('person-they').textContent=p.theyOffer||'Not noted yet';$('person-me').textContent=p.iOffer||'Not noted yet';$('person-met').textContent=p.met?`Connected ${p.met}`:'';
  $('person-plant').src=plantImage(p,f);
  const link=safeLink(p.linkedin);$('person-link').hidden=!link;$('person-link').href=link||'#';
  const posts=recentPosts(link);$('person-posts').hidden=!posts;$('person-posts').href=posts||'#';
  $('person-status').textContent=STATUS[f.state];
  $('person-last').textContent=(f.last?`Last contact ${f.last} · ${f.elapsed}d ago`:'No contact date yet')+(f.state==='paused'?` · reminders paused until ${p.waitUntil}`:` · every ${p.cadence} days`)+(nodeMap.has(p.id)?'':' · in the nursery');
  $('person-growth').textContent=f.growth+' growth';$('person-stage').textContent=STAGE[f.stage];$('growth-progress').value=Math.min(85,f.growth);$('growth-progress').setAttribute('aria-label',`${f.growth} growth points. ${STAGE[f.stage]}.`);
  $('growth-next').textContent=f.growth>=85?'Blooming. Every new moment still adds to your story.':`${(f.growth<30?30:85)-f.growth} points to ${f.growth<30?'Growing':'Blooming'}. Growth never fades with time.`;
  $('person-note').textContent=p.note||'Start with a small, genuine hello. Add a next step in the details below.';
  $('space-action').textContent=p.waitUntil&&p.waitUntil>today()?`Resume reminders (paused until ${p.waitUntil})`:'Waiting for a reply? Pause 14 days';
  const list=$('person-history');list.replaceChildren();
  const entries=garden.entries.filter(e=>e.personId===p.id).slice().reverse().sort((a,b)=>b.date.localeCompare(a.date)).slice(0,5);
  entries.forEach(e=>list.append(entryRow(e)));
  if(!entries.length)list.append(node('p','form-help','No moments recorded yet. Your earlier contact date is kept as the starting point.'));
}
document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>$(b.dataset.close).close());
document.querySelectorAll('dialog').forEach(d=>d.addEventListener('click',e=>{const r=d.getBoundingClientRect();if(e.target===d&&(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom))d.close();}));
$('person-dialog').addEventListener('close',()=>{for(const item of nodeMap.values())item.el.classList.remove('focused');for(const card of nurseryMap.values())card.classList.remove('focused');});
$('care-form').onsubmit=e=>{
  e.preventDefault();$('care-error').textContent='';
  try {
    const next=record(garden,{personId:selectedId,type:new FormData(e.target).get('type'),date:$('care-date').value,note:$('care-note').value});
    if(!persist(next))return;
    const entry=next.entries.at(-1),id=selectedId,p=next.people.find(p=>p.id===id);
    $('person-dialog').close();render();if(nodeMap.has(id)){scrollToFriend(id);animateWater(id,entry.points);}
    toast(`${p.name} · moment saved · +${entry.points} growth${writeIssue?' · not saved to browser':''}`,entry.id);
    nodeMap.get(id)?.button.focus({preventScroll:true});
  }catch(err){$('care-error').textContent=err.message;}
};
function animateWater(id,points) {
  const item=nodeMap.get(id);if(!item||motionPaused)return;
  const rain=node('div','water-fx','˙ 💧 ˙'),growth=node('div','growth-fx','+'+points);
  for(const el of [rain,growth]){el.style.left=item.pos[0]+'%';el.style.top=item.pos[1]+'%';$('effects').append(el);setTimeout(()=>el.remove(),1600);}
}
function openEdit(id=null,zone='stranger') {
  editId=id;const p=garden.people.find(p=>p.id===id);
  $('edit-heading').textContent=p?'A little more about this friend':'Plant a new friendship';
  $('edit-name').value=p?.name||'';$('edit-title').value=p?.title||'';$('edit-zone').value=p?.zone||zone;
  $('edit-species').value=p?.species||Object.keys(SPECIES)[garden.people.length%Object.keys(SPECIES).length];
  $('edit-cadence').value=p?.cadence||(zone==='strong'?14:zone==='stranger'?45:30);$('edit-last').value=p?.initialContact||'';$('edit-last').max=today();
  $('remove-friend').hidden=!p;$('remove-confirm').hidden=true;
  $('edit-company').value=p?.company||'';$('edit-met').value=p?.met||'';$('edit-met').max=today();$('edit-they').value=p?.theyOffer||'';$('edit-me').value=p?.iOffer||'';
  $('edit-wait').value=p?.waitUntil||'';$('edit-note').value=p?.note||'';$('edit-link').value=p?.linkedin||'';$('edit-error').textContent='';
  $('edit-dialog').showModal();
}
$('edit-species').replaceChildren(...Object.entries(SPECIES).map(([v,label])=>{const o=node('option','',label);o.value=v;return o;}));
$('edit-person').onclick=()=>openEdit(selectedId);
$('space-action').onclick=()=>{
  const p=garden.people.find(p=>p.id===selectedId);if(!p)return;
  const next=structuredClone(garden),target=next.people.find(x=>x.id===p.id);
  target.waitUntil=p.waitUntil&&p.waitUntil>today()?null:new Date(Date.parse(today())+14*86400000).toISOString().slice(0,10);
  if(!persist(next))return;render();fillPerson();toast(target.waitUntil?`Reminders paused until ${target.waitUntil}.`:'Reminders resumed.');
};
$('garden-toggle').onclick=()=>{
  const p=garden.people.find(p=>p.id===selectedId);if(!p)return;
  const planting=!nodeMap.has(p.id);
  if(planting&&!canPlace(garden,p)){toast(`The ${ZONES[p.zone]} bed is full (${CAPACITY[p.zone]} plants). Rest another friend in the nursery first.`);return;}
  const next=structuredClone(garden);next.people.find(x=>x.id===p.id).inGarden=planting;
  if(!persist(next))return;render();fillPerson();if(planting)scrollToFriend(p.id);
  toast(planting?`${p.name} is planted in the ${ZONES[p.zone]} bed.`:`${p.name} is resting in the nursery. Reminders continue as usual.`);
};
function swapFriends(inId,outId,undoing=false) {
  const next=structuredClone(garden),a=next.people.find(x=>x.id===inId),b=next.people.find(x=>x.id===outId);if(!a||!b)return;
  a.inGarden=true;b.inGarden=false;
  if(!persist(next))return;render();if($('person-dialog').open)fillPerson();if(nodeMap.has(inId))scrollToFriend(inId);
  toast(`${a.name} is planted in the ${ZONES[a.zone]} bed. ${b.name} is resting in the nursery.`,undoing?null:{label:'Undo',run:()=>swapFriends(outId,inId,true)});
}
$('add').onclick=()=>openEdit();$('empty-bed').onclick=()=>openEdit(null,'stranger');
$('remove-friend').onclick=()=>{
  const p=garden.people.find(x=>x.id===editId);if(!p)return;
  const n=garden.entries.filter(e=>e.personId===p.id).length;
  $('remove-text').textContent=`Remove ${p.name}${n?` and ${n} recorded ${n===1?'moment':'moments'}`:''}? You can undo this right after.`;
  $('remove-confirm').hidden=false;$('remove-no').focus();
};
$('remove-no').onclick=()=>{$('remove-confirm').hidden=true;$('remove-friend').focus();};
$('remove-yes').onclick=()=>{
  const p=garden.people.find(x=>x.id===editId);if(!p)return;
  const before=garden,next={...garden,people:garden.people.filter(x=>x.id!==p.id),entries:garden.entries.filter(e=>e.personId!==p.id)};
  if(!persist(next))return;
  $('edit-dialog').close();if($('person-dialog').open)$('person-dialog').close();selectedId=null;render();
  toast(`${p.name} was removed.`,{label:'Undo',run:()=>{if(persist(before)){render();toast(`${p.name} is back in the garden.`);}}});
};
$('edit-zone').onchange=()=>{if(!editId)$('edit-cadence').value=$('edit-zone').value==='strong'?14:$('edit-zone').value==='stranger'?45:30;};
$('edit-form').onsubmit=e=>{
  e.preventDefault();$('edit-error').textContent='';
  const name=$('edit-name').value.trim(),cadence=Number($('edit-cadence').value),last=$('edit-last').value||null,met=$('edit-met').value||null,wait=$('edit-wait').value||null,link=$('edit-link').value.trim();
  if(!name||!Number.isInteger(cadence)||cadence<1||cadence>365||(last&&(!validDate(last)||last>today()))||(wait&&!validDate(wait))||(met&&(!validDate(met)||met>today()))||(link&&!safeLink(link))){$('edit-error').textContent='Check the name, care rhythm, dates and HTTPS link.';return;}
  const old=garden.people.find(p=>p.id===editId),p={...(old||{id:uid(),initialGrowth:0,created:today(),inGarden:true}),species:$('edit-species').value,name,title:$('edit-title').value.trim(),zone:$('edit-zone').value,cadence,initialContact:last,waitUntil:wait,note:$('edit-note').value.trim(),linkedin:link,company:$('edit-company').value.trim(),met,theyOffer:$('edit-they').value.trim(),iOffer:$('edit-me').value.trim()};
  // A new friend, or a friend moving to another bed, only takes a slot if that bed and the garden have room.
  const wantsSlot=!old||(inGarden(old)&&old.zone!==p.zone);
  if(wantsSlot)p.inGarden=canPlace(garden,p,p.zone);
  const next={...garden,people:old?garden.people.map(o=>o.id===p.id?p:o):[...garden.people,p]};
  if(!persist(next))return;
  $('edit-dialog').close();render();if($('person-dialog').open)fillPerson();else if(nodeMap.has(p.id))scrollToFriend(p.id);
  toast(wantsSlot&&!p.inGarden?`${p.name} is resting in the nursery: the ${ZONES[p.zone]} bed is full. Rest another friend to make room.`:old?'Friendship details updated.':'A new friendship is planted. Record a first hello when you’re ready.');
};
document.querySelectorAll('[data-zone]').forEach(b=>b.onclick=()=>{
  currentZone=b.dataset.zone;document.querySelectorAll('[data-zone]').forEach(x=>{x.classList.toggle('active',x===b);x.setAttribute('aria-pressed',String(x===b));});
  render();const first=garden.people.find(matches);if(first)scrollToFriend(first.id);
});
$('care-filter').onclick=()=>{careOnly=!careOnly;setView('garden');render();const first=garden.people.find(matches);if(first)scrollToFriend(first.id);};
$('search').addEventListener('input',()=>{render();const first=garden.people.find(matches);if(first)scrollToFriend(first.id);});
function setView(view) {
  currentView=view;$('garden-view').hidden=view!=='garden';$('list-view').hidden=view!=='list';$('journal-view').hidden=view!=='journal';
  for(const v of ['garden','list','journal']){$(v+'-tab').classList.toggle('active',v===view);$(v+'-tab').setAttribute('aria-pressed',String(v===view));}
  $('zones').hidden=view!=='garden';
  if(view==='garden')fitScene();
}
$('garden-tab').onclick=()=>setView('garden');$('list-tab').onclick=()=>setView('list');$('journal-tab').onclick=()=>setView('journal');
$('list-add').onclick=()=>openEdit();
// The whole garden fits the window: the frame gets the height left below its top edge (less the legend under it),
// and CSS turns that into a width, since the scene is 3:2. Phones keep the swipeable panorama instead.
function fitScene() {
  const view=$('scene-scroll');if($('garden-view').hidden)return;
  const top=view.getBoundingClientRect().top+scrollY;
  document.documentElement.style.setProperty('--fit-h',Math.max(420,Math.floor(innerHeight-top-44))+'px');
}
addEventListener('resize',fitScene);
// Shortcuts: G garden, L list, J journal, N new friend, / find. Ignored while typing or while a dialog is open.
document.addEventListener('keydown',e=>{
  if(e.metaKey||e.ctrlKey||e.altKey||e.isComposing||document.querySelector('dialog[open]'))return;
  if(e.target.closest&&e.target.closest('input,textarea,select,[contenteditable]'))return;
  const k=e.key.toLowerCase(),view={g:'garden',l:'list',j:'journal'}[k];
  if(view)setView(view);else if(k==='n')openEdit();else if(k==='/')$('search').focus();else return;
  e.preventDefault();
});
$('backup').onclick=async()=>{
  const json=JSON.stringify(garden,null,2),filename='relationship-garden-'+today()+'.json';
  // Inside claude.ai a page cannot start a download itself; the downloads capability asks the viewer to save it.
  let downloads=null;try{downloads=window.claude&&window.claude.use?await window.claude.use('downloads'):null;}catch(e){}
  if(downloads) {
    try{await downloads.save({filename,data:json});toast('Backup saved.');}
    catch(e){if(e&&e.code!=='declined')toast('The backup could not be saved here. Open the garden in a browser tab and try again.');}
    return;
  }
  const url=URL.createObjectURL(new Blob([json],{type:'application/json'}));
  const a=node('a');a.href=url;a.download=filename;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
};
$('restore').onclick=()=>{$('restore-dialog').showModal();$('restore-revert').hidden=!lastRestore;};
$('backup-file').onchange=async e=>{
  pendingRestore=null;$('restore-confirm').disabled=true;$('restore-error').textContent='';$('restore-preview').textContent='';
  const file=e.target.files[0];if(!file)return;
  try{if(file.size>15000000)throw new Error('Choose a backup under 15 MB.');pendingRestore=parseBackup(await file.text());$('restore-preview').textContent=`${pendingRestore.people.length} friends · ${pendingRestore.entries.length} moments. This replaces the current garden; you can undo this restore in this session.`;$('restore-confirm').disabled=false;}
  catch(err){$('restore-error').textContent=err.message;}
};
$('restore-confirm').onclick=()=>{
  if(!pendingRestore)return;const before=structuredClone(garden);
  if(!persist(pendingRestore,true))return;
  lastRestore=before;pendingRestore=null;$('restore-confirm').disabled=true;$('restore-dialog').close();resetFilters();render();toast('Backup restored. Undo last restore is available under Restore.');
};
$('restore-revert').onclick=()=>{if(!lastRestore)return;if(persist(lastRestore,true)){lastRestore=null;$('restore-dialog').close();resetFilters();render();toast('Previous garden restored.');}};
function resetFilters(){currentZone='all';careOnly=false;$('search').value='';document.querySelectorAll('[data-zone]').forEach(b=>{b.classList.toggle('active',b.dataset.zone==='all');b.setAttribute('aria-pressed',String(b.dataset.zone==='all'));});}
$('background').src=ASSETS.background;
const pandaA=$('panda-a');
pandaA.src='data:image/png;base64,'+ASSETS.pandaClay;
document.querySelectorAll('.butterfly').forEach(el=>{el.src='data:image/png;base64,'+ASSETS.butterflyClay;});
document.querySelectorAll('.bed-sign img').forEach(el=>{el.src=ASSETS.signClay;});
document.querySelectorAll('[data-guide-plant]').forEach(el=>{el.src=ASSETS.tiles[el.dataset.guidePlant];});
$('plant-guide').onclick=()=>$('guide-dialog').showModal();
const reduced=matchMedia('(prefers-reduced-motion: reduce)');
let motionPaused=reduced.matches;
function syncMotion(){document.body.classList.toggle('paused-motion',motionPaused);$('motion').textContent=motionPaused?'Resume motion':'Pause motion';$('motion').setAttribute('aria-pressed',String(motionPaused));}
$('motion').onclick=()=>{motionPaused=!motionPaused;syncMotion();};
reduced.addEventListener('change',e=>{motionPaused=e.matches;syncMotion();});
document.addEventListener('visibilitychange',()=>{if(!document.hidden){render();if($('person-dialog').open)fillPerson();}});
let lastDay=today();setInterval(()=>{if(today()!==lastDay){lastDay=today();render();if($('person-dialog').open)fillPerson();}},60000);
render();fitScene();$('scene-scroll').scrollTop=80;syncMotion();openStore();
