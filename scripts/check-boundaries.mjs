import { readFile, readdir, access } from 'node:fs/promises';
import { resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
const root=fileURLToPath(new URL('..',import.meta.url));
const files=(await readdir(resolve(root,'src'))).filter(name=>name.endsWith('.js')).sort();
const errors=[],warnings=[],graph=new Map();
const pure=new Set(['circuit-engine.js','circuit-edit.js','circuit-geometry.js','circuit-status.js','analysis-policy.js','scope-model.js','plot-format.js','measurement-format.js','phasor-format.js','project-format.js','csv-format.js','union-find.js','pointer-session.js','ui-model.js','analysis-diagnostics.js','input-drafts.js','color-model.js','interaction-math.js']);
for(const file of files){
 const source=await readFile(resolve(root,'src',file),'utf8');
 const imports=[...source.matchAll(/\b(?:from\s*|import\s*)["'](\.[^"']+)["']/g)].map(match=>match[1]);
 graph.set(file,imports.map(path=>basename(path)));
 for(const path of imports)try{await access(resolve(root,'src',path));}catch{errors.push(`${file}: missing relative import ${path}`);}
 if(pure.has(file)&&/\b(?:window|document|localStorage|sessionStorage)\s*[.[]|\baddEventListener\s*\(/.test(source))errors.push(`${file}: browser dependency inside a pure model`);
 if(pure.has(file)&&imports.some(path=>/\/(?:app|scope-view|phasor-view|theme|trace-color)\.js$/.test(path)))errors.push(`${file}: model imports a view/controller`);
 if(['scope-view.js','phasor-view.js'].includes(file)&&imports.some(path=>path.includes('circuit-engine')))errors.push('scope-view.js: display imports solver');
 if(file==='app.js'&&source.split('\n').length>1500)warnings.push('app.js remains a large coordinator; extract edit/run controllers in separately tested changes.');
}
const visited=new Set(),active=new Set();
function visit(file,chain=[]){
 if(active.has(file)){errors.push(`Import cycle: ${[...chain,file].join(' -> ')}`);return;}
 if(visited.has(file))return;
 active.add(file);for(const next of graph.get(file)??[])visit(next,[...chain,file]);active.delete(file);visited.add(file);
}
for(const file of files)visit(file);
console.log(JSON.stringify({checker:'lightweight static pattern review, not a parser or correctness proof',files:files.length,errors,warnings},null,2));
if(errors.length)process.exitCode=1;
