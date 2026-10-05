import {spawn} from 'node:child_process';
import {readFile,writeFile,mkdir,mkdtemp} from 'node:fs/promises';
import {createServer} from 'node:net';
import {createHash} from 'node:crypto';
import {resolve,join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const root=fileURLToPath(new URL('../',import.meta.url)),repo=resolve(root,'../../..'),out=resolve(process.argv[2]||join(repo,'results/EM-MATH-DISPLAY-2026-10-05/attempt-1'));
await mkdir(out,{recursive:true});
const existing=await readFile(join(repo,'scripts/capture-ui.mjs'),'utf8');
const helper=existing.slice(existing.indexOf('function wait(ms)'),existing.indexOf('const port = await availablePort();'));
const {wait,availablePort,connect}=new Function('createServer',helper+'\nreturn {wait,availablePort,connect};')(createServer);
const report={started:new Date().toISOString(),root,scope:'Actual HTTP application, isolated Edge, native Input selections; page-local clipboard adapter, desktop emulation only',checks:[],manifest:[],samples:[],errors:[]};
for(const name of ['src/course-math-view.js','src/course-symbolic-view.js','src/em-course-controller.js','src/signals-course-controller.js','src/circuit-course-view.js','tests/course-math-browser-2026-10-05.mjs']){const b=await readFile(join(root,name));report.manifest.push({name,sha256:createHash('sha256').update(b).digest('hex')});}
const check=(name,actual,expected=true)=>{const pass=JSON.stringify(actual)===JSON.stringify(expected);report.checks.push({name,actual,expected,pass});assert.ok(pass,name+' '+JSON.stringify(actual));};
const bounded=(p,label)=>Promise.race([p,new Promise((_,reject)=>{const timer=setTimeout(()=>reject(new Error('Timed out: '+label)),12000);timer.unref();})]);
let server,browser,cdp,serverLog='';
try{
  server=spawn(process.execPath,[join(root,'server.mjs'),'0'],{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe']});server.stdout.on('data',b=>serverLog+=b);server.stderr.on('data',b=>serverLog+=b);
  for(let n=0;n<70&&!/http:\/\/127\.0\.0\.1:\d+/.test(serverLog);n++)await wait(100);
  const base=serverLog.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];assert.ok(base,serverLog);report.base=base;
  const port=await availablePort(),profile=await mkdtemp(join(tmpdir(),'course-math-edge-'));
  browser=spawn('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',['--headless=new','--remote-debugging-port='+port,'--user-data-dir='+profile,'--no-first-run','--no-default-browser-check','--disable-background-networking','about:blank'],{windowsHide:true,stdio:'ignore'});
  let version;for(let n=0;n<60;n++){try{version=await fetch('http://127.0.0.1:'+port+'/json/version').then(r=>r.json());break;}catch{await wait(100);}}assert.ok(version);report.browser=version.Browser;
  const target=await fetch('http://127.0.0.1:'+port+'/json/new?about:blank',{method:'PUT'}).then(r=>r.json());cdp=await bounded(connect(target.webSocketDebuggerUrl),'connect');
  const send=(method,params={})=>bounded(cdp.send(method,params),method);
  const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw new Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
  await send('Page.enable');await send('Runtime.enable');await send('Emulation.setDeviceMetricsOverride',{width:1100,height:1000,deviceScaleFactor:1,mobile:false});const loaded=cdp.event('Page.loadEventFired');await send('Page.navigate',{url:base});await bounded(loaded,'load');await wait(700);
  check('actual app initialized',await evaluate('Boolean(window.__CIRCUIT_LAB__?.getEMState)'));
  await evaluate("window.mathErrors=[];window.addEventListener('error',e=>mathErrors.push(e.message));window.mathCopies=[];Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{mathCopies.push(text);}}});");
  const click=async selector=>{const b=await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw new Error('Missing target '+${JSON.stringify(selector)});e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();if(!r.width||!r.height)throw new Error('Invisible target '+${JSON.stringify(selector)});return{x:r.x+r.width/2,y:r.y+r.height/2};})()`);await send('Input.dispatchMouseEvent',{type:'mousePressed',...b,button:'left',buttons:1,clickCount:1});await send('Input.dispatchMouseEvent',{type:'mouseReleased',...b,button:'left',buttons:0,clickCount:1});await wait(60);};
  const key=async(k,code=k,virtual)=>{await send('Input.dispatchKeyEvent',{type:'keyDown',key:k,code,...(virtual?{windowsVirtualKeyCode:virtual}:{})});await send('Input.dispatchKeyEvent',{type:'keyUp',key:k,code,...(virtual?{windowsVirtualKeyCode:virtual}:{})});};
  const choose=async(selector,value)=>{const index=await evaluate(`Array.from(document.querySelector(${JSON.stringify(selector)}).options).findIndex(o=>o.value===${JSON.stringify(value)})`);assert.ok(index>=0,selector+' '+value);await click(selector);await key('Home','Home',36);for(let n=0;n<index;n++)await key('ArrowDown','ArrowDown',40);await key('Enter','Enter',13);await wait(100);};
  const open=async selector=>{if(!await evaluate(`document.querySelector(${JSON.stringify(selector)}).open`))await click(selector+' > summary');};
  const screenshot=async name=>{const shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await writeFile(join(out,name+'.png'),Buffer.from(shot.data,'base64'));};
  await click('[data-workspace-tab="em"]');await click('#em-course-open');
  const samples=process.argv.includes('--circuit-only')?[]:[['coax-current','정자계·암페어'],['loop-axis','정자계·암페어'],['layered-plate','유전체·경계'],['faraday-loop','자기유도'],['transmission-lossless','전송선']];
  for(const [id,topic] of samples){
    await open('#em-course-catalog');await choose('#em-course-topic',topic);await choose('#em-course-select',id);
    const structure=await evaluate("(()=>{const a=document.querySelector('#em-course-active-branch');return {math:a.querySelectorAll('math').length,fraction:a.querySelectorAll('mfrac').length,sub:a.querySelectorAll('msub,msubsup').length,power:a.querySelectorAll('msup,msubsup').length,source:Array.from(a.querySelectorAll('[data-math-source]'),n=>n.dataset.mathSource)};})()");
    report.samples.push({id,structure});check(id+' primary structured formula',structure.math>0);
    await open('#em-course-solution');check(id+' long derivation folded',await evaluate("!document.querySelector('#em-course-symbolic .course-derivation').open"));
    if(id==='coax-current')check('coax region active dataset preserved',await evaluate("document.querySelectorAll('#em-course-symbolic [data-symbolic-region-index][data-active=true]').length"),1);
    if(id==='layered-plate'){check('actual layered plate law has integral limits',await evaluate("document.querySelectorAll('#em-course-symbolic munderover').length>0"));await evaluate("document.querySelector('#em-course-symbolic munderover').scrollIntoView({block:'center'})");await screenshot('layered-integral');}
    if(id==='loop-axis'){await open('#em-course-symbolic .course-derivation');check('loop geometry root rendered',await evaluate("document.querySelectorAll('#em-course-symbolic .course-derivation msqrt').length>0"));}
    await click('#em-course-symbolic [data-symbolic-copy]');
    check(id+' exact canonical solution copy',await evaluate("(async()=>{const {symbolicText}=await import('/src/course-symbolic-view.js');const s=window.__CIRCUIT_LAB__.getEMState().course;const data=s.records[s.selectedId].symbolic;return mathCopies.at(-1)===symbolicText(data);})()"));
    for(const width of [1100,390]){await send('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:false});await wait(80);await evaluate("document.querySelector('#em-course-active-branch').scrollIntoView({block:'center'})");check(id+' no page overflow '+width,await evaluate('document.documentElement.scrollWidth<=innerWidth+1'));check(id+' math visible '+width,await evaluate("(()=>{const r=document.querySelector('#em-course-active-branch math').getBoundingClientRect();return r.width>0&&r.height>16;})()"));await screenshot(id+'-'+width);}
    await send('Emulation.setDeviceMetricsOverride',{width:1100,height:1000,deviceScaleFactor:1,mobile:false});
  }
  await click('[data-workspace-tab="signals"]');await click('[data-signals-lesson="convolution"]');check('Signals CT convolution numeric remains valid',await evaluate("window.__CIRCUIT_LAB__.getSignalsCourseState().numericStatus"),'valid');check('Signals convolution graph retained',await evaluate("document.querySelectorAll('[data-signals-projection] svg').length>=3"));await open('[data-signals-solution]');check('Signals common law MathML',await evaluate("document.querySelectorAll('[data-signals-solution] math').length>0"));await click('[data-signals-solution] [data-symbolic-copy]');check('Signals copy unchanged',await evaluate("(async()=>{const {symbolicText}=await import('/src/course-symbolic-view.js');return mathCopies.at(-1)===symbolicText(window.__CIRCUIT_LAB__.getSignalsCourseState().symbolic);})()"));
  await click('[data-workspace-tab="circuit"]');await click('#circuit-course-open');
  await click('[data-circuit-course-experiment="problem"]');await click('[data-circuit-course-apply]');
  check('AC primary answer structured',await evaluate("document.querySelectorAll('[data-circuit-course-answers] math').length>0"));
  check('AC primary fraction',await evaluate("document.querySelectorAll('[data-circuit-course-answers] mfrac').length>0"));
  check('AC explicit waveform math card',await evaluate("document.querySelectorAll('[data-circuit-course-results] .circuit-course-formula [data-math-source]').length>0"));
  check('AC theory math card',await evaluate("document.querySelectorAll('[data-circuit-course-theory] .course-math').length>0"));
  for(const width of [1100,390]){await send('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:false});await wait(80);await evaluate("document.querySelector('[data-circuit-course-answers]').scrollIntoView({block:'start'})");check('AC primary no page overflow '+width,await evaluate('document.documentElement.scrollWidth<=innerWidth+1'));await screenshot('AC-primary-'+width);}
  await open('[data-circuit-course-derivation]');check('AC common law MathML',await evaluate("document.querySelectorAll('[data-circuit-course-derivation] math').length>0"));await click('[data-circuit-course-derivation] [data-symbolic-copy]');check('AC copied exact original formulas',await evaluate("(async()=>{const {symbolicText}=await import('/src/course-symbolic-view.js');const r=window.__CIRCUIT_LAB__.getCircuitCourseState().result,s=r.solution;return mathCopies.at(-1)===symbolicText({...r.symbolicData,conditions:[...(s.statement?['문제 메모 (자동 해석하지 않음): '+s.statement]:[]),...r.symbolicData.conditions]});})()"));
  check('runtime errors',await evaluate('mathErrors'),[]);report.status='PASS';
}catch(error){report.status='FAIL';report.errors.push(error.stack);process.exitCode=1;}
finally{report.finished=new Date().toISOString();report.serverLog=serverLog;await writeFile(join(out,'report.json'),JSON.stringify(report,null,2));cdp?.close();browser?.kill();server?.kill();console.log(JSON.stringify({status:report.status,passed:report.checks.filter(c=>c.pass).length,total:report.checks.length,errors:report.errors,out},null,2));}
