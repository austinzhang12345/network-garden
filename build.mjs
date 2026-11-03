import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const dir=path.dirname(fileURLToPath(import.meta.url));
// Plant sprites: 7 looks x 3 care states, aligned to one frame by tools/normalize_plants.py.
const plantDir=path.join(dir,'assets/plants');
const tiles=Object.fromEntries(fs.readdirSync(plantDir).filter(f=>f.endsWith('.webp')).map(f=>[f.slice(0,-5),'data:image/webp;base64,'+fs.readFileSync(path.join(plantDir,f)).toString('base64')]));
const plantBounds=JSON.parse(fs.readFileSync(path.join(plantDir,'bounds.json'),'utf8')).bounds;
const background='data:image/webp;base64,'+fs.readFileSync(path.join(dir,'assets/background-clay-clean.webp')).toString('base64');
const pandaClay=fs.readFileSync(path.join(dir,'assets/panda-clay-v2.png')).toString('base64');
const butterflyClay=fs.readFileSync(path.join(dir,'assets/butterfly-clay-v1.png')).toString('base64');
const signClay='data:image/webp;base64,'+fs.readFileSync(path.join(dir,'assets/sign-clay-v1.webp')).toString('base64');
// Every page ships with no people. Your own friends live only in your browser's storage.
// The demo build carries a flag instead; its fictional friends come from demoGarden() in model.mjs.
const model=fs.readFileSync(path.join(dir,'model.mjs'),'utf8').replace(/^export /gm,'');
const app=fs.readFileSync(path.join(dir,'app.js'),'utf8');
const css=fs.readFileSync(path.join(dir,'styles.css'),'utf8')+'\n'+fs.readFileSync(path.join(dir,'layout-tweaks.css'),'utf8');
function page(demo) {
  const assets={contacts:[],tiles,plantBounds,background,pandaClay,butterflyClay,signClay,demo};
  const script=`"use strict";\n(()=>{\nconst ASSETS=${JSON.stringify(assets).replace(/</g,'\\u003c')};\n${model}\n${app}\n})();`;
  let html=fs.readFileSync(path.join(dir,'index.html'),'utf8').replace('/* STYLES */',()=>css).replace('/* APPLICATION */',()=>script.replace(/<\/script/gi,'<\\/script'));
  if(demo) html=html.replace('<title>Network Garden</title>','<title>Network Garden Demo</title>');
  return html;
}
// docs/ is served by GitHub Pages: index.html is the demo, garden.html is an empty garden of your own.
const out=path.join(dir,'docs');
fs.mkdirSync(out,{recursive:true});
const demoHtml=page(true),html=page(false);
fs.writeFileSync(path.join(out,'index.html'),demoHtml);
fs.writeFileSync(path.join(out,'garden.html'),html);
console.log(`Built docs/index.html (demo) and docs/garden.html (your own) · ${(Buffer.byteLength(html)/1024/1024).toFixed(2)} MB each · no contacts embedded`);
