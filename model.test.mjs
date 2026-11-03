import test from 'node:test';
import assert from 'node:assert/strict';
import {seed,facts,record,undo,parseBackup,validDate,safeLink,careQueue,slots,BEDS,CAPACITY,canPlace,swapSuggestion,demoGarden,gardenPeople,splitTitle} from './model.mjs';
const day='2026-09-29';
const base=()=>seed([{name:'Alex',title:'Friend',zone:'weak',last:'2026-09-01',notes:'',bloom:'tulip'}],{},day);
test('care queue prioritizes overdue ratios and excludes paused, new and healthy friends',()=>{
  const g=base(),p=g.people[0];
  g.people=[{...p,id:'weak',cadence:20},{...p,id:'strong',zone:'strong',cadence:20},{...p,id:'paused',waitUntil:'2026-10-01'},{...p,id:'new',initialContact:null},{...p,id:'healthy',cadence:60}];
  assert.deepEqual(careQueue(g,day).map(x=>x.person.id),['strong','weak']);
});
test('growth never decays while health follows the personal cadence',()=>{const g=base(),p=g.people[0];assert.equal(facts(g,p,'2027-01-01').growth,facts(g,p,day).growth);assert.equal(facts(g,p,'2026-10-01').state,'thirsty');assert.equal(facts(g,p,'2026-10-16').state,'wilted');});
test('record restores health, retains growth, and undo restores the exact prior state',()=>{let g=base();g.people[0].initialGrowth=110;g.people[0].initialContact='2026-01-01';const before=structuredClone(g);g=record(g,{personId:'contact-1',type:'message',date:day,note:'Hello'},day);assert.equal(facts(g,g.people[0],day).state,'healthy');assert.equal(facts(g,g.people[0],day).stage,'bloom');assert.equal(facts(g,g.people[0],day).growth,140);assert.deepEqual(undo(g,g.entries[0].id),before);});
test('backdated interactions do not move last contact backwards',()=>{let g=base();g=record(g,{personId:'contact-1',type:'coffee',date:'2026-08-01'},day);assert.equal(facts(g,g.people[0],day).last,'2026-09-01');});
test('exact duplicate and invalid or future dates are rejected',()=>{const input={personId:'contact-1',type:'light',date:day};const g=record(base(),input,day);assert.throws(()=>record(g,input,day),/already/);assert.throws(()=>record(g,{...input,date:'2026-10-01'},day));assert.throws(()=>record(g,{...input,date:'2026-02-30'},day));assert.equal(validDate('2026-02-30'),false);assert.throws(()=>record(g,{...input,personId:'unknown'},day));});
test('two people with the same name have separate stable records',()=>{const g=base();g.people.push({...g.people[0],id:'other'});const next=record(g,{personId:'other',type:'message',date:day},day);assert.equal(facts(next,next.people[0],day).growth,g.people[0].initialGrowth);assert.equal(facts(next,next.people[1],day).growth,g.people[1].initialGrowth+30);});
test('undo an earlier event does not undo a later event or edits',()=>{let g=record(base(),{personId:'contact-1',type:'message',date:'2026-09-25'},day);const id=g.entries[0].id;g=record(g,{personId:'contact-1',type:'coffee',date:day},day);g.people[0].note='Updated note';const reverted=undo(g,id);assert.equal(reverted.entries.length,1);assert.equal(reverted.people[0].note,'Updated note');assert.equal(facts(reverted,reverted.people[0],day).last,day);});
test('legacy progress is a baseline, dates kept, source not mutated',()=>{const old={Alex:{base:80,last:'2026-09-26',rescue:true}},copy=structuredClone(old);const g=seed([{name:'Alex',zone:'strong',last:'2026-01-01'}],old,day);assert.equal(g.people[0].initialGrowth,75);assert.equal(g.people[0].initialContact,'2026-09-26');assert.equal(g.entries.length,0);assert.deepEqual(old,copy);});
test('backup schema rejects dangling entries, duplicate ids, and bad values',()=>{const g=record(base(),{personId:'contact-1',type:'message',date:day},day);assert.deepEqual(parseBackup(JSON.stringify(g),day),g);for(const change of [x=>x.entries[0].personId='missing',x=>x.people.push(x.people[0]),x=>x.entries.push(x.entries[0]),x=>x.entries[0].points=99,x=>x.people[0].initialGrowth=NaN,x=>x.people[0].cadence=0]){const bad=structuredClone(g);change(bad);assert.throws(()=>parseBackup(bad,day));}assert.throws(()=>parseBackup('null',day));});
test('pause suppresses care reminders, expires on chosen date',()=>{const g=base();g.people[0].waitUntil='2026-11-01';assert.equal(facts(g,g.people[0],'2026-10-20').state,'paused');assert.equal(facts(g,g.people[0],'2026-11-01').state,'wilted');});
test('unknown contact date stays unknown and unsafe links are rejected',()=>{const g=seed([{name:'New',zone:'stranger',last:null}],{},day);assert.equal(facts(g,g.people[0],day).state,'new');assert.equal(g.people[0].initialContact,null);assert.equal(safeLink('javascript:alert(1)'),null);assert.equal(safeLink('https://example.com'),'https://example.com/');});

