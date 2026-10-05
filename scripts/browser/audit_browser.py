"""Focused audit regression. Uses the documented transport-only offline harness by default.
Pass --base-url on the user's own PC for real HTTP validation. Never treats offline as HTTP.
"""
from browser_harness import *
import argparse, traceback, math, time
parser=argparse.ArgumentParser()
parser.add_argument('--root',type=Path,default=Path(__file__).resolve().parents[2])
parser.add_argument('--output',type=Path,required=True)
parser.add_argument('--before-limited',action='store_true')
parser.add_argument('--base-url')
args=parser.parse_args(); ROOT=args.root.resolve(); OUT=args.output; OUT.mkdir(parents=True,exist_ok=True)
if args.base_url: os.environ['CIRCUIT_LAB_BASE_URL']=args.base_url
results=[]
def state(p): return p.evaluate('()=>__CIRCUIT_LAB__.getState()')
def example(p,name='rc-charge'):
 p.locator('#example-select').select_option(name)
 p.wait_for_function("__CIRCUIT_LAB__.getState().runState.status==='success'")
def point(p,selector,x,y):return p.locator(selector).evaluate('(e,q)=>{const p=new DOMPoint(q.x,q.y).matrixTransform(e.getScreenCTM());return {x:p.x,y:p.y}}',{'x':x,'y':y})
def component(p,id):
 q=point(p,f'.component[data-id="{id}"]',0,0);p.mouse.click(q['x'],q['y'])
def project(p):
 s=state(p);return {'format':'circuit-lab','version':1,'title':'Audit fixture','circuit':s['circuit'],'settings':s['settings'],'probes':s['probes']}
def upload(p,pr):
 p.locator('#file-input').set_input_files({'name':'audit.json','mimeType':'application/json','buffer':json.dumps(pr).encode()})
 p.wait_for_timeout(70)
def plotpoint(p,xf=.5,yf=.5):
 g=state(p)['scope']['geometry'];return point(p,'#wave-plot',g['left']+xf*g['plotWidth'],g['top']+yf*g['plotHeight'])
def run(p):
 p.locator('#run-button').click();p.wait_for_function("__CIRCUIT_LAB__.getState().runState.status==='success'")
def physical(s):return {k:s[k] for k in ['circuit','settings','probes','result']}
def case(name,fn,width=1440,height=900):
 ctx,p,errors=load_app(browser,ROOT,width,height)
 try:
  details=fn(p) or {};assert not errors,errors
  results.append({'name':name,'status':'PASS','details':details,'pageErrors':errors})
 except Exception as e:
  results.append({'name':name,'status':'FAIL','error':str(e),'trace':traceback.format_exc(),'pageErrors':errors})
  p.screenshot(path=str(OUT/f'failure-{len(results):02}.png'))
 finally:ctx.close()
def hidden_draft(p):
 example(p,'divider');p.locator('#auto-update').uncheck();component(p,'R1')
 p.locator('[data-prop="value"]').fill('banana');component(p,'R2')
 p.locator('#run-button').click();p.wait_for_timeout(300)
 assert state(p)['runState']['status']!='success','invalid hidden R1 draft was lost and old values were reported as success'
 assert p.locator('[data-prop="value"]').input_value()=='banana'
 assert p.locator('#csv-button').is_disabled()
 return {'hiddenDraft':'banana','runBlocked':True}
def probe_history(p):
 example(p);before=state(p)['probes'];p.locator('#auto-update').uncheck()
 p.locator('[data-remove-probe]').first.click();assert len(state(p)['probes'])==len(before)-1
 p.locator('#undo-button').click();assert state(p)['probes']==before,'undo reverted the example instead of restoring one probe'
 return {'restoredProbeCount':len(before)}
