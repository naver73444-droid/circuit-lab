const axesFor = plane => plane === 'xz' ? [0, 2] : plane === 'yz' ? [1, 2] : [0, 1];
const magnitude = vector => Math.hypot(...vector);
// Assigning canvas.width/height clears the backing store and reallocates it, so only do it when the pixel size really changes.
// When the size is unchanged, reset the 2D state by hand (transform, dash, alpha, text, width) so every render starts clean.
function prepareCanvas(canvas, ctx, dpr) {
  const width = Math.round(canvas.clientWidth * dpr), height = Math.round(canvas.clientHeight * dpr);
  if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
  else { ctx.setLineDash([]); ctx.globalAlpha = 1; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'; ctx.lineWidth = 1; ctx.lineCap = 'butt'; ctx.lineJoin = 'miter'; ctx.globalCompositeOperation = 'source-over'; ctx.shadowBlur = 0; ctx.lineDashOffset = 0; ctx.font = '10px sans-serif'; ctx.fillStyle = '#000000'; ctx.strokeStyle = '#000000'; }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
export function createCourseView(canvas, onProbe) {
  const events = new AbortController();
  let current = null, active = false, dragging = false;
  const geometry = () => {
    const definition = current.definition, view = definition.view || {};
    const axes = current.definition.id==='motional-rod'?[0,1]:view.probeAxes?.length === 2 ? view.probeAxes : axesFor(view.plane);
    const extent = (current.definition.id.startsWith('coax-current')?Math.max(current.params.b,current.params.c||0)*1.55:Number(view.extent) > 0 ? Number(view.extent) : Math.max(.01, ...current.point.map(Math.abs)) * 1.6)*(current.viewScale || 1);
    return { axes, extent, axisOnly: view.kind === 'axis-only', profileMode:view.kind==='profile' };
  };
  const profileDomain=()=>{
    const points=current.profiles?.[0]?.points||[],lo=Math.min(...points.map(p=>p.coordinate)),hi=Math.max(...points.map(p=>p.coordinate));
    if(!Number.isFinite(lo)||!Number.isFinite(hi)||hi<=lo)return[-1,1];
    const center=(lo+hi)/2,half=(hi-lo)/2*(current.viewScale||1);return[center-half,center+half];
  };
  function render() {
    if (!active || !current || !canvas.clientWidth || !canvas.clientHeight) return;
    const ctx = canvas.getContext('2d'), dpr = Math.min(1.5, devicePixelRatio || 1);
    prepareCanvas(canvas, ctx, dpr);
    const w = canvas.clientWidth, h = canvas.clientHeight, { axes, extent, axisOnly,profileMode } = geometry();
    const scale=Math.min(w,h)/(2*extent);
    const map = point => [w / 2 + point[axes[0]]*scale, h / 2 - point[axes[1]]*scale];
    canvas.dataset.metersPerPixel=String(1/scale);canvas.dataset.physicalAspect='equal';
    ctx.fillStyle = '#101925'; ctx.fillRect(0, 0, w, h);
    if(profileMode){
      const series=(current.profiles||[]).filter(p=>p.points?.length&&p.sampling?.status!=='unresolved').slice(0,3),[xMin,xMax]=profileDomain(),left=58,right=w-14;
      const mapX=x=>left+(x-xMin)/(xMax-xMin)*(right-left);
      ctx.font='12px sans-serif';
      if(!series.length){ctx.fillStyle='#ffd2a0';ctx.fillText('표본 해상도 제한 · 곡선을 표시하지 않습니다.',16,44);canvas.dataset.profileSeries='0';return;}
      series.forEach((data,index)=>{
        const top=28+index*(h-48)/series.length,bottom=top+(h-48)/series.length-26,values=data.points.map(p=>p.value),low=Math.min(...values),high=Math.max(...values),pad=high===low?Math.max(Math.abs(high)*.1,high===0?1:1e-20):(high-low)*.1,yMin=low-pad,yMax=high+pad,mapY=y=>bottom-(y-yMin)/(yMax-yMin)*(bottom-top);
        ctx.fillStyle='#d7e6f4';ctx.fillText(`${data.label} (${data.unit})`,left,top-8);ctx.fillText(yMax.toExponential(1),4,top+5);ctx.fillText(yMin.toExponential(1),4,bottom);
        ctx.strokeStyle='#344457';ctx.lineWidth=1;ctx.strokeRect(left,top,right-left,bottom-top);
        ctx.save();ctx.beginPath();ctx.rect(left,top,right-left,bottom-top);ctx.clip();ctx.strokeStyle=index===0?'#66e2ed':'#ffc783';ctx.lineWidth=2;ctx.beginPath();data.points.forEach((p,i)=>{const x=mapX(p.coordinate),y=mapY(p.value);if(i)ctx.lineTo(x,y);else ctx.moveTo(x,y);});ctx.stroke();
        const px=mapX(current.point[2]);ctx.strokeStyle='#fff';ctx.setLineDash([4,3]);ctx.beginPath();ctx.moveTo(px,top);ctx.lineTo(px,bottom);ctx.stroke();ctx.restore();
      });
      ctx.fillStyle='#fff';ctx.fillText(`z ${xMin.toPrecision(3)} … ${xMax.toPrecision(3)} m · 흰 선: 측정 위치`,10,h-17);
      canvas.dataset.profileSeries=String(series.length);canvas.dataset.profileXMin=String(xMin);canvas.dataset.profileXMax=String(xMax);
      return;
    }
    ctx.strokeStyle = '#344457'; ctx.lineWidth = 1;
    if(!current.definition.id.startsWith('coax-current'))for (let i = 1; i < 8; i++) { ctx.beginPath(); ctx.moveTo(i * w / 8, 0); ctx.lineTo(i * w / 8, h); ctx.moveTo(0, i * h / 8); ctx.lineTo(w, i * h / 8); ctx.stroke(); }
    const arrow = (x, y, dx, dy, color, length=14) => {
      const n = Math.hypot(dx, dy); if (!n) return;
      const ux = dx / n, uy = dy / n, head = 5;
      ctx.strokeStyle = color; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(x - ux * length / 2, y - uy * length / 2); ctx.lineTo(x + ux * length / 2, y + uy * length / 2);
      ctx.lineTo(x + ux * (length / 2 - head) - uy * head / 2, y + uy * (length / 2 - head) + ux * head / 2); ctx.moveTo(x + ux * length / 2, y + uy * length / 2); ctx.lineTo(x + ux * (length / 2 - head) + uy * head / 2, y + uy * (length / 2 - head) - ux * head / 2); ctx.stroke();
    };
    const fieldKeys = ['E', 'D', 'B', 'H'], vectorKey = current.vectorKey || fieldKeys.find(key => current.result?.vectors?.[key]) || 'E';
    if (axisOnly) {
      // An axis model gets an axis diagram, never off-axis field arrows.
      const axis = 2; // First-batch disk and loop contracts use the z axis.
      ctx.strokeStyle = '#8da9c6'; ctx.beginPath(); ctx.moveTo(w / 2, 36); ctx.lineTo(w / 2, h - 36); ctx.stroke();
      const radius = Number(current.params.radius ?? current.params.R ?? .25 * extent);
      ctx.strokeStyle = '#ffbc78'; ctx.lineWidth = 5; ctx.beginPath(); ctx.ellipse(w / 2, h / 2, radius*scale, 9, 0, 0, Math.PI * 2); ctx.stroke();
      if(current.display?.vectors!==false)for (let i = -3; i <= 3; i++) {
        const p = [0, 0, 0]; p[axis] = i * extent / 4;
        try { const result = current.definition.evaluate(current.params, p), vector = result.status === 'valid' ? result.vectors?.[vectorKey] : null; if (vector) arrow(w / 2, h / 2 - p[axis]*scale, 0, -vector[axis], '#66e2ed'); } catch { /* unsupported samples stay empty */ }
      }
      ctx.fillStyle = '#cbd8e6'; ctx.font = '13px sans-serif'; ctx.fillText('축상 모델 · 축 밖의 장은 표시하지 않음', 12, 23);
    } else {
      const coax=current.definition.id.startsWith('coax-current'),density=current.display?.density||7;
      if(current.display?.lines!==false&&(coax||current.definition.view?.kind==='azimuthal')){
        for(let i=1;i<=density;i++){const r=extent*i/(density+1);let result;try{result=current.definition.evaluate(current.params,[r,0,0]);}catch{continue;}
          const vector=result.status==='valid'?result.vectors?.[vectorKey]:null;if(!vector||!magnitude(vector))continue;
          ctx.strokeStyle='#66e2ed55';ctx.lineWidth=1.3;ctx.beginPath();ctx.arc(w/2,h/2,r*scale,0,2*Math.PI);ctx.stroke();
          for(const angle of [0,Math.PI/2,Math.PI,3*Math.PI/2]){const direction=Math.sign(vector[1]);arrow(w/2+r*scale*Math.cos(angle),h/2-r*scale*Math.sin(angle),-Math.sin(angle)*direction,-Math.cos(angle)*direction,'#66e2ed');}
        }
      }
      if(coax){const r=Math.hypot(current.point[0],current.point[1]);ctx.fillStyle='#e6c26015';ctx.beginPath();ctx.arc(w/2,h/2,r*scale,0,Math.PI*2);ctx.fill();ctx.strokeStyle='#e6c260';ctx.lineWidth=1.5;ctx.setLineDash([6,4]);ctx.stroke();ctx.setLineDash([]);}
      if(current.display?.vectors!==false)for (let iy = 1; iy < density+2; iy++) for (let ix = 1; ix < density+2; ix++) {
        const p = [...current.point]; p[axes[0]] = (ix/(density+2)-.5)*w/scale; p[axes[1]] = (.5-iy/(density+2))*h/scale;
        try { const result = current.definition.evaluate(current.params, p), vector = result.status === 'valid' ? result.vectors?.[vectorKey] : null; if (vector && magnitude(vector)) { const [x, y] = map(p),dx=vector[axes[0]],dy=-vector[axes[1]];if(dx||dy)arrow(x,y,dx,dy,'#66e2ed');else{const normal=[0,1,2].find(a=>!axes.includes(a)),positive=vector[normal]*(axes[0]===0&&axes[1]===2?-1:1)>0;ctx.strokeStyle='#66e2ed';ctx.fillStyle='#66e2ed';ctx.lineWidth=1.3;ctx.beginPath();ctx.arc(x,y,5,0,2*Math.PI);ctx.stroke();if(positive){ctx.beginPath();ctx.arc(x,y,1.7,0,2*Math.PI);ctx.fill();}else{ctx.beginPath();ctx.moveTo(x-3,y-3);ctx.lineTo(x+3,y+3);ctx.moveTo(x+3,y-3);ctx.lineTo(x-3,y+3);ctx.stroke();}} } } catch { /* no artificial field in excluded regions */ }
      }
      const kind = current.definition.view?.kind;
      if (kind === 'coax-cross-section') {
        for (const [key, color] of [['c', '#6c7788'], ['b', '#ffbc78'], ['a', '#ffbc78']]) {
          const radius = Number(current.params[key]); if (!(radius > 0)) continue;
          ctx.strokeStyle = color; ctx.lineWidth = key === 'c' ? 2 : 4; ctx.beginPath(); ctx.ellipse(w / 2, h / 2, radius*scale, radius*scale, 0, 0, Math.PI * 2); ctx.stroke();ctx.fillStyle=color;ctx.fillText(key,w/2+radius*scale+6,h/2-8);
        }
        if(coax){
          const glyph=(x,y,positive)=>{ctx.strokeStyle=positive?'#ffcf8f':'#ff8f9e';ctx.fillStyle=ctx.strokeStyle;ctx.lineWidth=1.7;if(positive){ctx.beginPath();ctx.arc(x,y,2.5,0,Math.PI*2);ctx.fill();ctx.beginPath();ctx.arc(x,y,6,0,Math.PI*2);ctx.stroke();}else{ctx.beginPath();ctx.moveTo(x-4,y-4);ctx.lineTo(x+4,y+4);ctx.moveTo(x+4,y-4);ctx.lineTo(x-4,y+4);ctx.stroke();}};
          const positive=current.params.current>=0,a=current.params.a,b=current.params.b,c=current.params.c,outer=c?(b+c)/2:b,surface=current.definition.id.endsWith('surface');
          if(current.params.current!==0){
            if(surface){for(let i=0;i<12;i++){const angle=i*Math.PI/6;glyph(w/2+a*scale*Math.cos(angle),h/2-a*scale*Math.sin(angle),positive);}}
            else{for(const [x,y]of [[0,0]])glyph(w/2+x*a*scale,h/2-y*a*scale,positive);}
            for(let i=0;i<8;i++){const angle=i*Math.PI/4;glyph(w/2+outer*scale*Math.cos(angle),h/2-outer*scale*Math.sin(angle),!positive);}
          }
          ctx.fillStyle='#ffcf8f';ctx.fillText('내부 +I · 외부 −I',12,43);ctx.fillStyle='#e6c260';ctx.fillText('점선 원: 암페어 경로 · 음영: 포함 전류의 단면',12,62);
          canvas.dataset.probeRegion=current.result.region||'';canvas.dataset.enclosedCurrent=String(current.result.scalars?.find(v=>v.key==='enclosedCurrent')?.value??'');
        }
      } else if (kind === 'plane-normal') {
        ctx.strokeStyle = '#ffbc78'; ctx.lineWidth = 4;
        if(current.definition.id==='line-finite'){
          const a=map([current.params.xStart,0,0]),b=map([current.params.xEnd,0,0]);ctx.beginPath();ctx.moveTo(...a);ctx.lineTo(...b);ctx.stroke();
          for(const p of [a,b]){ctx.fillStyle='#ffbc78';ctx.beginPath();ctx.arc(...p,5,0,Math.PI*2);ctx.fill();}
        }else{
          const heights=current.definition.id==='parallel-plate'?[0,current.params.distance]:current.definition.id==='layered-plate'?[0,current.params.d1,current.params.d1+current.params.d2]:[0];
          for(const z of heights){const y=h/2-z*scale;ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(w,y);ctx.stroke();}
        }
      } else if(current.definition.id==='faraday-loop'){
        const radius=Math.sqrt(current.params.area/Math.PI)*scale;ctx.strokeStyle='#ffbc78';ctx.lineWidth=3;ctx.beginPath();ctx.ellipse(w/2,h/2,radius,Math.max(0,Math.abs(Math.cos(current.params.theta))*radius),0,0,2*Math.PI);ctx.stroke();
        ctx.fillStyle='#ffd2a0';ctx.font='13px sans-serif';ctx.fillText(`루프 개념도 · N=${current.params.turns} · θ=${current.params.theta.toPrecision(3)} rad`,12,44);
      } else if(current.definition.id==='motional-rod'){
        const {length,railLength,velocity}=current.params,x=current.result.scalars?.find(s=>s.key==='position')?.value;
        ctx.strokeStyle='#ffbc78';ctx.lineWidth=3;for(const y of [-length/2,length/2]){const a=map([0,y,0]),b=map([railLength,y,0]);ctx.beginPath();ctx.moveTo(...a);ctx.lineTo(...b);ctx.stroke();}
        if(Number.isFinite(x)){const a=map([x,-length/2,0]),b=map([x,length/2,0]);ctx.strokeStyle='#ff859b';ctx.lineWidth=5;ctx.beginPath();ctx.moveTo(...a);ctx.lineTo(...b);ctx.stroke();const center=map([x,0,0]);arrow(center[0],center[1],velocity,0,'#ffc783');}
        if(current.params.closedCircuit===1){const a=map([0,-length/2,0]),b=map([0,length/2,0]);ctx.strokeStyle='#ffc783';ctx.beginPath();ctx.moveTo(...a);ctx.lineTo(...b);ctx.stroke();}
        ctx.fillStyle='#ffd2a0';ctx.font='13px sans-serif';ctx.fillText(`레일·이동도선 · v=${velocity} m/s · B는 z 방향`,12,44);
      } else { ctx.fillStyle = '#ffbc78'; ctx.beginPath(); ctx.arc(w / 2, h / 2, 9, 0, Math.PI * 2); ctx.fill(); }
      if(current.definition.id.startsWith('gauss-')||current.definition.id==='ampere-wire'){
        ctx.strokeStyle='#c3a1ff';ctx.lineWidth=2;ctx.setLineDash([7,5]);
        if(current.definition.id==='gauss-sheet'){
          const half=Math.sqrt(current.params.area)/2,z=current.params.centerZ,hz=current.params.halfHeight,a=map([-half,0,z+hz]),b=map([half,0,z-hz]);ctx.strokeRect(a[0],a[1],b[0]-a[0],b[1]-a[1]);
        }else{const center=map([0,0,current.params.centerZ||0]),radius=(current.params.pathRadius??current.params.radius)*scale;ctx.beginPath();ctx.arc(...center,radius,0,Math.PI*2);ctx.stroke();}
        ctx.setLineDash([]);ctx.fillStyle='#decfff';ctx.font='13px sans-serif';ctx.fillText(current.definition.id==='ampere-wire'?'점선: 암페어 경로 (방향은 입력 조건)':'점선: 가우스면 단면 (3D 플럭스는 수치검증)',12,44);
      }
      if(['dielectric-interface','layered-plate'].includes(current.definition.id)){
        ctx.fillStyle='#decfff';ctx.font='13px sans-serif';ctx.fillText(`εr1=${current.params.epsilon1R} · εr2=${current.params.epsilon2R} · 선: 재료/도체 경계`,12,44);
      }
      ctx.fillStyle = '#cbd8e6'; ctx.font = '13px sans-serif'; ctx.fillText(`${'xyz'[axes[0]]}${'xyz'[axes[1]]} 단면 · ${vectorKey} 방향`, 12, 23);
    }
    const [px, py] = axisOnly ? [w / 2, h / 2 - current.point[2]*scale] : map(current.point);
    if(current.result.status==='valid'){const vector=current.result.vectors?.[vectorKey];if(vector)arrow(px,py,vector[axes[0]],-vector[axes[1]],'#ffd36f',32);}
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(px, py, 10, 0, Math.PI * 2); ctx.moveTo(px - 16, py); ctx.lineTo(px + 16, py); ctx.moveTo(px, py - 16); ctx.lineTo(px, py + 16); ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.font = '12px sans-serif';
    if(current.definition.id.startsWith('coax-current'))ctx.fillText('흰 점: 관측 위치 · 점선: 관측 반경',12,h-16);else{
    ctx.fillText(axisOnly?`z ±${(h/(2*scale)).toPrecision(3)} m · 흰 원: 측정점`:`${'xyz'[axes[0]]} ±${(w/(2*scale)).toPrecision(2)} / ${'xyz'[axes[1]]} ±${(h/(2*scale)).toPrecision(2)} m · 등축비`,12,h-30);
    ctx.fillText('화살표: 장 방향 · 길이는 크기와 무관',12,h-13);
    }
  }
  const move = event => {
    if (!active || !current) return;
    const { axes, extent, axisOnly,profileMode } = geometry(), r = canvas.getBoundingClientRect(), point = [...current.point],scale=Math.min(canvas.clientWidth,canvas.clientHeight)/(2*extent);
    if(profileMode){const [lo,hi]=profileDomain();point[0]=0;point[1]=0;point[2]=lo+(event.clientX-r.left-58)/(r.width-72)*(hi-lo);onProbe(point);return;}
    if (axisOnly) { point[0] = 0; point[1] = 0; point[2] = (canvas.clientHeight/2-(event.clientY-r.top-canvas.clientTop))/scale; }
    else { point[axes[0]] = (event.clientX-r.left-canvas.clientLeft-canvas.clientWidth/2)/scale; point[axes[1]] = (canvas.clientHeight/2-(event.clientY-r.top-canvas.clientTop))/scale; }
    onProbe(point);
  };
  canvas.addEventListener('pointerdown', event => { if (!active || event.button !== 0) return; dragging = true; canvas.setPointerCapture(event.pointerId); move(event); }, { signal: events.signal });
  // Pointer moves are merged to one probe update per animation frame; the last position is flushed when the drag ends.
  let pendingMove = null, moveFrame = null;
  const flushMove = () => { if (moveFrame !== null) { cancelAnimationFrame(moveFrame); moveFrame = null; } const pending = pendingMove; pendingMove = null; if (pending && dragging && active && current) move(pending); };
  canvas.addEventListener('pointermove', event => { if (!dragging) return; pendingMove = { clientX: event.clientX, clientY: event.clientY }; if (moveFrame === null) moveFrame = requestAnimationFrame(() => { moveFrame = null; flushMove(); }); }, { signal: events.signal });
  const end = () => { flushMove(); dragging = false; };
  for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) canvas.addEventListener(name, end, { signal: events.signal });
  canvas.addEventListener('keydown', event => {
    if (!active || !current || !['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home'].includes(event.key)) return;
    event.preventDefault();
    if (event.key === 'Home') { onProbe([...current.definition.probeDefault]); return; }
    const {axes,extent,axisOnly,profileMode}=geometry(),point=[...current.point],vertical=['ArrowUp','ArrowDown'].includes(event.key);
    if(profileMode){if(vertical)return;const [lo,hi]=profileDomain();point[2]+=(event.key==='ArrowLeft'?-1:1)*(hi-lo)*.025;onProbe(point);return;}
    if(axisOnly&&!vertical)return;
    const axis=axisOnly?2:axes[vertical?1:0],sign=['ArrowLeft','ArrowDown'].includes(event.key)?-1:1;
    point[axis]+=sign*extent*.05;onProbe(point);
  },{signal:events.signal});
  window.addEventListener('resize', render, { signal: events.signal });
  return { update(value) { current = value; render(); }, activate() { active = true; render(); }, deactivate() { pendingMove = null; if (moveFrame !== null) { cancelAnimationFrame(moveFrame); moveFrame = null; } active = false; dragging = false; }, destroy() { events.abort(); pendingMove = null; if (moveFrame !== null) { cancelAnimationFrame(moveFrame); moveFrame = null; } active = false; }, inspect() { return { active, dragging }; } };
}


// This view transforms the producer's sampled profile; it does not solve a field.
export function createRadialProfileView(canvas,onRadius){
  const events=new AbortController();let current=null,active=false,dragging=false,domain=[0,1],factor=1;
  function render(){
    if(!active||!current||canvas.hidden||!canvas.clientWidth||!canvas.clientHeight)return;
    const ctx=canvas.getContext('2d'),dpr=Math.min(1.5,devicePixelRatio||1),w=canvas.clientWidth,h=canvas.clientHeight;
    prepareCanvas(canvas,ctx,dpr);ctx.fillStyle='#101925';ctx.fillRect(0,0,w,h);
    const series=current.profiles?.find(p=>p.key==='Bphi'),points=series?.points||[];if(!points.length){canvas.dataset.profileSeries='0';return;}
    factor=current.normalized?current.params.a:1;
    const mu=current.result.scalars?.find(s=>s.key==='permeability')?.value;
    const normalizer=current.normalized?mu*current.params.current/(2*Math.PI*current.params.a):1;
    const normalized=current.normalized&&Number.isFinite(normalizer)&&normalizer!==0;
    const values=points.map(p=>p.value/(normalized?normalizer:1)),low=Math.min(0,...values),high=Math.max(...values),pad=high===low?1:(high-low)*.12;
    const yMin=low-pad,yMax=high+pad;domain=[Math.min(...points.map(p=>p.coordinate))/factor,Math.max(...points.map(p=>p.coordinate))/factor];
    const left=58,right=w-18,top=34,bottom=h-40,mapX=x=>left+(x-domain[0])/(domain[1]-domain[0])*(right-left),mapY=y=>bottom-(y-yMin)/(yMax-yMin)*(bottom-top);
    ctx.font='12px sans-serif';ctx.fillStyle='#d7e6f4';ctx.fillText(normalized?'Bφ/B₀ · B₀=μI/(2πa)':'Bφ (T)'+(current.normalized?' · I=0: 정규화 없음':''),12,20);ctx.fillText(yMax.toPrecision(3),3,top+5);ctx.fillText(yMin.toPrecision(3),3,bottom);
    ctx.strokeStyle='#344457';ctx.strokeRect(left,top,right-left,bottom-top);
    ctx.save();ctx.beginPath();ctx.rect(left,top,right-left,bottom-top);ctx.clip();
    for(const key of ['a','b','c']){if(!current.params[key])continue;const x=mapX(current.params[key]/factor);ctx.strokeStyle='#ffbc7870';ctx.setLineDash([3,4]);ctx.beginPath();ctx.moveTo(x,top);ctx.lineTo(x,bottom);ctx.stroke();ctx.fillStyle='#ffbc78';ctx.fillText(key,x+4,top+14);}
    ctx.setLineDash([]);ctx.strokeStyle='#66e2ed';ctx.lineWidth=2;ctx.beginPath();points.forEach((p,i)=>{const x=mapX(p.coordinate/factor),y=mapY(values[i]);if(!i||p.breakBefore)ctx.moveTo(x,y);else ctx.lineTo(x,y);});ctx.stroke();
    const radius=Math.hypot(current.point[0],current.point[1]),cursor=radius/factor,x=mapX(cursor);ctx.strokeStyle='#f0ca6c';ctx.setLineDash([5,4]);ctx.beginPath();ctx.moveTo(x,top);ctx.lineTo(x,bottom);ctx.stroke();ctx.setLineDash([]);
    const value=current.result.scalars?.find(s=>s.key==='Bphi')?.value;if(Number.isFinite(value)){ctx.fillStyle='#f0ca6c';ctx.beginPath();ctx.arc(x,mapY(value/(normalized?normalizer:1)),5,0,2*Math.PI);ctx.fill();}ctx.restore();
    ctx.fillStyle='#fff';ctx.fillText((current.normalized?'r/a':'r (m)')+' · '+domain[0].toPrecision(3)+' … '+domain[1].toPrecision(3)+' · 드래그로 관측점 이동',12,h-15);
    canvas.dataset.profileSeries='1';canvas.dataset.radius=String(radius);canvas.dataset.cursor=String(cursor);canvas.dataset.normalized=String(normalized);canvas.dataset.profileXMin=String(domain[0]);canvas.dataset.profileXMax=String(domain[1]);canvas.dataset.probeRegion=current.result.region||'';
  }
  const move=event=>{if(!active||!current)return;const r=canvas.getBoundingClientRect(),fraction=Math.max(0,Math.min(1,(event.clientX-r.left-58)/(r.width-76)));onRadius((domain[0]+fraction*(domain[1]-domain[0]))*factor);};
  canvas.addEventListener('pointerdown',event=>{if(!active||event.button!==0)return;dragging=true;canvas.setPointerCapture(event.pointerId);move(event);},{signal:events.signal});
  canvas.addEventListener('pointermove',event=>{if(dragging)move(event);},{signal:events.signal});
  for(const name of ['pointerup','pointercancel','lostpointercapture'])canvas.addEventListener(name,()=>{dragging=false;},{signal:events.signal});
  canvas.addEventListener('keydown',event=>{if(!active||!current||!['ArrowLeft','ArrowRight','Home'].includes(event.key))return;event.preventDefault();const radius=Math.hypot(current.point[0],current.point[1]);onRadius(event.key==='Home'?Math.hypot(...current.definition.probeDefault.slice(0,2)):Math.max(0,radius+(event.key==='ArrowLeft'?-1:1)*(domain[1]-domain[0])*factor*.025));},{signal:events.signal});
  window.addEventListener('resize',render,{signal:events.signal});
  return{update(value){current=value;render();},activate(){active=true;render();},deactivate(){active=false;dragging=false;},destroy(){events.abort();active=false;},inspect(){return{active,dragging,domain:[...domain],factor};}};
}
