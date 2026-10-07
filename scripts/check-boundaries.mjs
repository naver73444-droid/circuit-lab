import { readFile, readdir, access } from 'node:fs/promises';
import { resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
const root=fileURLToPath(new URL('..',import.meta.url));
const files=(await readdir(resolve(root,'src'))).filter(name=>name.endsWith('.js')).sort();
const MAX_LINE=240;
const errors=[],warnings=[],graph=new Map();
const pure=new Set(['circuit-engine.js','y-delta-model.js','y-delta-circuit.js','y-delta-tool-model.js','circuit-edit.js','circuit-geometry.js','circuit-status.js','analysis-policy.js','scope-model.js','plot-format.js','phasor-format.js','project-format.js','csv-format.js','union-find.js','ui-model.js','analysis-diagnostics.js','input-drafts.js','interaction-math.js','persistence.js','share-url.js','measure-model.js','wave-measure-model.js','cursor-delta-model.js','cursor-label-model.js','sweep-model.js','value-series.js','editor-shortcuts.js','node-readout-model.js','em-physics.js','em-playground-physics.js','em-playground-calculus.js','em-playground-interaction.js','em-playground-project.js','em-course-boundaries.js','em-course-coaxial.js','em-course-constants.js','em-course-electrostatics.js','em-course-induction.js','em-course-integrals.js','em-course-magnetostatics.js','em-course-registry.js','em-course-transmission.js','em-course-waves.js','em-format.js','em-contour.js','em-fieldlines.js','em-gauss.js','em-plane-geometry.js','em-plane-field.js','em-plane-modes.js','em-source-edit.js','em-readout.js','em-calculus.js','em-course-params.js','em-course-time.js','em-state.js','em-playground-state.js','em-interaction.js','em-current-field.js','em-ampere.js','em-current-force.js','em-current-lines.js','em-current-state.js','em-current-edit.js','em-current-presets.js','em-course-lecture.js','em-course-forces.js','em-course-materials.js','em-course-magnetic-circuit.js','em-course-magnetic-parallel.js','em-course-force-elements.js','ac-basis.js','em-course-inductance.js','em-course-virtual-work.js','selection-model.js','group-edit.js','clipboard-model.js','current-direction.js','port-analysis.js','analysis-worker-client.js','wire-current-model.js','id-allocator.js','signals-util.js','signals-course-model.js','signals-time-model.js','signals-convolution-model.js','signals-series-model.js','signals-transform-model.js','signals-roc-model.js','signals-sampling-model.js','signals-custom-input.js','signals-expression.js','signals-playback.js','signals-axis.js','signals-ops-model.js','signals-lti-model.js','signals-freq-model.js','circuit-course-model.js','circuit-course-complex.js','circuit-course-complex-expr.js','circuit-course-format.js','circuit-course-threephase.js','circuit-course-coupled.js','circuit-course-loads.js','circuit-course-maxpower.js','circuit-course-tool-common.js','circuit-course-tool-defs.js','circuit-course-tool-coupled.js','circuit-course-tools.js','circuit-course-figures.js','circuit-course-registry.js','circuit-course-nav.js','y-delta-complex-model.js']);
for(const file of files){
 const source=await readFile(resolve(root,'src',file),'utf8');
 const imports=[...source.matchAll(/\b(?:from\s*|import\s*)["'](\.[^"']+)["']/g)].map(match=>match[1]);
 graph.set(file,imports.map(path=>basename(path)));
 for(const path of imports)try{await access(resolve(root,'src',path));}catch{errors.push(`${file}: missing relative import ${path}`);}
 if(pure.has(file)&&/\b(?:window|document|localStorage|sessionStorage)\s*[.[]|\baddEventListener\s*\(/.test(source))errors.push(`${file}: browser dependency inside a pure model`);
 if(pure.has(file)&&imports.some(path=>/\/(?:app|scope-view|phasor-view|theme|trace-color)\.js$/.test(path)))errors.push(`${file}: model imports a view/controller`);
 if(file!=='app.js'&&imports.some(path=>/(?:^|\/)app\.js$/.test(path)))errors.push(`${file}: imports the app coordinator; pass dependencies from app.js instead`);
 if(['scope-view.js','phasor-view.js'].includes(file)&&imports.some(path=>path.includes('circuit-engine')))errors.push('scope-view.js: display imports solver');
 const lines=source.split(String.fromCharCode(10)),lineCount=lines.length;
 if(lineCount>800)warnings.push(`${file}: ${lineCount} lines; consider splitting a focused module out (warning threshold 800).`);
 const longLines=lines.filter(line=>line.length>MAX_LINE).length;
 if(longLines)warnings.push(`${file}: ${longLines} line(s) longer than ${MAX_LINE} characters (compressed one-liners hide structure from review; break them up).`);
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
