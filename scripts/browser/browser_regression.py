from browser_harness import *
import traceback, math, time, argparse, sys
parser=argparse.ArgumentParser(description='Circuit Lab browser regression; explicit HTTP or offline transport')
parser.add_argument('--root',type=Path,default=Path(__file__).resolve().parents[2])
parser.add_argument('--output',type=Path)
parser.add_argument('--base-url',help='Existing local server URL. Omit for the explicitly labeled offline harness.')
args=parser.parse_args()
ROOT=args.root.resolve();OUT=(args.output or ROOT/'artifacts/browser-review').resolve();OUT.mkdir(parents=True,exist_ok=True)
if args.base_url:os.environ['CIRCUIT_LAB_BASE_URL']=args.base_url
results=[]

def state(p): return p.evaluate('()=>__CIRCUIT_LAB__.getState()')
def wait_success(p): p.wait_for_function("__CIRCUIT_LAB__.getState().runState.status === 'success'")
def example(p,id='rc-charge'):
 p.locator('#example-select').select_option(id);wait_success(p)
def local_point(p,selector,x,y): return p.locator(selector).evaluate('(e,q)=>{const p=new DOMPoint(q.x,q.y).matrixTransform(e.getScreenCTM());return {x:p.x,y:p.y}}',{'x':x,'y':y})
def point_click(p,selector,x=0,y=0):
 q=local_point(p,selector,x,y);p.mouse.click(q['x'],q['y'])
def component(p,id):point_click(p,f'.component[data-id="{id}"]')
def plot_point(p,xf=.5,yf=.5):
 g=state(p)['scope']['geometry'];return local_point(p,'#wave-plot',g['left']+g['plotWidth']*xf,g['top']+g['plotHeight']*yf)
def wheel(p,selector,delta=120):p.locator(selector).hover();p.mouse.wheel(0,delta);p.wait_for_timeout(60)

def case(name,fn,width=1440,height=900):
 ctx,p,errors=load_app(browser,ROOT,width,height)
 try:
  details=fn(p) or {}
  assert not errors,errors
  results.append({'name':name,'status':'PASS','details':details,'pageErrors':errors})
 except Exception as e:
  results.append({'name':name,'status':'FAIL','error':str(e),'trace':traceback.format_exc(),'pageErrors':errors})
  p.screenshot(path=str(OUT/f'failure-{len(results):02}.png'))
 finally:ctx.close()

def oneclick(p):
 p.locator('[data-learning-example="rc-lowpass"]').click();wait_success(p)
 assert not p.locator('#advanced-analysis').evaluate('(e)=>e.open')
 assert p.locator('#wave-plot').is_visible()
 assert state(p)['result']['analysis']=='ac'
 p.locator('#phasor-details > summary').click();assert p.locator('#voltage-phasor-plot').is_visible()
 return {'analysis':'ac','advancedRequired':False}
def warning(p):
 p.locator('[data-type="R"]').click();point_click(p,'#circuit-canvas',280,240)
 p.keyboard.press('Escape');p.locator('.connection-badge').click()
 assert p.locator('.connection-badge text').text_content().strip()=='!'
 assert '미배선' in p.locator('.connection-detail').inner_text()
 assert len(state(p)['circuit']['components'])==1
 return {'symbol':'!','opensExplanation':True}
def delete(p):
 example(p);p.locator('#auto-update').uncheck();component(p,'R1')
 p.locator('[data-delete-component="R1"]').click()
 assert all(c['id']!='R1' for c in state(p)['circuit']['components'])
 p.locator('#undo-button').click();assert any(c['id']=='R1' for c in state(p)['circuit']['components'])
 return {'deleteAndUndo':True}
def invalid(p):
 example(p);component(p,'R1');p.locator('[data-prop="value"]').fill('banana');p.locator('#run-button').click()
 assert state(p)['runState']['status']!='success'
 assert '입력 오류' in p.locator('#engine-status').inner_text()
 assert p.locator('#csv-button').is_disabled()
 return {'status':p.locator('#engine-status').inner_text()}
def inline(p):
 example(p);p.locator('[data-id="R1"] .value-label').dblclick();assert p.locator('#inline-value-editor').is_visible()
 p.locator('#inline-value-editor').fill('2k');p.locator('#inline-value-editor').press('Enter');wait_success(p)
 assert next(c for c in state(p)['circuit']['components'] if c['id']=='R1')['props']['value']=='2k'
 return {'nativeDoubleClick':True,'stored':'2k'}
