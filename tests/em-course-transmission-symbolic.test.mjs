import test from 'node:test';
import assert from 'node:assert/strict';
import { EXPERIMENTS } from '../src/em-course-transmission.js';
// Test-only constrained arithmetic substitution of returned human formula strings.
// No eval/Function/production helper, and no runtime expression engine is added.
const C = x => Array.isArray(x) ? x : [x, 0];
const plus = (a,b) => [a[0]+b[0],a[1]+b[1]], times = (a,b) => [a[0]*b[0]-a[1]*b[1],a[0]*b[1]+a[1]*b[0]];
const quotient = (a,b) => { const d=b[0]**2+b[1]**2; return [(a[0]*b[0]+a[1]*b[1])/d,(a[1]*b[0]-a[0]*b[1])/d]; };
const polar = (m,a) => [m*Math.cos(a),m*Math.sin(a)];
function substitute(formula, env) {
  let text = formula.slice(formula.indexOf('=')+1).replace(/−/g,'-').replace(/·/g,'*').replace(/²/g,'^2');
  text=text.replace(/\|V⁺\|/g,'A').replace(/\|Γ_L\|/g,'ρ').replace(/V⁺/g,'Vp ').replace(/[xy]̂/g,'');
  text=text.replace(/e\^\{jφ\}/g,'Q').replace(/e\^\{([+-])jβ([₁₂]?)z\}/g,(_,sign,index)=>'W'+(index==='₁'?'1':index==='₂'?'2':'')+(sign==='-'?'m':'p'));
  text=text.replace(/j(?=[\p{L}_])/gu,'j ');
  const tokens=text.match(/(?:\d+(?:\.\d*)?|[\p{L}_][\p{L}\p{N}_′]*|[()+*/^√-])/gu)||[];
  assert.equal(tokens.join(''),text.replace(/\s/g,''),'unparsed formula '+text);
  let index=0;
  const primary=()=>{
    const token=tokens[index++];
    if(token==='('){const value=expression();assert.equal(tokens[index++],')');return value;}
    if(token==='√'){const value=primary();close(value[1],0);return [Math.sqrt(value[0]),0];}
    if(['sin','cos','tan','cot'].includes(token)){const value=primary();close(value[1],0);return [token==='cot'?1/Math.tan(value[0]):Math[token](value[0]),0];}
    if(/^\d/.test(token||''))return [Number(token),0];
    if(token==='j')return [0,1];
    assert.ok(Object.hasOwn(env,token),'unknown symbol '+token+' in '+text);return C(env[token]);
  };
  const unary=()=>{if(tokens[index]==='-'||tokens[index]==='+'){const sign=tokens[index++];const value=unary();return sign==='-'?value.map(x=>-x):value;}const value=primary();if(tokens[index]==='^'){index++;assert.equal(tokens[index++],'2');return times(value,value);}return value;};
  const term=()=>{let result=unary();while(index<tokens.length){const token=tokens[index];if(token==='*'||token==='/'){index++;const next=unary();result=token==='*'?times(result,next):quotient(result,next);}else if(token==='('||token==='√'||/^[\p{L}_\d]/u.test(token)){result=times(result,unary());}else break;}return result;};
  const expression=()=>{let result=term();while(tokens[index]==='+'||tokens[index]==='-'){const sign=tokens[index++],next=term();result=plus(result,sign==='-'?next.map(x=>-x):next);}return result;};
  const result=expression();assert.equal(index,tokens.length,'trailing formula tokens');return result;
}
const answer = (data,quantity) => {const entry=data.answers.find(a=>a.quantity===quantity);assert.ok(entry,quantity);return entry;};
const close = (a,b,rel=2e-11,absolute=1e-12) => assert.ok(Number.isFinite(a)&&Math.abs(a-b)<=absolute+rel*Math.abs(b),a+' vs '+b);
const complexClose = (a,b) => {close(a[0],b[0]);close(a[1],b[1]);};
const scalar = (r,key) => r.scalars.find(s=>s.key===key)?.value;
const phasor = (r,key) => {const c=r.phasors?.find(c=>c.key===key);assert.ok(c,key);return [c.re,c.im];};
function schema(data) {
  assert.deepEqual(Object.keys(data).sort(),['status','title','reason','givens','assumptions','conditions','laws','steps','answers','regions','boundaries','limitations'].sort());
  assert.ok(['supported','unsupported'].includes(data.status));
  for(const key of ['title','reason'])assert.equal(typeof data[key],'string');
  const entries={givens:['symbol','meaning','unit','constraint'],laws:['name','formula'],steps:['title','formula','explanation'],answers:['quantity','formula','unit','direction'],regions:['condition','formula','explanation'],boundaries:['condition','formula','explanation']};
  for(const [key,fields]of Object.entries(entries)){assert.ok(Array.isArray(data[key]));for(const entry of data[key]){assert.deepEqual(Object.keys(entry).sort(),fields.sort());Object.values(entry).forEach(value=>assert.equal(typeof value,'string'));}}
  for(const key of ['assumptions','conditions','limitations'])assert.ok(data[key].every(s=>typeof s==='string'));
  assert.ok(data.limitations.some(s=>s.includes('CAS')));
  if(data.status==='unsupported'){assert.deepEqual(data.answers,[]);assert.ok(data.reason);}
}

