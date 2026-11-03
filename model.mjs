export const KEY = 'relationship-garden-v2';
export const TYPES = { message: { label: 'Message', points: 30 }, coffee: { label: 'Coffee / call', points: 30 }, help: { label: 'Help / introduction', points: 30 }, light: { label: 'Light touch', points: 5 } };
export const ZONES = { weak: 'Weak Ties', strong: 'Strong Ties', stranger: 'New Faces' };
// The flower a friend's plant opens into once it blooms. Seedling and growing stages look the same for everyone.
export const SPECIES = { daisies: 'Daisies', tulip: 'Tulip', lavender: 'Lavender', hydrangea: 'Hydrangea', sunflower: 'Sunflower' };
// The garden shows 20 friends: each bed has a fixed number of slots. Everyone else rests in the nursery.
export const CAPACITY = { weak: 10, strong: 4, stranger: 6 };
// Inner soil corners of each bed as [back-left, back-right, front-right, front-left] in % of the scene, and plants per row
// from back to front. Measured against assets/background-clay-clean.webp with a 5% grid overlay; re-measure if the background changes.
export const BEDS = {
  weak: { corners: [[23.5,43.5],[46.5,52.5],[30.2,71],[6,61]], rows: [4,3,3] },
  strong: { corners: [[76,41.5],[93,45],[88,53.5],[72.5,49.5]], rows: [2,2] },
  stranger: { corners: [[65.5,62],[86,64.5],[80,79.5],[62.5,72.5]], rows: [3,3] },
};
export function slots(zone) {
  const { corners: [tl,tr,br,bl], rows } = BEDS[zone], R = rows.length, out = [];
  rows.forEach((cols,i) => {
    for (let j = 0; j < cols; j++) {
      // Alternate rows lean a quarter column left and right, so a plant never stands directly behind another.
      const u = Math.min(0.91, Math.max(0.09, (j+0.5)/cols + (i%2 ? 0.25 : -0.25)/cols)), v = (i+0.7)/R;
      const at = k => tl[k]*(1-u)*(1-v) + tr[k]*u*(1-v) + br[k]*u*v + bl[k]*(1-u)*v;
      out.push({ x: +at(0).toFixed(2), y: +at(1).toFixed(2), row: i, depth: R > 1 ? i/(R-1) : 1, centre: Math.abs(u-0.5) });
    }
  });
  // Fill order: centre columns first so a half-full bed still looks planted, alternating rows.
  return out.sort((a,b) => a.centre-b.centre || a.row-b.row).map(({x,y,row,depth}) => ({x,y,row,depth}));
}
export function inGarden(p) { return p.inGarden !== false; }
export function gardenPeople(garden, zone) { return garden.people.filter(p => p.zone === zone && inGarden(p)).slice(0, CAPACITY[zone]); }
export function canPlace(garden, person, zone = person.zone) {
  return garden.people.filter(p => p.id !== person.id && inGarden(p) && p.zone === zone).length < CAPACITY[zone];
}
export function today() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
export function validDate(s) { return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(Date.parse(s)) && new Date(s).toISOString().slice(0,10) === s; }
export function daysBetween(a,b) { return Math.round((Date.parse(b)-Date.parse(a))/86400000); }
export function uid() { return 'g-' + (globalThis.crypto?.randomUUID?.() || Date.now().toString(36)+'-'+Math.random().toString(36).slice(2)); }
export function stage(growth) { return growth >= 85 ? 'bloom' : growth >= 30 ? 'bush' : 'sprout'; }
export function facts(garden, p, date = today()) {
  const entries = garden.entries.filter(e => e.personId === p.id);
  const growth = p.initialGrowth + entries.reduce((sum,e) => sum + e.points,0);
  const dates = [p.initialContact, ...entries.map(e=>e.date)].filter(Boolean).sort();
  const last = dates.at(-1) || null;
  const elapsed = last ? Math.max(0,daysBetween(last,date)) : null;
  const paused = !!p.waitUntil && p.waitUntil > date;
  const state = paused ? 'paused' : last === null ? 'new' : elapsed >= p.cadence*1.5 ? 'wilted' : elapsed >= p.cadence ? 'thirsty' : 'healthy';
  return {growth,stage:stage(growth),last,elapsed,state,due:state==='thirsty'||state==='wilted',daysLeft:last ? Math.max(0,p.cadence-elapsed):null};
}
// When a bed is full, suggest who could rest in the nursery: someone waiting for a reply first,
// otherwise the well-cared-for friend whose next check-in is furthest away. Never someone who needs care.
export function swapSuggestion(garden, zone, date = today()) {
  return gardenPeople(garden, zone).map(person => ({person, f: facts(garden, person, date)}))
    .filter(x => x.f.state === 'paused' || x.f.state === 'healthy')
    .sort((a,b) => (b.f.state === 'paused') - (a.f.state === 'paused') || b.f.daysLeft - a.f.daysLeft || a.person.name.localeCompare(b.person.name))[0]?.person || null;
}
export function careQueue(garden, date = today()) {
  return garden.people.map(person => ({person, care:facts(garden,person,date)})).filter(item=>item.care.due).sort((a,b)=>{
    const weight=item=>item.care.elapsed/item.person.cadence+(item.person.zone==='strong'?0.2:0);
    return weight(b)-weight(a) || a.person.name.localeCompare(b.person.name);
  });
}
export function seed(contacts, legacy = {}, date = today()) {
  const people = contacts.map((c,i) => {
    const old = legacy && typeof legacy === 'object' && !Array.isArray(legacy) ? legacy[c.name] : null;
    const last = validDate(old?.last) && old.last <= date ? old.last : validDate(c.last) && c.last <= date ? c.last : null;
    const base = Number.isFinite(old?.base) && old.base >= 0 && old.base <= 100 ? old.base : 100;
    const growth = last ? Math.max(0, Math.round(base - Math.max(0,daysBetween(last,date))*100/60)) : 0;
    return {id:`contact-${i+1}`,name:c.name,title:c.title||'',zone:ZONES[c.zone]?c.zone:'stranger',initialGrowth:growth,initialContact:last,cadence:c.zone==='strong'?14:c.zone==='stranger'?45:30,waitUntil:null,note:c.notes||'',linkedin:c.linkedin||'',species:c.bloom==='tulip'?'tulip':'daisies',created:date,inGarden:true,company:'',met:null,theyOffer:'',iOffer:''};
  });
  return {version:2,people,entries:[]};
}
export function record(garden, {personId,type,date,note=''}, now = today()) {
  if (!garden.people.some(p=>p.id===personId)) throw new Error('Choose a friend first.');
  if (!TYPES[type]) throw new Error('Choose an interaction type.');
  if (!validDate(date) || date > now) throw new Error('Choose a valid date, today or earlier.');
  note = note.trim().slice(0,2000);
  if (garden.entries.some(e=>e.personId===personId && e.type===type && e.date===date && e.note===note)) throw new Error('This interaction is already recorded. Add a different note if this was a separate conversation.');
  const entry = {id:uid(),personId,type,date,note,points:TYPES[type].points,createdAt:new Date().toISOString()};
  return {...garden,entries:[...garden.entries,entry]};
}
export function undo(garden, id) { return {...garden,entries:garden.entries.filter(e=>e.id!==id)}; }
export function parseBackup(raw, date = today()) {
  const g = typeof raw === 'string' ? JSON.parse(raw) : raw;
  const fail = () => { throw new Error('This backup is incomplete or invalid. Your current garden has not been changed.'); };
  if (!g || g.version!==2 || !Array.isArray(g.people) || !Array.isArray(g.entries) || g.people.length>10000 || g.entries.length>100000) fail();
  const ids=new Set(),eventIds=new Set();
  const text = (s,max) => typeof s==='string' && s.length<=max;
  for(const p of g.people) {
    if(!p || !text(p.id,100) || !p.id || ids.has(p.id) || !text(p.name,80) || !p.name.trim() || !Object.hasOwn(ZONES,p.zone) || !Number.isInteger(p.initialGrowth) || p.initialGrowth<0 || p.initialGrowth>1000000 || !Number.isInteger(p.cadence) || p.cadence<1 || p.cadence>365 || (p.initialContact!==null && (!validDate(p.initialContact)||p.initialContact>date)) || (p.waitUntil!==null&&!validDate(p.waitUntil)) || !text(p.title,300) || !text(p.note,2000) || !text(p.linkedin,500) || !Object.hasOwn(SPECIES,p.species) || !validDate(p.created) || (p.inGarden !== undefined && typeof p.inGarden !== 'boolean') || (p.company!==undefined && !text(p.company,120)) || (p.met!=null && (!validDate(p.met)||p.met>date)) || (p.theyOffer!==undefined && !text(p.theyOffer,500)) || (p.iOffer!==undefined && !text(p.iOffer,500))) fail();
    ids.add(p.id);
  }
  for(const e of g.entries) {
    if(!e || !text(e.id,100) || !e.id || eventIds.has(e.id) || !ids.has(e.personId) || !Object.hasOwn(TYPES,e.type) || e.points!==TYPES[e.type].points || !validDate(e.date) || e.date>date || !text(e.note,2000) || typeof e.createdAt!=='string' || !Number.isFinite(Date.parse(e.createdAt))) fail();
    eventIds.add(e.id);
  }
  const clean = structuredClone(g);
  for (const p of clean.people) { p.inGarden = p.inGarden !== false; p.company ??= ''; p.met ??= null; p.theyOffer ??= ''; p.iOffer ??= ''; }
  return clean;
}
// Company and role for the list. Older entries keep both in the title as "Role @ Company"; an explicit company wins.
export function splitTitle(p) {
  const t=(p.title||'').trim();if(p.company)return {role:t,company:p.company};
  const i=t.lastIndexOf(' @ ');return i>0?{role:t.slice(0,i).trim(),company:t.slice(i+3).trim()}:{role:t,company:''};
}
export function safeLink(value) { try { const u=new URL(value); return u.protocol==='https:' ? u.href : null; } catch { return null; } }

