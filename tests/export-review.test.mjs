import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, readdir, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
const script=fileURLToPath(new URL('../scripts/export-source.mjs',import.meta.url));
const hash=b=>createHash('sha256').update(b).digest('hex');
const record=(path,bytes=Buffer.from('hello\r\n'))=>({path,bytes:bytes.length,sha256:hash(bytes),encoding:'base64',data:bytes.toString('base64')});
const run=(...args)=>spawnSync(process.execPath,[script,...args],{encoding:'utf8',timeout:10000});
async function fixture(callback){const d=await mkdtemp(resolve(tmpdir(),'circuit-export-'));try{await callback(d);}finally{await rm(d,{recursive:true,force:true});}}
async function source(d,records){const file=resolve(d,'input.txt');await writeFile(file,'CIRCUIT-LAB-SOURCE-COPY v1\n---\n'+records.map(r=>JSON.stringify(r)).join('\n')+'\n');return file;}
test('EXPORT: text restore preserves BOM, CRLF and binary bytes exactly',()=>fixture(async d=>{
 const bytes=Buffer.from([239,187,191,97,13,10,0,255]);const file=await source(d,[record('src/a.bin',bytes)]);const r=run('restore-txt',file,resolve(d,'restored'));assert.equal(r.status,0,r.stderr);assert.deepEqual(await readFile(resolve(d,'restored/src/a.bin')),bytes);
}));
test('EXPORT: malformed final payload fails before any output is written',()=>fixture(async d=>{
 const file=await source(d,[record('first.js'),{...record('bad.js'),sha256:'0'.repeat(64)}]);const r=run('restore-txt',file,resolve(d,'restored'));assert.notEqual(r.status,0);assert.ok(!(await readdir(d)).includes('restored'));
}));
test('EXPORT: traversal, Windows ADS, devices and duplicate portable paths are rejected',()=>fixture(async d=>{
 for(const path of ['../escape.js','/absolute.js','C:\\escape.js','safe:stream','con.txt','sub/../escape.js']){
  const file=await source(d,[record(path)]);assert.notEqual(run('restore-txt',file,resolve(d,'restored')).status,0,path);
 }
 const file=await source(d,[record('a.js'),record('A.js')]);assert.notEqual(run('restore-txt',file,resolve(d,'restored')).status,0);
}));
test('EXPORT: restore refuses a nonempty directory without overwriting',()=>fixture(async d=>{
 const file=await source(d,[record('existing.js')]);const original=Buffer.from('keep');await writeFile(resolve(d,'existing.js'),original);
 assert.notEqual(run('restore-txt',file,d).status,0);assert.deepEqual(await readFile(resolve(d,'existing.js')),original);
}));
test('EXPORT: manifest cannot point outside its declared root',()=>fixture(async d=>{
 const manifest=resolve(d,'manifest.tsv');await writeFile(manifest,`path\tbytes\tsha256\n../escape.js\t7\t${'0'.repeat(64)}\n`);
 assert.notEqual(run('verify',d,manifest).status,0);
}));
test('EXPORT: repeated exports have identical ZIP and text hashes',()=>fixture(async d=>{
 const a=run('create',resolve(d,'a'));const b=run('create',resolve(d,'b'));assert.equal(a.status,0,a.stderr);assert.equal(b.status,0,b.stderr);
 const left=JSON.parse(a.stdout),right=JSON.parse(b.stdout);assert.equal(left.zip.sha256,right.zip.sha256);assert.equal(left.text.sha256,right.text.sha256);
}));
