// One representative direct-answer path after the shared math-view integration.
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const repo=fileURLToPath(new URL('../../../../',import.meta.url));
let driver=await readFile(new URL('../../../../results/COMBINED-STUDENT-FLOW-2026-10-05/native-check.mjs',import.meta.url),'utf8');
driver=driver.replace("'em-ux-20261004.css','server.mjs'","'em-ux-20261004.css','server.mjs','src/signals-course-model.js','src/signals-course-controller.js','src/signals-visual.js','src/course-math-view.js'");
process.argv[2] ||= repo+'results/SIGNALS-VISUAL-2026-10-05/math-direct-1';
process.argv[5]=fileURLToPath(new URL('../',import.meta.url));
const scenario=String.raw`
 await navigate('/');await click('#signals-workspace-tab');await click('[data-signals-lesson="fourier"]');
 check('direct Fourier answer contains a structured fraction',await evaluate('Boolean(document.querySelector("[data-signals-answer] math mfrac"))'));
 check('direct answer keeps exact source',await evaluate('document.querySelector("[data-signals-answer] .course-math-original pre").textContent'),'X(ω)=A/(α+jω)');
 await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:false});
 await evaluate('document.querySelector("[data-signals-answer]").scrollIntoView({block:"start"})');await shot('signals-direct-math-390');
 check('direct math fits mobile page',await evaluate('document.documentElement.scrollWidth<=innerWidth'));
 report.status='PASS';
`;
const start=driver.indexOf(' const choose='),end=driver.indexOf('} catch(error)',start);
if(start<0||end<0)throw Error('Committed driver boundaries changed');
await import('data:text/javascript;base64,'+Buffer.from(driver.slice(0,start)+scenario+driver.slice(end)).toString('base64'));
