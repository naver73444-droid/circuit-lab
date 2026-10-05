"""Actual Node HTTP checks, distinct from any browser/offline observations."""
from pathlib import Path
import argparse, tempfile, shutil, subprocess, urllib.request, urllib.error, json, re
parser=argparse.ArgumentParser();parser.add_argument('--root',type=Path,default=Path(__file__).resolve().parents[1]);parser.add_argument('--output',type=Path,required=True);args=parser.parse_args()
results=[]
with tempfile.TemporaryDirectory(prefix='circuit-http-audit-') as temp:
 root=Path(temp)/'app';root.mkdir()
 for name in ['server.mjs','index.html','styles.css','README.md']:shutil.copy2(args.root/name,root/name)
 shutil.copytree(args.root/'src',root/'src')
 (root/'package.json').write_text('{"type":"module"}')
 outside=Path(temp)/'outside.js';outside.write_text('AUDIT_OUTSIDE_SENTINEL')
 symlink_available=True
 try:(root/'src'/'audit-link.js').symlink_to(outside)
 except OSError as error:
  symlink_available=False
  results.append({'name':'Symlink/reparse boundary','status':'INCONCLUSIVE','reason':f'Windows link creation unavailable: {error.winerror or error}'})
 # Port 0 avoids collisions. The older server prints 0, so allocate an explicit test port.
 import socket
 with socket.socket() as sock:sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
 process=subprocess.Popen(['node',str(root/'server.mjs'),str(port)],stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,encoding='utf-8')
 try:
  line=process.stdout.readline();assert 'http://127.0.0.1:' in line,line
  url=f'http://127.0.0.1:{port}'
  checks=[('/', 'GET',200),('/styles.css','GET',200),('/src/app.js','GET',200),('/src/circuit-engine.js','GET',200),('/','HEAD',200),('/','POST',405),('/README.md','GET',404),('/package.json','GET',404),('/%2e%2e/outside.js','GET',404),('/%zz','GET',404)]
  if symlink_available:checks.append(('/src/audit-link.js','GET',404))
  for path,method,expected in checks:
   request=urllib.request.Request(url+path,method=method)
   try: response=urllib.request.urlopen(request,timeout=4)
   except urllib.error.HTTPError as e:response=e
   body=response.read();passed=response.status==expected and (method!='HEAD' or not body)
   results.append({'path':path,'method':method,'expected':expected,'actual':response.status,'bytes':len(body),'status':'PASS' if passed else 'FAIL'})
  request=urllib.request.Request(url+'/',headers={'Host':'unrelated.example'})
  try:response=urllib.request.urlopen(request,timeout=4)
  except urllib.error.HTTPError as e:response=e
  results.append({'name':'Host is limited to loopback aliases','expected':403,'actual':response.status,'status':'PASS' if response.status==403 else 'FAIL'})
  response=urllib.request.urlopen(url+'/',timeout=4);headers=dict(response.headers)
  results.append({'name':'Security headers delivered','status':'PASS' if headers.get('X-Content-Type-Options')=='nosniff' and "frame-ancestors 'none'" in headers.get('Content-Security-Policy','') else 'FAIL','headers':headers})
 finally:
  process.terminate();process.communicate(timeout=4)
report={'transport':'Actual Node HTTP requests, no browser assertions','cases':results,'passed':sum(x['status']=='PASS' for x in results),'failed':sum(x['status']=='FAIL' for x in results)}
args.output.parent.mkdir(parents=True,exist_ok=True);args.output.write_text(json.dumps(report,ensure_ascii=False,indent=2));print(json.dumps(report,ensure_ascii=False,indent=2));raise SystemExit(bool(report['failed']))