def inlinebad(p):
 example(p);p.locator('[data-id="R1"] .value-label').dblclick();p.locator('#inline-value-editor').fill('bad')
 p.locator('#run-button').click();assert state(p)['runState']['status']!='success';assert p.locator('#csv-button').is_disabled()
def cancel(p):
 p.evaluate("()=>{__CIRCUIT_LAB__.loadExample('rc-lowpass');document.querySelector('#new-button').click()}");p.wait_for_timeout(450)
 assert state(p)['runState']['status']=='not-run';assert not p.locator('#run-button').is_disabled()
 return {'runState':state(p)['runState']}
def autosoff(p):
 p.locator('#auto-update').uncheck();p.locator('#example-select').select_option('divider');p.wait_for_timeout(400)
 assert state(p)['runState']['status']=='not-run';p.locator('#run-button').click();wait_success(p)
def intent(p):
 example(p);before=state(p)['circuit'];p.locator('#analysis-intent').select_option('dc');wait_success(p)
 assert state(p)['result']['analysis']=='dc';assert state(p)['circuit']==before
 p.locator('#analysis-intent').select_option('ac');wait_success(p);assert state(p)['result']['analysis']=='ac';assert state(p)['circuit']==before
 return {'DC_AC_noPhysicsMutation':True}
def autotime(p):
 example(p);p.locator('#analysis-intent').select_option('auto');wait_success(p)
 s=state(p);assert s['result']['analysis']=='transient';assert float(s['settings']['end'])<.1
 return {'endSeconds':s['settings']['end'],'stepSeconds':s['settings']['step']}
def cursor(p):
 example(p);q=plot_point(p,0.000001,.5);p.mouse.move(q['x'],q['y']);p.wait_for_timeout(40)
 s=state(p);assert s['scope']['cursorIndex']==0, s['scope']['cursorIndex']
 assert '0 s' in p.locator('#cursor-readout').inner_text()
 return {'text':p.locator('#cursor-readout').inner_text()}
def xwheel(p):
 example(p);raw=state(p)['result'];before=state(p)['scope']['x']['division'];q=plot_point(p);p.mouse.move(q['x'],q['y']);p.mouse.wheel(0,120);p.wait_for_timeout(60)
 s=state(p);assert s['scope']['x']['division']>before;assert s['scope']['x']['automatic']==False;assert s['result']==raw
 return {'before':before,'after':s['scope']['x']['division']}
def ywheel(p):
 example(p);s=state(p);vd=s['scope']['axes']['V']['division'];ad=s['scope']['axes']['A']['division'];xd=s['scope']['x']['division']
 wheel(p,'[data-scale-control="V"]',-120);s=state(p);assert s['scope']['axes']['V']['division']<vd;assert s['scope']['axes']['A']['division']==ad
 wheel(p,'[data-scale-control="A"]',120);s=state(p);assert s['scope']['axes']['A']['division']>ad;assert s['scope']['x']['division']==xd
 return {'axes':s['scope']['axes']}
def scalespersist(p):
 example(p);wheel(p,'[data-scale-control="V"]',120);wheel(p,'[data-scale-control="x"]',120);s=state(p)['scope']
 p.locator('#run-button').click();wait_success(p);s2=state(p)['scope'];assert s['x']==s2['x'];assert s['axes']['V']==s2['axes']['V']
 p.locator('#reset-view-button').click();s3=state(p)['scope'];assert s3['x']['automatic'];assert s3['axes']['V']['automatic']
 return {'manualScalePreservedAcrossRun':True,'fitRestoresAuto':True}
def cursorperformance(p):
 example(p);p.wait_for_timeout(50);before=state(p)['scope']['renderCount']
 for x in [.1,.2,.3,.4,.5,.6]:
  q=plot_point(p,x,.5);p.mouse.move(q['x'],q['y'])
 after=state(p)['scope']['renderCount'];assert after==before,(before,after)
 return {'traceRendersBefore':before,'traceRendersAfter':after,'pointerMoves':6}