def native_split(p):
 example(p);p.locator('#auto-update').uncheck();n=len(state(p)['circuit']['junctions'])
 path=p.locator('[data-wire-id="W2"] .wire-hit')
 q=path.evaluate('(e)=>{let q=e.getPointAtLength(e.getTotalLength()*.5);let p=new DOMPoint(q.x,q.y).matrixTransform(e.getScreenCTM());return {x:p.x,y:p.y}}')
 p.mouse.dblclick(q['x'],q['y'],delay=70)
 assert len(state(p)['circuit']['junctions'])==n+1,'native dblclick did not split wire'
 return {'junctions':len(state(p)['circuit']['junctions'])}
def theme(p):
 example(p);before=physical(state(p));assert p.locator('html').get_attribute('data-theme')=='dark'
 p.locator('#appearance').select_option('light');p.wait_for_timeout(70)
 assert p.locator('html').get_attribute('data-theme')=='light';assert physical(state(p))==before
 p.screenshot(path=str(OUT/'light-1440.png'))
 p.locator('#appearance').select_option('dark');p.wait_for_timeout(70);assert physical(state(p))==before
 p.screenshot(path=str(OUT/'dark-1440.png'))
 return {'themeSwitchPreservesCircuitSettingsProbesAndResults':True}
def system_theme(p):
 p.emulate_media(color_scheme='light');p.locator('#appearance').select_option('system');assert p.locator('html').get_attribute('data-theme')=='light'
 p.emulate_media(color_scheme='dark');p.wait_for_timeout(30);assert p.locator('html').get_attribute('data-theme')=='dark'
 return {'emulatedSystemTheme':True,'storagePersistence':'not exercised on opaque offline origin'}
def cancel_navigation(p):
 example(p);p.locator('#auto-update').uncheck();component(p,'R1');p.locator('[data-prop="value"]').fill('1e')
 before=state(p)['circuit'];dialogs=[]
 def dismiss(d): dialogs.append(d.message);d.dismiss()
 p.on('dialog',dismiss);p.locator('#new-button').click();assert state(p)['circuit']==before
 assert p.locator('[data-prop="value"]').input_value()=='1e';assert len(dialogs)==1
 p.remove_listener('dialog',dismiss);p.locator('#discard-drafts-button').click();assert state(p)['drafts']==[]
 return {'newCircuitCancelled':True,'draftDiscardExplicit':True}
def hidden_save(p):
 example(p,'divider');p.locator('#auto-update').uncheck();component(p,'R1');p.locator('[data-prop="value"]').fill('banana');component(p,'R2')
 downloads=[];p.on('download',lambda d:downloads.append(d.suggested_filename));p.locator('#save-button').click();p.wait_for_timeout(120)
 assert downloads==[];assert '입력 오류' in p.locator('#engine-status').inner_text()
 return {'downloads':0}
def inline_bad_save(p):
 example(p);p.locator('#auto-update').uncheck();p.locator('[data-id="R1"] .value-label').dblclick()
 p.locator('#inline-value-editor').fill('1e309');downloads=[];p.on('download',lambda d:downloads.append(d.suggested_filename))
 p.locator('#save-button').click();p.wait_for_timeout(90);assert not downloads;assert p.locator('#csv-button').is_disabled()
 return {'nonfiniteInlineBlocked':True}
def manual_ac(p):
 example(p,'rc-lowpass');p.locator('#auto-update').uncheck();p.locator('#advanced-analysis > summary').click()
 for field,value in [('startFrequency','37'),('endFrequency','7300'),('pointsPerDecade','17'),('phasorFrequency','731')]:
  p.locator(f'[data-setting="{field}"]').fill(value);p.locator(f'[data-setting="{field}"]').press('Enter')
 run(p);s=state(p);assert s['result']['xValues'][0]==37;assert s['result']['xValues'][-1]==7300;assert s['phasorResult']['frequency']==731
 assert s['intent']=='manual'
 return {'sweepStart':37,'sweepEnd':7300,'phasorFrequency':731}
