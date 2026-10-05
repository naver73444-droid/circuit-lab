import test from 'node:test';
import assert from 'node:assert/strict';
import { EXPERIMENTS } from '../../../src/em-course-waves.js';
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

const [wave,boundary]=EXPERIMENTS;
const eps=8.8541878188e-12,mu=1.25663706127e-6;
const wp={epsilonR:4,muR:1,frequency:1e8,amplitude:10,phase:.3,time:0};
const ip={epsilonR1:9,muR1:4,epsilonR2:4,muR2:9,frequency:1e8,amplitude:12,phase:.3,time:0};
test('all wave definitions expose exact common schema/default structural conditions and are pure',()=>{
  for(const definition of EXPERIMENTS){
    assert.ok(definition.symbolicControls.length);const initial=Object.fromEntries(definition.symbolicControls.map(c=>[c.key,c.initial]));
    assert.deepEqual(definition.symbolic(),definition.symbolic(initial));
    const snapshot=JSON.stringify(initial),data=definition.symbolic(initial);schema(data);assert.equal(data.status,'supported');
    assert.equal(JSON.stringify(initial),snapshot);assert.ok(data.steps.length>=4&&data.answers.length>=6);
    assert.ok(!JSON.stringify(data).includes('100000000'));assert.ok(!JSON.stringify(data).includes('188.365'));
  }
});
test('wave symbolic rejects physical values, unknown/invalid enums and malformed options without answers',()=>{
  for(const [definition,key]of [[wave,'propagation'],[boundary,'incidenceSide']]){
    for(const options of [null,[],new Date(),{[key]:'0'},{[key]:NaN},{[key]:-1},{frequency:1e8},{amplitude:10}])schema(definition.symbolic(options)),assert.equal(definition.symbolic(options).status,'unsupported');
    schema(definition.symbolic(Object.create(null)));
  }
});
test('actual displayed material/speed/power/energy expressions substitute into independent fixtures',()=>{
  for(const materialMode of [0,1]){
    const data=wave.symbolic({materialMode}),p=materialMode?{...wp,epsilonR:1,muR:1}:wp;
    const r=wave.evaluate(p,[0,0,0]),env={ε:4*eps,μ:mu,'ε₀':eps,'μ₀':mu,'E₀':10,ω:2*Math.PI*1e8,f:1e8};
    env.η=substitute(answer(data,'η').formula,env)[0];env.v=substitute(answer(data,'v').formula,env)[0];
    close(env.η,scalar(r,'impedance'));close(env.v,scalar(r,'velocity'));
    close(substitute(answer(data,'β').formula,env)[0],scalar(r,'beta'));
    close(substitute(answer(data,'λ').formula,env)[0],scalar(r,'wavelength'));
    close(substitute(answer(data,'⟨S_z⟩').formula,env)[0],scalar(r,'averagePoyntingZ'));
    close(substitute(answer(data,'⟨u⟩').formula,env)[0],scalar(r,'averageEnergyDensity'),2e-11,1e-21);
    assert.equal(answer(data,'η').unit,'Ω');assert.equal(answer(data,'⟨S_z⟩').unit,'W/m²');assert.equal(answer(data,'⟨u⟩').unit,'J/m³');
  }
});
test('selected propagation changes actual field expressions, H direction and signed energy flow',()=>{
  const eta=Math.sqrt(mu/(4*eps)),beta=2*Math.PI*1e8*Math.sqrt(mu*4*eps),z=.123;
  const env={'E₀':10,η:eta,Q:polar(1,.3),Wm:polar(1,-beta*z),Wp:polar(1,beta*z)};
  for(const propagation of [0,1]){
    const data=wave.symbolic({propagation}),r=wave.evaluate(wp,[0,0,propagation?-z:z]);
    const E=substitute(answer(data,'Ẽ').formula,env),H=substitute(answer(data,'H̃').formula,env);
    complexClose(E,phasor(r,'electricX'));complexClose(H,phasor(r,'magneticY').map(x=>propagation?-x:x));
    close(substitute(answer(data,'⟨S_z⟩').formula,env)[0],(propagation?-1:1)*scalar(r,'averagePoyntingZ'));
    assert.match(answer(data,'H̃').direction,propagation?/−z/:/\+z/);
    assert.ok(data.boundaries[0].condition==='z=0'&&!data.boundaries[0].explanation.includes('특이점입니다'));
  }
});
test('actual interface coefficient and piecewise field strings match independent magnetic-material fixtures',()=>{
  for(const incidenceSide of [0,1]){
    const data=boundary.symbolic({incidenceSide}),env={'η₁':Math.sqrt(4*mu/(9*eps)),'η₂':Math.sqrt(9*mu/(4*eps)),'E₀':12,A:polar(12,.3)};
    env.Γ_E=substitute(answer(data,'Γ_E').formula,env)[0];env.T_E=substitute(answer(data,'T_E').formula,env)[0];
    close(env.Γ_E,(incidenceSide?-1:1)*5/13);close(env.T_E,incidenceSide?8/13:18/13);
    close(substitute(answer(data,'R').formula,env)[0],25/169);env.T=substitute(answer(data,'T').formula,env)[0];close(env.T,144/169);
    const mapped=incidenceSide?{...ip,epsilonR1:ip.epsilonR2,muR1:ip.muR2,epsilonR2:ip.epsilonR1,muR2:ip.muR1}:ip;
    for(const z of [-.17,.11]){
      const r=boundary.evaluate(mapped,[0,0,incidenceSide?-z:z]);
      for(const k of [1,2]){const beta=2*Math.PI*ip.frequency*Math.sqrt((k===1?9*eps:4*eps)*(k===1?4*mu:9*mu));env['W'+k+'m']=polar(1,-beta*z);env['W'+k+'p']=polar(1,beta*z);}
      const region=data.regions.find(s=>s.condition===(z<0?'z<0':'z>0'));
      const [electric,magnetic]=region.formula.split('; ');
      complexClose(substitute(electric,env),phasor(r,'electricX'));
      complexClose(substitute(magnetic,env),phasor(r,'magneticY').map(x=>incidenceSide?-x:x));
      close(substitute(answer(data,'⟨S_z⟩').formula,env)[0],(incidenceSide?-1:1)*scalar(r,'averagePoyntingZ'));
    }
  }
});
test('matching and impedance-order branches alter derivation, reflected phase and boundary domains',()=>{
  for(const incidenceSide of [0,1]){
    const matched=boundary.symbolic({incidenceSide,impedanceRelation:1});schema(matched);
    assert.equal(answer(matched,'Γ_E').formula,'Γ_E = 0');assert.equal(answer(matched,'T_E').formula,'T_E = 1');
    assert.ok(matched.regions[0].explanation.includes('반사파 없음'));assert.ok(!matched.regions[0].formula.includes('Γ_E'));
    const p={...ip,epsilonR1:1,muR1:1,epsilonR2:9,muR2:9};close(scalar(boundary.evaluate(p,[0,0,.1]),'gammaE'),0);
    for(const impedanceRelation of [2,3]){
      const data=boundary.symbolic({incidenceSide,impedanceRelation});schema(data);
      assert.match(answer(data,'Γ_E').direction,impedanceRelation===2?/Δφ_E,r=0/:/Δφ_E,r=π/);
      assert.ok(data.steps[2].explanation.includes(impedanceRelation===2?'>':'<'));
    }
    assert.match(matched.boundaries[0].explanation,/D,B.*양측 극한/);
  }
  assert.equal(boundary.evaluate(ip,[0,0,0]).status,'boundary');
});