def layout(p):
 example(p)
 if p.viewport_size['width']<=1100:p.locator('[data-pane="results"]').click()
 p.wait_for_timeout(70)
 info=p.evaluate("()=>({viewport:innerWidth,document:document.documentElement.scrollWidth,right:document.querySelector('.wave-panel').getBoundingClientRect().right,plot:document.querySelector('#wave-plot').getBoundingClientRect().width})")
 assert info['right']<=info['viewport']+.1,info;assert info['document']<=info['viewport']+.1,info
 p.screenshot(path=str(OUT/f'after-{p.viewport_size["width"]}.png'))
 if p.viewport_size['width']<=1100:
  p.locator('[data-pane="circuit"]').click();p.screenshot(path=str(OUT/f'after-{p.viewport_size["width"]}-circuit.png'))
 return info
def save_roundtrip(p):
 example(p);p.locator('#auto-update').uncheck();component(p,'R1');p.locator('[data-delete-component="R1"]').click()
 with p.expect_download() as d:p.locator('#save-button').click()
 path=OUT/'roundtrip-saved.json';d.value.save_as(str(path));data=json.loads(path.read_text())
 p.locator('#file-input').set_input_files(str(path));p.wait_for_timeout(70)
 assert '불러오기 완료' in p.locator('#engine-status').inner_text();assert len(state(p)['circuit']['components'])==len(data['circuit']['components'])
 return {'savedParts':len(data['circuit']['components']),'reload':True}
def importbad(p):
 example(p);p.locator('#auto-update').uncheck();s=state(p); payload={'format':'circuit-lab','version':1,'circuit':s['circuit'],'settings':s['settings'],'probes':s['probes']}
 payload['probes'][0]['color']='red\"><img src=x onerror="window.__reviewMarker=1">'
 p.locator('#file-input').set_input_files({'name':'unsafe.json','mimeType':'application/json','buffer':json.dumps(payload).encode()});p.wait_for_timeout(80)
 assert p.evaluate('()=>window.__reviewMarker') is None;assert '불러오기 실패' in p.locator('#engine-status').inner_text();assert state(p)['circuit']==s['circuit']
 return {'inertMarkerExecuted':False,'oldCircuitPreserved':True}
def dragcancel(p):
 example(p);q=plot_point(p);p.mouse.move(q['x'],q['y']);p.mouse.down();p.mouse.move(q['x']+30,q['y']);assert state(p)['pointerOwnerId'] is not None
 p.evaluate("()=>document.querySelector('#new-button').click()");p.mouse.up();assert state(p)['pointerOwnerId'] is None;assert state(p)['runState']['status']=='not-run'
def csv(p):
 example(p);wheel(p,'[data-scale-control="A"]',120)
 with p.expect_download() as d:p.locator('#csv-button').click()
 path=OUT/'scope-raw.csv';d.value.save_as(str(path));text=path.read_text();assert '_A' in text.splitlines()[0]
 return {'header':text.splitlines()[0],'lines':len(text.splitlines())}

with sync_playwright() as pw:
 browser=launch_browser(pw)
 cases=[('One-click AC example and optional learning details',oneclick),('Warning is explanatory, not destructive',warning),('Actual component delete and undo',delete),('Invalid inspector input blocks success and CSV',invalid),('Native double-click edits component value',inline),('Invalid inline value blocks execution',inlinebad),('New project cancels pending auto-run',cancel),('Auto-update off waits for explicit run',autosoff),('Intent switching preserves source and IC data',intent),('Auto RC range focuses first step',autotime),('Cursor at graph start reads first sample',cursor),('Horizontal wheel changes display only',xwheel),('Independent voltage and current wheel divisions',ywheel),('Manual scales survive rerun and auto fit resets them',scalespersist),('Cursor motion does not redraw traces',cursorperformance),('Desktop 1440 layout',layout),('1024 results layout',layout,1024,768),('390 mobile results layout',layout,390,844),('Save and reload after component deletion',save_roundtrip),('Hostile imported color rejected',importbad),('New project releases plot pointer ownership',dragcancel),('CSV remains raw SI after scale changes',csv)]
 for scenario in cases:case(*scenario)
 data={'browser':browser.version,'transport':args.base_url or 'offline import-map harness; application HTML/CSS/module code, not localhost navigation','scenarios':results,'passed':sum(r['status']=='PASS' for r in results),'failed':sum(r['status']=='FAIL' for r in results)}
 (OUT/'browser-regression.json').write_text(json.dumps(data,ensure_ascii=False,indent=2));print(json.dumps(data,ensure_ascii=False,indent=2));browser.close()

if data["failed"]:sys.exit(1)