def modified_wheel(p):
 example(p);before=physical(state(p));s=state(p)['scope'];q=plotpoint(p);p.mouse.move(q['x'],q['y'])
 p.keyboard.down('Shift');p.mouse.wheel(0,120);p.keyboard.up('Shift');p.wait_for_timeout(80)
 a=state(p)['scope'];assert a['axes']['V']['division']>s['axes']['V']['division'];assert a['axes']['A']==s['axes']['A'];assert a['x']==s['x']
 p.keyboard.down('Alt');p.mouse.wheel(0,-120);p.keyboard.up('Alt');p.wait_for_timeout(80)
 b=state(p)['scope'];assert b['axes']['A']['division']<a['axes']['A']['division'];assert b['axes']['V']==a['axes']['V'];assert physical(state(p))==before
 return {'shiftVoltageOnly':True,'altCurrentOnly':True,'rawUnchanged':True}
def zero_ac(p):
 example(p,'rc-lowpass');p.locator('#auto-update').uncheck();component(p,'V1');p.locator('[data-prop="acMagnitude"]').fill('0');p.locator('[data-prop="acMagnitude"]').press('Enter');run(p)
 assert p.locator('#scope-zero-note').is_visible()
 p.locator('[data-ac-view="phase"]').click();q=plotpoint(p,.2,.5);p.mouse.move(q['x'],q['y']);p.wait_for_timeout(40)
 assert '미정' in p.locator('#cursor-readout').inner_text()
 with p.expect_download() as d:p.locator('#csv-button').click()
 text=Path(d.value.path()).read_text();assert '-Infinity,' in text
 p.screenshot(path=str(OUT/'zero-ac.png'))
 return {'zeroPhase':'미정','csvContains':'-Infinity,','noFabricatedFloor':True}
def negative_dc(p):
 example(p,'divider');p.locator('#auto-update').uncheck();component(p,'V1');p.locator('[data-prop="dc"]').fill('-10');p.locator('[data-prop="dc"]').press('Enter');run(p)
 s=state(p);assert s['scope']['axes']['V']['minimum']<0;assert s['scope']['axes']['V']['maximum']>=0
 assert '−' in p.locator('#cursor-readout').inner_text() or '-5' in p.locator('#cursor-readout').inner_text()
 return {'negativeVoltageAxis':s['scope']['axes']['V']}
def import_rollback(p):
 example(p);p.locator('#auto-update').uncheck();before=physical(state(p));pr=project(p);pr['probes'][0]['color']='red" onload="window.__audit=1'
 upload(p,pr);assert physical(state(p))==before;assert p.evaluate('window.__audit===undefined')
 assert '불러오기 실패' in p.locator('#engine-status').inner_text()
 return {'rejectedWithoutStateMutation':True}
def orphan_import(p):
 example(p,'divider');p.locator('#auto-update').uncheck();pr=project(p);pr['circuit']['junctions']=[{'id':'orphan','x':200,'y':70}]
 upload(p,pr);run(p);assert state(p)['result']['points'][0]['nodeVoltages'][str(state(p)['result']['topology']['nodeIdByPin']['R2:0'])]==5
 return {'savedDrawingJunctionDoesNotBreakSolver':True}
def labels(p):
 example(p);q=p.locator('[data-id="C1"] .value-label').evaluate('(e)=>{let m=e.getScreenCTM();return {b:m.b,c:m.c}}')
 assert abs(q['b'])<1e-8 and abs(q['c'])<1e-8,q
 return {'rotatedComponentTextUpright':True}
def pan(p):
 example(p);before=state(p)['canvasView'];scale=p.locator('#circuit-canvas').evaluate('e=>e.getScreenCTM().a')
 rect=p.locator('#circuit-canvas').bounding_box();x=rect['x']+30;y=rect['y']+30
 p.mouse.move(x,y);p.mouse.down();p.mouse.move(x+60,y+30);p.mouse.up();after=state(p)['canvasView']
 assert abs((before['x']-after['x'])-60/scale)<1e-5,(before,after,scale)
 assert abs((before['y']-after['y'])-30/scale)<1e-5
 return {'screenDragPixels':[60,30],'ctmScale':scale}