test('each bed exposes exactly its capacity in slots, all inside the soil quadrilateral bounds',()=>{
  for(const zone of Object.keys(BEDS)){const s=slots(zone),xs=BEDS[zone].corners.map(c=>c[0]),ys=BEDS[zone].corners.map(c=>c[1]);
    assert.equal(s.length,CAPACITY[zone]);
    for(const p of s){assert.ok(p.x>=Math.min(...xs)&&p.x<=Math.max(...xs)&&p.y>=Math.min(...ys)&&p.y<=Math.max(...ys));}
    assert.equal(new Set(s.map(p=>p.x+','+p.y)).size,s.length);}
  assert.ok(slots('weak')[0].x>20&&slots('weak')[0].x<40,'first slot is a centre column');
});
test('bed capacity decides who can be planted; the three beds hold 20 and extras rest in the nursery',()=>{
  assert.equal(Object.values(CAPACITY).reduce((x,y)=>x+y,0),20);
  const g=base(),p=g.people[0];
  g.people=Array.from({length:12},(_,i)=>({...p,id:'w'+i}));
  assert.equal(gardenPeople(g,'weak').length,10);
  assert.equal(canPlace(g,{id:'new',zone:'weak'}),false);
  assert.equal(canPlace(g,{id:'new',zone:'strong'}),true);
  g.people[0].inGarden=false;g.people[1].inGarden=false;g.people[2].inGarden=false;
  assert.equal(canPlace(g,{id:'new',zone:'weak'}),true);
  assert.equal(canPlace(g,g.people[3]),true,'a planted friend re-checking its own bed still fits');
  assert.deepEqual(gardenPeople(g,'weak').map(x=>x.id),['w3','w4','w5','w6','w7','w8','w9','w10','w11']);
});
test('backups without an inGarden flag load as planted; non-boolean flags are rejected',()=>{
  const g=base();delete g.people[0].inGarden;
  assert.equal(parseBackup(JSON.stringify(g),day).people[0].inGarden,true);
  g.people[0].inGarden='yes';assert.throws(()=>parseBackup(JSON.stringify(g),day));
});
test('swap suggestion rests a paused friend first, else the healthy friend with the longest time left, never one who needs care',()=>{
  const g=base(),p=g.people[0];
  g.people=[{...p,id:'due',name:'Due',initialContact:'2026-08-01',cadence:30},{...p,id:'soon',name:'Soon',initialContact:'2026-09-10',cadence:30},{...p,id:'fresh',name:'Fresh',initialContact:'2026-09-28',cadence:30},{...p,id:'rest',name:'Rest',initialContact:'2026-09-28',cadence:30,inGarden:false}];
  assert.equal(swapSuggestion(g,'weak',day).id,'fresh');
  g.people.push({...p,id:'wait',name:'Wait',initialContact:'2026-08-01',waitUntil:'2026-10-10'});
  assert.equal(swapSuggestion(g,'weak',day).id,'wait');
  g.people=[g.people[0]];
  assert.equal(swapSuggestion(g,'weak',day),null);
  assert.equal(swapSuggestion(g,'strong',day),null);
});
test('backups accept the five flowers and reject an unknown one',()=>{
  const g=base();
  for(const species of ['daisies','tulip','lavender','hydrangea','sunflower']){g.people[0].species=species;assert.equal(parseBackup(JSON.stringify(g),day).people[0].species,species);}
  g.people[0].species='rose';assert.throws(()=>parseBackup(JSON.stringify(g),day));
});
test('demo garden is valid, fills every bed, and shows every care state and flower',()=>{
  const g=demoGarden(day);assert.deepEqual(parseBackup(JSON.stringify(g),day),g);
  for(const zone of Object.keys(CAPACITY))assert.equal(gardenPeople(g,zone).length,CAPACITY[zone]);
  const planted=g.people.filter(p=>p.inGarden),states=new Set(planted.map(p=>facts(g,p,day).state));
  for(const s of ['healthy','thirsty','wilted','paused','new'])assert.ok(states.has(s),'missing state '+s);
  const blooms=new Set(planted.filter(p=>facts(g,p,day).stage==='bloom').map(p=>p.species));
  assert.equal(blooms.size,5);
  assert.ok(g.people.some(p=>!p.inGarden&&facts(g,p,day).due),'a nursery friend needs care, to show swapping');
  assert.ok(g.entries.length>=10);
  assert.ok(g.people.every(p=>p.linkedin===''),'no links to real profiles');
});
test('company and role come from an explicit company or a "Role @ Company" title', () => {
  assert.deepEqual(splitTitle({title:'Brand Manager @ Wattle & Pine'}),{role:'Brand Manager',company:'Wattle & Pine'});
  assert.deepEqual(splitTitle({title:'Mentor'}),{role:'Mentor',company:''});
  assert.deepEqual(splitTitle({title:'Lead',company:'Canva'}),{role:'Lead',company:'Canva'});
});
test('value exchange fields are optional in backups and checked when present', () => {
  const g=base(),old=structuredClone(g);for(const p of old.people){delete p.company;delete p.met;delete p.theyOffer;delete p.iOffer;}
  const back=parseBackup(JSON.stringify(old),day);assert.equal(back.people[0].theyOffer,'');assert.equal(back.people[0].met,null);
  const bad=structuredClone(g);bad.people[0].met='2099-01-01';assert.throws(()=>parseBackup(bad,day));
  const ok=structuredClone(g);Object.assign(ok.people[0],{company:'Canva',met:'2026-08-01',theyOffer:'Referral',iOffer:'Content ideas'});assert.equal(parseBackup(ok,day).people[0].iOffer,'Content ideas');
  for(const p of demoGarden(day).people){assert.ok(p.theyOffer&&p.iOffer&&p.met<=day);}
});
