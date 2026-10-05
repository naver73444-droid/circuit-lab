import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdir, mkdtemp } from 'node:fs/promises';
import { createServer } from 'node:net';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
const root = fileURLToPath(new URL('../', import.meta.url));
const repo = resolve(root, '../../..'), out = resolve(process.argv[2]);
await mkdir(out, { recursive: true });
const existing = await readFile(join(repo, 'scripts/capture-ui.mjs'), 'utf8');
const helperCode = existing.slice(existing.indexOf('function wait(ms)'), existing.indexOf('const port = await availablePort();'));
const { wait, availablePort, connect } = new Function('createServer', helperCode + '\nreturn {wait,availablePort,connect};')(createServer);
const report = { started: new Date().toISOString(), scope: 'Native Edge, normal integrated app course entry, typed symbolic/numeric problem conditions, apply and EM tab return; no host injection.', checks: [], errors: [], manifest: [] };
for (const name of ['src/circuit-course-model.js', 'src/circuit-course-registry.js', 'src/circuit-course-view.js', 'src/circuit-course-controller.js', 'src/circuit-course-problem.js','src/circuit-course-problem-symbolic.js','src/course-symbolic-view.js','tests/circuit-course-problem.test.mjs','tests/circuit-course-symbolic.test.mjs','tests/circuit-course-problem-browser.mjs','index.html','src/app.js']) {
  const b = await readFile(join(root, name)); report.manifest.push({ name, sha256: createHash('sha256').update(b).digest('hex') });
}
let server, browser, cdp, serverLog = '';
const check = (name, actual, expected = true) => { const pass = JSON.stringify(actual) === JSON.stringify(expected); report.checks.push({ name, actual, expected, pass }); assert.ok(pass, name); };
const bounded = (p, label) => Promise.race([p, new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error('Timed out: ' + label)), 8000); timer.unref(); })]);
try {
  server = spawn(process.execPath, [join(root, 'server.mjs'), '0'], { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  server.stdout.on('data', b => serverLog += b); server.stderr.on('data', b => serverLog += b);
  for (let n = 0; n < 50 && !/http:\/\/127\.0\.0\.1:\d+/.test(serverLog); n++) await wait(100);
  const base = serverLog.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0]; assert.ok(base, serverLog); report.base = base;
  const port = await availablePort(), profile = await mkdtemp(join(out, 'edge-profile-'));
  browser = spawn('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', ['--headless=new', '--remote-debugging-port=' + port, '--user-data-dir=' + profile, '--no-first-run', '--no-default-browser-check', '--disable-background-networking', 'about:blank'], { windowsHide: true, stdio: 'ignore' });
  let version;
  for (let n = 0; n < 50; n++) { try { version = await fetch('http://127.0.0.1:' + port + '/json/version').then(r => r.json()); break; } catch { await wait(100); } }
  assert.ok(version, 'Existing Edge did not start'); report.browser = version.Browser;
  const target = await fetch('http://127.0.0.1:' + port + '/json/new?about:blank', { method: 'PUT' }).then(r => r.json());
  cdp = await bounded(connect(target.webSocketDebuggerUrl), 'CDP connect');
  const send = (method, params = {}) => bounded(cdp.send(method, params), method);
  const evaluate = async expression => { const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails)); return r.result.value; };
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  const loaded = cdp.event('Page.loadEventFired'); await send('Page.navigate', { url: base }); await bounded(loaded, 'load');
  await wait(300);
  check('HTTP origin', await evaluate('location.origin'), base);
  for (const name of ['model', 'registry', 'view', 'controller']) check('module route ' + name, await fetch(base + '/src/circuit-course-' + name + '.js').then(r => r.status), 200);
  for(let n=0;n<50;n++){if(await evaluate('Boolean(window.__CIRCUIT_LAB__?.getCircuitCourseState)'))break;await wait(100);}
  check('actual integrated app initialized',await evaluate('Boolean(window.__CIRCUIT_LAB__?.getCircuitCourseState)'));
  const snap=()=>evaluate('window.__CIRCUIT_LAB__.getCircuitCourseState()');
  const click=async selector=>{
    const b=await evaluate("(()=>{const e=document.querySelector("+JSON.stringify(selector)+");if(!e)throw new Error('missing target');e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();if(!r.width||!r.height)throw new Error('invisible target');return{x:r.x+r.width/2,y:r.y+r.height/2}})()");
    await send('Input.dispatchMouseEvent',{type:'mousePressed',...b,button:'left',buttons:1,clickCount:1});
    await send('Input.dispatchMouseEvent',{type:'mouseReleased',...b,button:'left',buttons:0,clickCount:1});
  };
  const type=async(key,text)=>{
    await click('#circuit-course-host [data-circuit-course-key="'+key+'"]');
    await send('Input.dispatchKeyEvent',{type:'keyDown',key:'a',code:'KeyA',windowsVirtualKeyCode:65,modifiers:2});
    await send('Input.dispatchKeyEvent',{type:'keyUp',key:'a',code:'KeyA',windowsVirtualKeyCode:65,modifiers:2});
    if(text)await send('Input.insertText',{text});else await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Backspace',code:'Backspace',windowsVirtualKeyCode:8});
  };
  const select=async(key,value)=>evaluate("(()=>{const e=document.querySelector('#circuit-course-host [data-circuit-course-key="+JSON.stringify(key)+"]');e.value="+JSON.stringify(value)+";e.dispatchEvent(new Event('input',{bubbles:true}));})()");
  const apply=()=>click('#circuit-course-host [data-circuit-course-apply]');
  await click('#circuit-course-open');
  check('normal AC entry active',(await snap()).active);
  check('default phasor symbolic',(await snap()).result.symbolic);
  check('phasor shared renderer',await evaluate("Boolean(document.querySelector('#circuit-course-host .course-symbolic .course-symbolic-answer'))"));
  for(const id of['impedance','power','three-phase','correction','problem']){
    await click('[data-circuit-course-experiment="'+id+'"]');
    check(id+' symbolic by default',(await snap()).result.symbolic);
    check(id+' shared renderer',await evaluate("Boolean(document.querySelector('#circuit-course-host .course-symbolic .course-symbolic-answer'))"));
    check(id+' has displayed derivation',await evaluate("Boolean(document.querySelector('#circuit-course-host [data-circuit-course-solution] ol li'))"));
  }
  await type('symbolR','R1');await type('symbolL','L_a');await type('symbolVoltage','V_s');
  await apply();
  check('native symbol rename in answer',(await snap()).result.solution.answers[0].text.includes('R1')&&(await snap()).result.solution.answers[0].text.includes('L_a'));
  check('symbolic mode has no fake numeric wave',(await snap()).result.traces.length,0);
  check('symbolic answer no 100V preset',(await snap()).result.solution.givens.some(v=>v.includes('100 V')),false);
  await type('symbolR','R+jX');await apply();
  check('arbitrary symbolic expression rejected',(await snap()).result.status,'invalid');
  check('invalid symbol raw draft retained',(await snap()).drafts.symbolR,'R+jX');
  await type('symbolR','R1');await apply();
  await select('elements','C');await select('singleGoal','pf');await apply();
  check('pure C symbolic phase',(await snap()).result.solution.canonical.phi,'−π/2');
  check('pure C symbolic PF0',(await snap()).result.solution.canonical.pf,'0');
  await select('elements','RL');await select('singleGoal','current');
  await select('solutionMode','numeric');await apply();
  check('blank numeric conditions rejected',(await snap()).result.status,'invalid');
  await type('voltage','100 V');await type('frequencyHz','314.1592653589793 rad/s');
  await type('r','3 Ω');await type('l','12.732395447351627 mH');await type('problemText','수동 입력 검산: 전류를 구하라. 기호식에서 수치를 대입함.');
  await apply();
  check('typed angular frequency converted',(await snap()).params.frequencyHz,50);
  check('typed manual RL current',Math.round((await snap()).result.I.im),-16);
  check('requested numeric current20A',Math.round((await snap()).result.solution.answers[0].value),20);
  check('actual DOM substitutions visible',await evaluate("document.querySelector('#circuit-course-host [data-circuit-course-solution]').textContent.includes('대입:')"));
  check('numeric plots shared symbolic companion',await evaluate("Boolean(document.querySelector('#circuit-course-host [data-circuit-course-symbolic-companion] .course-symbolic-answer'))"));
  check('unit-aware result graphs exist',await evaluate('document.querySelectorAll("#circuit-course-host svg").length>3'));
  for(const width of [1440,390]){
    await send('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:false});
    const layout=await evaluate("(()=>{const e=document.getElementById('circuit-course-host');return{client:e.clientWidth,scroll:e.scrollWidth}})()");
    check('numeric graphs and shared derivation fit '+width,layout.scroll<=layout.client+1);
    await evaluate("document.querySelector('#circuit-course-host .circuit-course-graphs').scrollIntoView({block:'start'})");
    await writeFile(join(out,'numeric-companion-'+width+'.png'),Buffer.from((await send('Page.captureScreenshot',{format:'png',fromSurface:true,captureBeyondViewport:false})).data,'base64'));
  }
  await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
  check('independent intermediate checks',(await snap()).result.checks.every(c=>c.pass));
  await type('r','3 V');await apply();
  check('incompatible unit rejected',(await snap()).result.status,'invalid');
  check('invalid numeric answer removed',await evaluate('document.querySelectorAll("#circuit-course-host [data-circuit-course-solution]").length'),0);
  await type('r','3 Ω');await apply();
  await select('basis','peak');await type('voltage','141.4213562373095 V');await apply();
  check('peak current still20A',Math.round((await snap()).result.solution.answers[0].value),20);
  check('peak RMS conversion explained',(await snap()).result.solution.steps[0].formula,'V_RMS=V_peak/√2');
  await select('problemKind','three');await select('basis','rms');await select('threeGoal','power');
  await type('voltage','400 V');await type('sourceAngle','30 deg');await type('r','8Ω');await type('x','6Ω');await type('frequencyHz','');
  await apply();
  check('frequency-free 3phase typed P',Math.round((await snap()).result.power.pWatts),12800);
  check('frequency-free wave not invented',(await snap()).result.traces.length,0);
  check('three phase source angle recognized',Math.round((await snap()).result.phaseVoltages[0].im),0);
  await select('solutionMode','symbolic');await select('threeGoal','line-current');await type('symbolZ','Z_p');await apply();
  check('typed 3phase symbol answer',(await snap()).result.solution.answers[0].text.includes('Z_p'));
  check('3phase symbolic 30° relation',(await snap()).result.solution.canonical.Van.includes('e^(−jπ/6)'));
  const before=await snap();
  await click('[data-workspace-tab="em"]');check('course suspended on EM',(await snap()).active,false);
  await click('[data-workspace-tab="circuit"]');check('course restored after EM',(await snap()).active);
  check('typed worksheet retained after tabs',(await snap()).drafts,before.drafts);
  for(const width of[1440,900,390]){
    await send('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:false});
    await evaluate("document.getElementById('circuit-course-shell').scrollTop=0");
    const layout=await evaluate("(()=>{const e=document.getElementById('circuit-course-host');return{client:e.clientWidth,scroll:e.scrollWidth}})()");
    check('actual host no horizontal overflow '+width,layout.scroll<=layout.client+1);
    await evaluate("document.querySelector('#circuit-course-host [data-circuit-course-solution]').scrollIntoView({block:'start'})");
    await writeFile(join(out,'symbolic-problem-'+width+'.png'),Buffer.from((await send('Page.captureScreenshot',{format:'png',fromSurface:true,captureBeyondViewport:false})).data,'base64'));
  }
  await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
  await click('#circuit-course-back');check('normal back deactivates',(await snap()).active,false);
  await click('#circuit-course-open');check('normal reentry retains problem',(await snap()).experimentId,'problem');

} catch (error) {
  report.errors.push(String(error.stack || error)); process.exitCode = 1;
} finally {
  cdp?.close(); browser?.kill(); server?.kill();
  for(const entry of report.manifest){const bytes=await readFile(join(root,entry.name));entry.sha256End=createHash('sha256').update(bytes).digest('hex');entry.stableDuringRun=entry.sha256===entry.sha256End;}
  report.finished = new Date().toISOString(); report.passed = report.checks.filter(c => c.pass).length; report.failed = report.checks.filter(c => !c.pass).length;
  await writeFile(join(out, 'browser-report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ passed: report.passed, failed: report.failed, errors: report.errors, out }, null, 2));
}