// Demo garden for showing the idea in public. Every person and company is fictional. Dates are counted back from the
// day the page opens, so the care states always look the same: [name, title, zone, days since last contact (null =
// never), growth before moments, flower, next step, moments [[days ago, type, note]], options].
const DEMO_PEOPLE = [
  ['Maya Okafor','Head of Content @ Paperkite Studio','weak',6,95,'daisies','She mentioned a content lead role opening in Q1. Send the short-form case study before then.',[[6,'coffee','Coffee near Central. Talked about how her team plans video series.'],[40,'message','Congratulated her on the rebrand launch.']]],
  ['Liam O\'Connor','Social Lead @ Bluegum Analytics','weak',34,60,'tulip','Share the community growth write-up he asked about.',[]],
  ['Priya Nair','Brand Manager @ Wattle & Pine','weak',52,90,'tulip','Comment on her next campaign post, then ask for a 20-minute call.',[[52,'message','Sent notes from the brand summit.']]],
  ['Tom Reyes','Community Manager @ Larkspur Media','weak',12,110,'lavender','Check how the podcast intro went.',[[12,'help','Introduced him to a podcast producer.']]],
  ['Hana Sato','Creative Director @ Saltbush Design','weak',38,88,'hydrangea','Ask what she looks for in a portfolio review.',[[38,'coffee','Studio visit. She showed their moodboard process.']]],
  ['Ben Walsh','Talent Partner @ Juniper Health','weak',3,35,'sunflower','Follow up after the hiring manager sees the portfolio.',[[3,'message','Sent portfolio link after the info session.']]],
  ['Zoe Martin','Partnerships Lead @ Cobalt Harbour','weak',20,70,'daisies','Waiting to hear back about the panel invite.',[],{wait:9}],
  ['Ava Thompson','Marketing Director @ Tidewater Bank','weak',18,120,'sunflower','Send her the creator brief template.',[[18,'message','Sent the case study she asked about.']]],
  ['Noah Kim','Product Marketer @ Quillfeather','weak',47,15,'lavender','Say hi with something useful, not an ask.',[]],
  ['Grace Liu','Event Producer @ Lanternfly Events','weak',9,92,'daisies','Offer to help at the November meetup.',[[9,'coffee','Walked through her event production workflow.']]],
  ['Ethan Brooks','Former manager @ Larkspur Media','strong',5,130,'tulip','He offered to review my CV. Send the latest version.',[[5,'coffee','Lunch catch-up.']]],
  ['Sofia Rossi','Mentor','strong',16,115,'lavender','Book the monthly mentoring chat.',[[16,'help','Asked for advice on negotiating an offer.']]],
  ['Jack Nguyen','Uni friend · Product @ Bluegum Analytics','strong',2,100,'sunflower','Celebrate the v2 launch together.',[[2,'light','Liked his post about shipping v2.']]],
  ['Chloe Evans','Former teammate','strong',24,90,'hydrangea','Long overdue dinner. Pick a date.',[[24,'coffee','Dinner in Newtown.']]],
  ['Oliver Grant','Speaker at a content meetup','stranger',4,5,'tulip','Read the article he recommended, then reply with one takeaway.',[[4,'message','Thanked him for the talk on short-form video.']]],
  ['Isla Patel','Met at a coffee chat','stranger',null,0,'hydrangea','Send the first hello this week.',[]],
  ['Lucas Ford','Alumni · Strategy @ Kestrel Partners','stranger',50,30,'daisies','Ask about his move from agency to strategy.',[[50,'message','Alumni intro email.']]],
  ['Mia Johnson','Panelist at a women in media night','stranger',8,10,'sunflower','Share the panel recap post and tag her.',[]],
  ['Henry Lam','Growth @ Paperkite Studio','stranger',null,0,'lavender','Warm intro through Maya first.',[]],
  ['Ruby Scott','Met at a hackathon','stranger',70,35,'tulip','Reconnect with the demo video from that weekend.',[]],
  ['Daniel Park','Designer @ Saltbush Design','weak',40,50,'daisies','Ask how the new studio space is going.',[],{rest:true}],
  ['Emily Clarke','Met on a webinar','stranger',null,0,'tulip','Find her on LinkedIn and connect with a note.',[],{rest:true}],
  ['Sam Whitlock','Copywriter @ Wattle & Pine','weak',10,45,'sunflower','Swap notes on freelance rates.',[],{rest:true}],
  ['Leah Wong','Met at a careers fair','stranger',80,20,'lavender','Send a short update on the job search.',[],{rest:true}],
  ['Max Fischer','Podcast host','weak',null,0,'hydrangea','Pitch a guest episode idea.',[],{rest:true}],
  ['Nina Alvarez','Former client @ Tidewater Bank','strong',30,100,'daisies','She asked to hear when I start somewhere new.',[[30,'message','Sent a thank-you note for the testimonial.']],{rest:true}],
];
// What each fictional friend and I can offer each other, and when we first connected (days ago).
const DEMO_VALUE = {
  'Maya Okafor':[400,'Referral for the Q1 content lead role','Short-form video case studies'],
  "Liam O'Connor":[210,'Data on what social content converts','Community growth playbook'],
  'Priya Nair':[300,'Brand team hiring news','Creator shortlist for her campaigns'],
  'Tom Reyes':[180,'Intros to media hosts','Podcast producer contacts'],
  'Hana Sato':[260,'Portfolio feedback','Behind-the-scenes content for the studio'],
  'Ben Walsh':[30,'Inside view of the hiring process','Candidate referrals'],
  'Zoe Martin':[150,'Panel speaking slot','Speaker suggestions from my network'],
  'Ava Thompson':[520,'Senior marketing mentorship','Creator brief templates'],
  'Noah Kim':[90,'Product marketing perspective','Launch video ideas'],
  'Grace Liu':[120,'Event industry contacts','Volunteer help at her meetups'],
  'Ethan Brooks':[900,'Reference and CV review','Updates on my wins'],
  'Sofia Rossi':[700,'Career advice and negotiation tips','Fresh takes on social trends'],
  'Jack Nguyen':[1800,'Honest product feedback','Launch promotion on my channels'],
  'Chloe Evans':[800,'Friendship and job leads','Design feedback on her side project'],
  'Oliver Grant':[4,'Short-form video know-how','A recap post of his talk'],
  'Isla Patel':[10,'Coffee chat on agency life',"Notes on Sydney's creator scene"],
  'Lucas Ford':[60,'Strategy career path advice','Alumni event invites'],
  'Mia Johnson':[8,'Women in media network','Panel recap and tag'],
  'Henry Lam':[5,'Growth team insights','A warm intro through Maya'],
  'Ruby Scott':[70,'Developer friends for side projects','The demo video from the weekend'],
  'Daniel Park':[200,'Design studio contacts','Social content for the new studio'],
  'Emily Clarke':[15,'Webinar community','A thoughtful connection note'],
  'Sam Whitlock':[110,'Freelance rate benchmarks','Copywriting clients I hear about'],
  'Leah Wong':[80,'Graduate hiring tips','A job search update'],
  'Max Fischer':[45,'A guest episode','An episode idea and promotion'],
  'Nina Alvarez':[600,'Testimonial and referrals','News when I start somewhere new'],
};
export function demoGarden(date = today()) {
  const back = n => new Date(Date.parse(date) - n*86400000).toISOString().slice(0,10);
  const people = [], entries = [];
  DEMO_PEOPLE.forEach(([name,title,zone,days,growth,species,note,moments,opt={}],i) => {
    const id = `demo-${i+1}`, spent = moments.reduce((s,[,t]) => s + TYPES[t].points, 0);
    people.push({id,name,title,zone,initialGrowth:Math.max(0,growth-spent),initialContact:days===null?null:back(days),cadence:zone==='strong'?14:zone==='stranger'?45:30,waitUntil:opt.wait?back(-opt.wait):null,note,linkedin:'',species,created:back(90),inGarden:!opt.rest,company:'',met:back(DEMO_VALUE[name][0]),theyOffer:DEMO_VALUE[name][1],iOffer:DEMO_VALUE[name][2]});
    moments.forEach(([d,type,text],k) => entries.push({id:`${id}-m${k+1}`,personId:id,type,date:back(d),note:text,points:TYPES[type].points,createdAt:new Date(Date.parse(back(d))+43200000).toISOString()}));
  });
  return {version:2,people,entries};
}