const [line]=EXPERIMENTS;
const base={z0:50,velocity:2e8,frequency:1e8,length:.7,amplitude:1,phase:.2,time:0,loadMode:0,loadResistance:30,loadReactance:40};
// Independently propagate load boundary values by ABCD, not Γ exponent helpers.
function fromLoad(params,z){
  const Vp=polar(1,.2);let VL,IL;
  if(params.loadMode===1){VL=Vp.map(v=>2*v);IL=[0,0];}
  else if(params.loadMode===2){VL=[0,0];IL=Vp.map(v=>2*v/50);}
  else{IL=quotient(Vp.map(v=>2*v),[params.loadResistance+50,params.loadReactance]);VL=times([params.loadResistance,params.loadReactance],IL);}
  const theta=-Math.PI*z,c=Math.cos(theta),s=Math.sin(theta);
  return {V:plus(VL.map(v=>c*v),times([0,50*s],IL)),I:plus(IL.map(v=>c*v),times([0,s/50],VL))};
}
function paramsFor(mode,lengthClass){
  return {...base,length:lengthClass===1?.5:lengthClass===2?1:.7,
    loadMode:mode===1?1:mode===2?2:0,
    loadResistance:mode===3?50:mode===4?0:30,loadReactance:mode===3?0:mode===4?50:40};
}
test('every structural load/length branch returns exact symbolic schema, defaults and no sample givens',()=>{
  assert.equal(line.symbolicControls.length,2);
  assert.deepEqual(line.symbolic(),line.symbolic({loadMode:0,lengthClass:0}));
  for(const loadMode of [0,1,2,3,4])for(const lengthClass of [0,1,2]){
    const options={loadMode,lengthClass},before=JSON.stringify(options),data=line.symbolic(options);
    schema(data);assert.equal(data.status,'supported');assert.equal(JSON.stringify(options),before);
    assert.equal(typeof line.evaluate,'function');assert.equal(typeof line.profile,'function');
    assert.ok(!JSON.stringify(data.givens).includes('200000000'));assert.ok(data.steps.length>=6);
  }
});
test('structural-only TL input refuses numerical params, unsupported enums and malformed options',()=>{
  for(const options of [null,[],new Date(),{loadMode:-1},{loadMode:5},{loadMode:'1'},{lengthClass:3},{lengthClass:NaN},base,{z0:50},{phase:.2}]){
    const data=line.symbolic(options);schema(data);assert.equal(data.status,'unsupported');
  }
  assert.equal(line.symbolic(Object.create(null)).status,'supported');
  assert.equal(line.evaluate({...base,loadMode:3},[0,0,-.2]).status,'invalid'); // numeric API unchanged
});
test('actual Γ,V/I,power symbolic strings substitute to independent boundary/ABCD fixtures for all load classes',()=>{
  for(const mode of [0,1,2,3,4]){
    const data=line.symbolic({loadMode:mode}),params=paramsFor(mode,0),z=-.17;
    const env={'Z₀':50,Z_L:[params.loadResistance,params.loadReactance],X_L:50,Vp:polar(1,.2),A:1,'βz':Math.PI*z,'βℓ':Math.PI*params.length,Wm:polar(1,-Math.PI*z),Wp:polar(1,Math.PI*z),v:2e8,ℓ:params.length};
    env.Γ_L=substitute(answer(data,'Γ_L').formula,env);
    complexClose(env.Γ_L,mode===0?[0,.5]:mode===1?[1,0]:mode===2?[-1,0]:mode===3?[0,0]:[0,1]);
    env.ρ=Math.hypot(...env.Γ_L);
    const ref=fromLoad(params,z),numeric=line.evaluate(params,[0,0,z]);
    const V=substitute(answer(data,'Ṽ(z)').formula,env),I=substitute(answer(data,'Ĩ(z)').formula,env);
    complexClose(V,ref.V);complexClose(I,ref.I);complexClose(V,phasor(numeric,'voltage'));complexClose(I,phasor(numeric,'current'));
    const power=substitute(answer(data,'P_net').formula,env)[0];
    close(power,mode===0?.0075:mode===3?.01:0);close(power,.5*(ref.V[0]*ref.I[0]+ref.V[1]*ref.I[1]));
    close(substitute(answer(data,'P_inc').formula,env)[0],.01);
    close(substitute(answer(data,'τ').formula,env)[0],params.length/2e8,2e-11,1e-20);
    assert.equal(answer(data,'P_net').unit,'W');assert.equal(answer(data,'Z_in').unit,'Ω');assert.equal(answer(data,'τ').unit,'s');
  }
});
test('displayed general,quarter,half input expressions match independent complex transforms or explicit poles',()=>{
  for(const mode of [0,1,2,3,4])for(const lengthClass of [0,1,2]){
    const data=line.symbolic({loadMode:mode,lengthClass}),params=paramsFor(mode,lengthClass),entry=answer(data,'Z_in');
    const numeric=line.evaluate(params,[0,0,-params.length]);
    if(entry.formula.includes('pole')){
      assert.ok((mode===2&&lengthClass===1)||(mode===1&&lengthClass===2));
      assert.equal(numeric.status,'singular');assert.equal(numeric.phasors.find(p=>p.key==='inputImpedance'),undefined);
      continue;
    }
    const env={'Z₀':50,Z_L:[params.loadResistance,params.loadReactance],X_L:50,'βℓ':Math.PI*params.length};
    const symbolic=substitute(entry.formula,env),ref=fromLoad(params,-params.length);
    complexClose(symbolic,quotient(ref.V,ref.I));complexClose(symbolic,phasor(numeric,'inputImpedance'));
    if(mode===0&&lengthClass===1)complexClose(symbolic,[30,-40]);
    if(mode===0&&lengthClass===2)complexClose(symbolic,[30,40]);
    if(mode===4&&lengthClass===1)complexClose(symbolic,[0,-50]);
  }
});
test('specialized boundary,zero-drive,SWR and finite-quarter-zero-load domains remain explicit',()=>{
  for(const mode of [1,2,4]){
    const data=line.symbolic({loadMode:mode});assert.match(answer(data,'SWR').formula,/∞.*유한 숫자 없음/);
    assert.equal(answer(data,'P_net').formula,'P_net = 0');
    assert.ok(data.boundaries.some(b=>b.condition==='Γ_L e^{2jβz}=1'&&b.formula.includes('pole')));
    assert.ok(data.boundaries.find(b=>b.condition==='V⁺=0').explanation.includes('0/0'));
  }
  const matched=line.symbolic({loadMode:3});
  assert.equal(answer(matched,'SWR').formula,'SWR = 1');assert.equal(answer(matched,'Z_in').formula,'Z_in = Z₀');
  assert.equal(answer(matched,'U_line').formula,'U_line = P_inc · τ');
  assert.match(line.symbolic({lengthClass:1}).conditions.join(';'),/Z_L=0.*극점/);
  assert.ok(line.symbolic().regions.some(r=>r.condition.includes('z<−ℓ')&&r.formula.includes('정의역 밖')));
  assert.match(line.symbolic().limitations.join(';'),/미해상.*기호식 실패가 아닙니다/);
});
