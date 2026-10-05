import {spawn} from 'node:child_process';
import {readFile,writeFile,mkdir,mkdtemp} from 'node:fs/promises';
import {createServer} from 'node:net';
import {createHash} from 'node:crypto';
import {resolve,join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const root=fileURLToPath(new URL('../',import.meta.url)),repo=resolve(root,'../../..'),before=process.argv.includes('--before'),out=join(repo,'results/EM-COURSE-RETURN-2026-10-05',before?'before':'after');
await mkdir(out,{recursive:true});
const transport=await readFile(join(repo,'scripts/capture-ui.mjs'),'utf8'),helper=transport.slice(transport.indexOf('function wait(ms)'),transport.indexOf('const port = await availablePort();'));
const {wait,availablePort,connect}=new Function('createServer',helper+'\nreturn {wait,availablePort,connect};')(createServer);
const report={mode:before?'baseline':'after',started:new Date().toISOString(),checks:[],manifest:[],errors:[]};
for(const file of ['src/em-course-controller.js','src/em-controller.js','index.html','tests/em-course-return-browser-2026-10-05.mjs'])report.manifest.push({file,sha256:createHash('sha256').update(await readFile(join(root,file))).digest('hex')});
const check=(name,actual,expected=true)=>{const pass=JSON.stringify(actual)===JSON.stringify(expected);report.checks.push({name,pass,actual,expected});assert.ok(pass,name+' '+JSON.stringify(actual));};
const bounded=(p,label)=>Promise.race([p,new Promise((_,reject)=>{const t=setTimeout(()=>reject(new Error('Timeout '+label)),10000);t.unref();})]);
let server,browser,cdp,log='';
try{
  server=spawn(process.execPath,[join(root,'server.mjs'),'0'],{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe']});server.stdout.on('data',b=>log+=b);server.stderr.on('data',b=>log+=b);
  for(let i=0;i<60&&!/http:\/\/127\.0\.0\.1:\d+/.test(log);i++)await wait(100);const base=log.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];assert.ok(base);report.base=base;
  const port=await availablePort(),profile=await mkdtemp(join(tmpdir(),'em-return-edge-'));browser=spawn('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',['--headless=new','--remote-debugging-port='+port,'--user-data-dir='+profile,'--no-first-run','--no-default-browser-check','--disable-background-networking','about:blank'],{windowsHide:true,stdio:'ignore'});
  for(let i=0;i<60;i++){try{report.browser=await fetch('http://127.0.0.1:'+port+'/json/version').then(r=>r.json());break;}catch{await wait(100);}}assert.ok(report.browser);
  const target=await fetch('http://127.0.0.1:'+port+'/json/new?about:blank',{method:'PUT'}).then(r=>r.json());cdp=await bounded(connect(target.webSocketDebuggerUrl),'connect');
  const send=(method,params={})=>bounded(cdp.send(method,params),method),evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw new Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
  const ensureWs=async name=>{const getter={em:'getEMState',signals:'getSignalsCourseState','circuit-course':'getCircuitCourseState'}[name];try{await evaluate('window.__CIRCUIT_LAB__.ensureWorkspace('+JSON.stringify(name)+').then(()=>true)');}catch{}for(let n=0;n<80&&(await evaluate('window.__CIRCUIT_LAB__.'+getter+'()'))===null;n++)await new Promise(r=>setTimeout(r,100));};const ensureEMCourse=async()=>{for(let n=0;n<80&&(await evaluate('window.__CIRCUIT_LAB__.getEMState()?.course??null'))===null;n++)await new Promise(r=>setTimeout(r,100));};
  await send('Page.enable');await send('Runtime.enable');
  const click=async selector=>{const b=await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw new Error('Missing '+${JSON.stringify(selector)});e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();if(!r.width||!r.height||!e.getClientRects().length)throw new Error('Hidden '+${JSON.stringify(selector)});return{x:r.x+r.width/2,y:r.y+r.height/2};})()`);await send('Input.dispatchMouseEvent',{type:'mousePressed',...b,button:'left',buttons:1,clickCount:1});await send('Input.dispatchMouseEvent',{type:'mouseReleased',...b,button:'left',buttons:0,clickCount:1});await wait(50);};
  const key=async(k,code=k,virtual,modifiers=0)=>{for(const type of ['keyDown','keyUp'])await send('Input.dispatchKeyEvent',{type,key:k,code,modifiers,...(virtual?{windowsVirtualKeyCode:virtual}:{})});};
  const type=async(selector,text)=>{await click(selector);await key('a','KeyA',65,2);await send('Input.insertText',{text});};
  const choose=async(selector,value)=>{const i=await evaluate(`Array.from(document.querySelector(${JSON.stringify(selector)}).options).findIndex(o=>o.value===${JSON.stringify(value)})`);assert.ok(i>=0);await click(selector);await key('Home','Home',36);for(let n=0;n<i;n++)await key('ArrowDown','ArrowDown',40);await key('Enter','Enter',13);await wait(70);};
  const open=async selector=>{if(!await evaluate(`document.querySelector(${JSON.stringify(selector)}).open`))await click(selector+' > summary');};
  const visible=selector=>evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)}),r=e.getBoundingClientRect();return !!e.getClientRects().length&&r.width>0&&r.height>0&&r.top>=90&&r.bottom<=innerHeight&&document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)===e;})()`);
  const screenshot=async name=>{const s=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await writeFile(join(out,name+'.png'),Buffer.from(s.data,'base64'));};
  for(const width of [1100,390]){
    await send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false});const load=cdp.event('Page.loadEventFired');await send('Page.navigate',{url:base});await bounded(load,'load');await wait(500);
    await click('[data-workspace-tab="em"]');await ensureWs('em');const freeBefore=await evaluate("JSON.stringify(window.__CIRCUIT_LAB__.getEMState().playground.sources)");
    if(!before){await click('[data-em-source-select]');await type('[data-em-pg-draft="q"]','7.25');}
    await click('#em-course-open');await ensureWs('em');await ensureEMCourse();check('entered course '+width,await evaluate('window.__CIRCUIT_LAB__.getEMState().courseActive'));
    if(before){
      await evaluate("document.querySelector('#em-course-root').scrollTop=0");
      check('baseline back inside closed catalog '+width,await evaluate("document.querySelector('#em-course-back').closest('details')?.open===false"));
      check('baseline back invisible at top '+width,await visible('#em-course-back'),false);await screenshot('hidden-return-'+width);
      await open('#em-course-catalog');await click('#em-course-back');check('existing callback works once discovered '+width,await evaluate('window.__CIRCUIT_LAB__.getEMState().courseActive'),false);continue;
    }
    check('return exposed outside details '+width,await evaluate("!document.querySelector('#em-course-back').closest('details')"));
    check('return visible on entry '+width,await visible('#em-course-back'));
    await click('#em-course-list');check('list button opens catalog '+width,await evaluate("document.querySelector('#em-course-catalog').open"));
    await choose('#em-course-select','loop-axis');check('native list switches example '+width,await evaluate('window.__CIRCUIT_LAB__.getEMState().course.selectedId'),'loop-axis');
    await open('#em-course-advanced');await open('#em-course-illustration');await type('[data-em-course-parameter="current"]','3.5');
    const resultBefore=await evaluate("JSON.stringify(window.__CIRCUIT_LAB__.getEMState().course.records['loop-axis'].result)");
    await evaluate("const p=document.querySelector('#em-course-root');p.scrollTop=p.scrollHeight");await wait(70);
    check('return remains visible after long scroll '+width,await visible('#em-course-back'));check('list remains visible after long scroll '+width,await visible('#em-course-list'));await screenshot('visible-return-'+width);
    await click('#em-course-back');check('returned to free lab '+width,await evaluate('window.__CIRCUIT_LAB__.getEMState().courseActive'),false);
    check('free lab sources unchanged '+width,await evaluate("JSON.stringify(window.__CIRCUIT_LAB__.getEMState().playground.sources)"),freeBefore);
    check('free lab draft unchanged '+width,await evaluate("window.__CIRCUIT_LAB__.getEMState().playground.draft.q"),'7.25');
    await click('#em-course-open');await ensureWs('em');await ensureEMCourse();check('reentry keeps selected example '+width,await evaluate('window.__CIRCUIT_LAB__.getEMState().course.selectedId'),'loop-axis');
    check('example draft preserved '+width,await evaluate("window.__CIRCUIT_LAB__.getEMState().course.records['loop-axis'].drafts.params.current"),'3.5');
    check('draft not silently applied '+width,await evaluate("JSON.stringify(window.__CIRCUIT_LAB__.getEMState().course.records['loop-axis'].result)"),resultBefore);
    check('no page overflow '+width,await evaluate('document.documentElement.scrollWidth<=innerWidth+1'));
  }
  report.status='PASS';
}catch(error){report.status='FAIL';report.errors.push(error.stack);process.exitCode=1;}
finally{report.finished=new Date().toISOString();report.serverLog=log;await writeFile(join(out,'report.json'),JSON.stringify(report,null,2));cdp?.close();browser?.kill();server?.kill();console.log(JSON.stringify({status:report.status,passed:report.checks.filter(c=>c.pass).length,total:report.checks.length,errors:report.errors,out},null,2));}