def focus_scale(p):
 example(p);button=p.locator('[data-scale-axis="V"][data-scale-step="1"]');button.focus();v=state(p)['scope']['axes']['V']['division'];p.keyboard.press('Enter');p.keyboard.press('Enter')
 assert state(p)['scope']['axes']['V']['division']>v
 assert p.locator(':focus').get_attribute('data-scale-axis')=='V'
 return {'keyboardFocusSurvivesRerender':True}
def layout(p):
 example(p)
 if p.viewport_size['width']<=1100:p.locator('[data-pane="results"]').click()
 p.wait_for_timeout(80)
 layout=p.evaluate('()=>({viewport:innerWidth,doc:document.documentElement.scrollWidth,right:document.querySelector(".wave-panel").getBoundingClientRect().right})')
 assert layout['doc']<=layout['viewport']+.1 and layout['right']<=layout['viewport']+.1,layout
 p.screenshot(path=str(OUT/f'dark-{p.viewport_size["width"]}-results.png'))
 if p.viewport_size['width']<=1100:
  p.locator('[data-pane="circuit"]').click();p.screenshot(path=str(OUT/f'dark-{p.viewport_size["width"]}-circuit.png'))
 return layout
def phasor(p):
 example(p,'rc-lowpass');p.locator('#phasor-details > summary').click();p.locator('#phasor-panel').scroll_into_view_if_needed()
 colors=p.locator('.phasor-surface').evaluate_all('es=>es.map(e=>getComputedStyle(e).fill)')
 assert colors and all(c!='rgb(255, 255, 255)' for c in colors)
 p.screenshot(path=str(OUT/'dark-ac-learning.png'))
 return {'phasorBackgrounds':colors}
with sync_playwright() as pw:
 browser=launch_browser(pw)
 case('AUDIT-B01 Hidden invalid property survives selection and blocks run',hidden_draft)
 case('AUDIT-B02 Probe removal has independent undo history',probe_history)
 case('AUDIT-B03 Native wire double click splits exactly once',native_split)
 if not args.before_limited:
  case('AUDIT-B04 Dark/light switch never changes circuit or result',theme)
  case('AUDIT-B05 System theme responds to browser preference',system_theme)
  case('AUDIT-B06 Cancel new circuit retains pending text',cancel_navigation)
  case('AUDIT-B07 Hidden invalid draft blocks JSON download',hidden_save)
  case('AUDIT-B08 Nonfinite inline value blocks save/export',inline_bad_save)
  case('AUDIT-B09 Manual AC settings and phasor frequency remain exact',manual_ac)
  case('AUDIT-B10 Shift and Alt wheel affect independent axes only',modified_wheel)
  case('AUDIT-B11 Zero amplitude has undefined phase and honest CSV',zero_ac)
  case('AUDIT-B12 Negative DC values receive signed axes',negative_dc)
  case('AUDIT-B13 Unsafe import leaves valid state intact',import_rollback)
  case('AUDIT-B14 Orphan junction import can still be solved',orphan_import)
  case('AUDIT-B15 Rotated component labels remain upright',labels)
  case('AUDIT-B16 Canvas pan respects SVG letterboxing',pan)
  case('AUDIT-B17 Keyboard scale adjustment keeps focus',focus_scale)
  for w,h in [(1024,768),(390,844),(320,640)]:case(f'AUDIT-B18 Layout {w}x{h}',layout,w,h)
  case('AUDIT-B19 Phasor details share the dark theme',phasor)
 browser.close()
report={'transport':'HTTP' if os.environ.get('CIRCUIT_LAB_BASE_URL') else 'OFFLINE transport-only harness','root':str(ROOT),'cases':results,'passed':sum(x['status']=='PASS' for x in results),'failed':sum(x['status']=='FAIL' for x in results)}
(OUT/'audit-results.json').write_text(json.dumps(report,ensure_ascii=False,indent=2));print(json.dumps(report,ensure_ascii=False,indent=2))
raise SystemExit(bool(report['failed']))
