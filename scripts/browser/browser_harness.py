"""Offline browser harness. Only CSS transport and ES module import paths are adapted.
Does not validate localhost HTTP, CSP delivery, Windows packaging, or real touch hardware.
"""
from pathlib import Path
import base64,json,re,os,shutil
from playwright.sync_api import sync_playwright

def html_for_source(root):
 imports={}
 for f in (root/'src').glob('*.js'):
  source=re.sub(r'(from\s+[\"\'])\./([^\"\']+)([\"\'])',r'\1\2\3',f.read_text())
  imports[f.name]='data:text/javascript;base64,'+base64.b64encode(source.encode()).decode()
 html=(root/'index.html').read_text()
 html=html.replace('<link rel="stylesheet" href="/styles.css" />','<style>'+(root/'styles.css').read_text()+'</style>')
 html=html.replace('<script type="module" src="/src/app.js"></script>', '<script type="importmap">'+json.dumps({'imports':imports})+'</script><script type="module">import "app.js";</script>')
 return html

def load_app(browser,root,width=1440,height=900):
 ctx=browser.new_context(viewport={'width':width,'height':height},accept_downloads=True)
 page=ctx.new_page();page.set_default_timeout(3500);errors=[]
 page.on('pageerror',lambda e:errors.append(str(e)))
 page.goto(os.environ['CIRCUIT_LAB_BASE_URL'],wait_until='load') if os.environ.get('CIRCUIT_LAB_BASE_URL') else page.set_content(html_for_source(Path(root)),wait_until='load')
 page.wait_for_function('Boolean(window.__CIRCUIT_LAB__)')
 return ctx,page,errors

def launch_browser(p):
 return p.chromium.launch(executable_path=os.environ.get('CIRCUIT_LAB_BROWSER') or shutil.which('chromium') or p.chromium.executable_path,headless=True,args=['--no-sandbox'] if hasattr(os, 'geteuid') and os.geteuid() == 0 else [])
