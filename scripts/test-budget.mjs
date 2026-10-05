/** Run real Node tests with a small stdout summary; raw TAP remains on disk.
 * This does NOT mask failures or mark historical failures as passing.
 * Usage: node scripts/test-budget.mjs ui|core|all [--out <directory>]
 */
import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const profile=process.argv[2]||'ui';
if(!['ui','core','all'].includes(profile)) { console.error('Profile must be ui, core or all.');process.exit(2); }
const remaining=process.argv.slice(3);
if(remaining.length && (remaining[0]!=='--out'||remaining.length!==2)) { console.error('Use --out <directory>.');process.exit(2); }
const out=resolve(root,remaining[1]||`.verification/${new Date().toISOString().replace(/[:.]/g,'-')}-${profile}`);
await mkdir(out,{recursive:true});
const allFiles=(await readdir(resolve(root,'tests'))).filter(f=>f.endsWith('.test.mjs')).sort();
const selected=profile==='all'?allFiles:profile==='ui'?
  allFiles.filter(f=>['review-ui-0920-interaction.test.mjs','pointer-session.test.mjs','workspace-0922.test.mjs','phasor-practice-0922.test.mjs'].includes(f)):
  allFiles.filter(f=>f==='engine.test.mjs'||/^circuit-01[4568].*\.test\.mjs$/.test(f));
if(!selected.length) { console.error('No tests match this profile.');process.exit(2); }
const files=selected.map(f=>`tests/${f}`),args=['--test','--test-reporter=tap',...files];
const sourceFiles=['index.html','styles.css','server.mjs','package.json',
  ...(await readdir(resolve(root,'src'))).filter(f=>f.endsWith('.js')).sort().map(f=>`src/${f}`),...files,'scripts/test-budget.mjs'];
const digest=createHash('sha256');
for(const path of sourceFiles) {digest.update(path+'\0');digest.update(await readFile(resolve(root,path)));digest.update('\0');}
const summary={profile,node:process.version,platform:process.platform,arch:process.arch,
  startedAt:new Date().toISOString(),sourceAndSelectedTestsSha256:digest.digest('hex'),
  command:[process.execPath,...args],files,counts:{},failures:[],rawTap:relative(root,resolve(out,'raw.tap')),stderr:relative(root,resolve(out,'stderr.txt'))};
const raw=createWriteStream(resolve(out,'raw.tap'));
const err=createWriteStream(resolve(out,'stderr.txt'));
const run=spawn(process.execPath,args,{cwd:root,stdio:['ignore','pipe','pipe']});
let lineBuffer='';
function line(value){
  const count=value.match(/^# (tests|suites|pass|fail|cancelled|skipped|todo|duration_ms)\s+([\d.]+)/);
  if(count)summary.counts[count[1]]=Number(count[2]);
  const failure=value.match(/^\s*not ok \d+ - (.*)/);
  if(failure)summary.failures.push(failure[1].slice(0,250));
}
run.stdout.on('data',chunk=>{
  if(!raw.write(chunk)){run.stdout.pause();raw.once('drain',()=>run.stdout.resume());}
  lineBuffer+=chunk.toString('utf8');
  let i;while((i=lineBuffer.indexOf('\n'))>=0){line(lineBuffer.slice(0,i));lineBuffer=lineBuffer.slice(i+1);}
  // A huge failure diagnostic still goes to raw.tap, not into the summary parser.
  if(lineBuffer.length>65536)lineBuffer=lineBuffer.slice(-1024);
});
run.stderr.on('data',chunk=>{if(!err.write(chunk)){run.stderr.pause();err.once('drain',()=>run.stderr.resume());}});
run.on('error',error=>{summary.runnerError=error.message;});
const result=await new Promise(res=>run.on('close',(code,signal)=>res({code,signal})));
line(lineBuffer);
await Promise.all([new Promise(res=>raw.end(res)),new Promise(res=>err.end(res))]);
summary.exitCode=result.code??1;summary.signal=result.signal;summary.finishedAt=new Date().toISOString();
await writeFile(resolve(out,'summary.json'),JSON.stringify(summary,null,2)+'\n');
console.log(JSON.stringify({profile:summary.profile,counts:summary.counts,exitCode:summary.exitCode,
  failures:summary.failures,sourceAndSelectedTestsSha256:summary.sourceAndSelectedTestsSha256,
  report:relative(root,resolve(out,'summary.json')),rawTap:summary.rawTap},null,2));
process.exitCode=summary.exitCode;
