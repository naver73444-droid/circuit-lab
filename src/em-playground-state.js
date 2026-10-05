import {
  MAX_POINT_SOURCES,
  PointChargeInputError,
  evaluatePointChargeWorld,
  validatePoint,
  validatePointSources,
} from './em-playground-physics.js';

const clone = value => structuredClone(value);
const samePoint = (a, b) => a.every((value, index) => value === b[index]);

function parseDraft(draft) {
  const text = key => String(draft[key] ?? '').trim(), numbers = keys => keys.map(key => { if (!text(key)) throw new PointChargeInputError('원천 입력의 빈값은 적용할 수 없습니다.'); const value=Number(text(key));if(!Number.isFinite(value))throw new PointChargeInputError('원천 입력은 유한한 숫자여야 합니다.');return value; });
  if (draft.type === 'finite-line') { const [lambda,...coordinates]=numbers(['lambda','ax','ay','az','bx','by','bz']);return{lambda:lambda*1e-9,start:validatePoint(coordinates.slice(0,3),'유한선 시작점'),end:validatePoint(coordinates.slice(3),'유한선 끝점')}; }
  if (draft.type === 'infinite-line') { const [lambda,...values]=numbers(['lambda','px','py','pz','dx','dy','dz','sRef','displayLength']);return{lambda:lambda*1e-9,position:validatePoint(values.slice(0,3),'무한선 기준점'),direction:values.slice(3,6),sRef:values[6],displayLength:values[7]}; }
  const [qNc,...position]=numbers(['q','x','y','z']);
  return { q: qNc * 1e-9, position: validatePoint(position, '점전하 좌표') };
}

const sourcePosition = source => source.type === 'finite-line' ? source.start.map((value,axis)=>(value+source.end[axis])/2) : source.position;

export function createPointChargeEditor(initial = {}) {
  let nextId = 1;
  let revision = 0;
  let calculationToken = 0;
  const initialSources = initial.sources ?? [
    { id: 'q1', q: 1e-9, position: [-0.75, 0, 0], enabled: true, visible: true },
    { id: 'q2', q: -1e-9, position: [0.75, 0, 0], enabled: true, visible: true },
  ];
  const state = {
    sources: validatePointSources(initialSources),
    selectedId: initial.selectedId ?? initialSources[0]?.id ?? null,
    probe: validatePoint(initial.probe ?? [0, 1, 0], '측정점'),
    plane: initial.plane ?? 'xy',
    draft: null,
    error: null,
    previous: false,
    drag: null,
    past: [],
    future: [],
    comparison: null,
    revision,
    calculationToken,
  };

  const physicsSnapshot = () => ({ sources: clone(state.sources), probe: [...state.probe] });
  const mark = () => { revision += 1; calculationToken += 1; state.revision = revision; state.calculationToken = calculationToken; };
  const result = () => evaluatePointChargeWorld(state.sources, state.probe);
  const record = before => { state.past.push(before); state.future = []; };
  const restore = snapshot => {
    state.sources = clone(snapshot.sources);
    state.probe = [...snapshot.probe];
    state.selectedId = snapshot.selectedId && state.sources.some(source => source.id === snapshot.selectedId) ? snapshot.selectedId : null;
    state.draft = null;
    state.error = null;
    state.previous = false;
    state.drag = null;
    mark();
  };
  const historySnapshot = () => ({ ...physicsSnapshot(), selectedId: state.selectedId });
  const selected = () => state.sources.find(source => source.id === state.selectedId) ?? null;
  const freshId = () => { const used=new Set(state.sources.map(source=>source.id));while(used.has(`q${nextId}`))nextId+=1;return`q${nextId++}`; };
  const inspect = () => clone({ ...state, result: result() });

  return {
    state,
    inspect,
    evaluate: result,
    select(id) {
      if (id != null && !state.sources.some(source => source.id === id)) return false;
      if (state.drag) this.cancelDrag();
      state.selectedId = id;
      if (!state.draft) state.error = null;
      else { state.previous = true; state.error ||= '입력 적용 전'; }
      mark();
      return true;
    },
    beginDraft(id = state.selectedId) {
      const source = state.sources.find(item => item.id === id);
      if (!source) return false;
      if (state.draft && state.draft.id !== id) {
        state.error = `점전하 ${state.draft.id}의 입력을 먼저 적용하거나 취소하세요.`;
        state.previous = true;
        mark();
        return false;
      }
      if (state.drag) this.cancelDrag();
      state.selectedId = id;
      state.draft = source.type === 'finite-line'
        ? { id, type:source.type, lambda:String(source.lambda*1e9), ax:String(source.start[0]), ay:String(source.start[1]), az:String(source.start[2]), bx:String(source.end[0]), by:String(source.end[1]), bz:String(source.end[2]) }
        : source.type === 'infinite-line'
          ? { id, type:source.type, lambda:String(source.lambda*1e9), px:String(source.position[0]), py:String(source.position[1]), pz:String(source.position[2]), dx:String(source.direction[0]), dy:String(source.direction[1]), dz:String(source.direction[2]), sRef:String(source.sRef), displayLength:String(source.displayLength) }
          : { id, type:'point', q: String(source.q * 1e9), x: String(source.position[0]), y: String(source.position[1]), z: String(source.position[2]) };
      state.previous = true;
      state.error = '입력 적용 전';
      mark();
      return true;
    },
    setDraft(key, value) {
      if (state.draft && state.draft.id !== state.selectedId) {
        state.error = `점전하 ${state.draft.id}의 입력을 먼저 적용하거나 취소하세요.`;
        state.previous = true;
        mark();
        return false;
      }
      if (!state.draft) this.beginDraft();
      if (!state.draft || !['q','x','y','z','lambda','ax','ay','az','bx','by','bz','px','py','pz','dx','dy','dz','sRef','displayLength'].includes(key)) return false;
      state.draft[key] = String(value);
      state.previous = true;
      try { parseDraft(state.draft); state.error = '입력 적용 전'; } catch (error) { state.error = error.message; }
      mark();
      return true;
    },
    applyDraft() {
      if (!state.draft) return false;
      const index = state.sources.findIndex(source => source.id === state.draft.id);
      if (index < 0) return false;
      try {
        const fields = parseDraft(state.draft);
        const before = historySnapshot();
        const next = clone(state.sources);
        next[index] = { ...next[index], ...fields };
        state.sources = validatePointSources(next);
        record(before);
        state.draft = null;
        state.error = null;
        state.previous = false;
        mark();
        return true;
      } catch (error) {
        state.error = error.message;
        state.previous = true;
        mark();
        return false;
      }
    },
    cancelDraft() {
      if (!state.draft) return false;
      state.draft = null;
      state.error = null;
      state.previous = false;
      mark();
      return true;
    },
    add(q = 1e-9, position = [0, 0, 0]) {
      if (state.draft) { state.error = '미확정 입력을 먼저 적용하거나 취소하세요.'; state.previous = true; mark(); return null; }
      if (state.sources.length >= MAX_POINT_SOURCES) { state.error = `점전하는 최대 ${MAX_POINT_SOURCES}개입니다.`; mark(); return null; }
      const before = historySnapshot();
      const id = freshId();
      try { state.sources = validatePointSources([...state.sources, { id, q, position, enabled: true, visible: true }]); }
      catch (error) { state.error = error.message; state.previous = true; mark(); return null; }
      state.selectedId = id;
      record(before);
      state.draft = null;
      state.error = null;
      state.previous = false;
      mark();
      return id;
    },
    addFiniteLine(lambda = 1e-9, start = [0, 0, -1], end = [0, 0, 1]) {
      if (state.draft || state.sources.length >= MAX_POINT_SOURCES) { state.error=state.draft?'미확정 입력을 먼저 적용하거나 취소하세요.':`원천은 최대 ${MAX_POINT_SOURCES}개입니다.`;state.previous=Boolean(state.draft);mark();return null; }
      const before=historySnapshot(),id=freshId();try{state.sources=validatePointSources([...state.sources,{id,type:'finite-line',lambda,start,end,enabled:true,visible:true}]);}catch(error){state.error=error.message;state.previous=true;mark();return null;}state.selectedId=id;record(before);state.error=null;state.previous=false;mark();return id;
    },
    addInfiniteLine(lambda = 1e-9, position = [0, 0, 0], direction = [0, 0, 1], sRef = 1) {
      if (state.draft || state.sources.length >= MAX_POINT_SOURCES) { state.error=state.draft?'미확정 입력을 먼저 적용하거나 취소하세요.':`원천은 최대 ${MAX_POINT_SOURCES}개입니다.`;state.previous=Boolean(state.draft);mark();return null; }
      const before=historySnapshot(),id=freshId();try{state.sources=validatePointSources([...state.sources,{id,type:'infinite-line',lambda,position,direction,sRef,displayLength:4,enabled:true,visible:true}]);}catch(error){state.error=error.message;state.previous=true;mark();return null;}state.selectedId=id;record(before);state.error=null;state.previous=false;mark();return id;
    },
    cloneSelected() {
      if (state.draft) { state.error = '미확정 입력을 먼저 적용하거나 취소하세요.'; state.previous = true; mark(); return null; }
      const source = selected();if(!source)return null;
      if(source.type==='finite-line')return this.addFiniteLine(source.lambda,source.start.map((v,i)=>v+(i===0?.2:0)),source.end.map((v,i)=>v+(i===0?.2:0)));
      if(source.type==='infinite-line')return this.addInfiniteLine(source.lambda,source.position.map((v,i)=>v+(i===0?.2:0)),source.direction,source.sRef);
      return this.add(source.q, source.position.map((value, index) => value + (index === 0 ? 0.2 : 0)));
    },
    removeSelected() {
      if (state.draft) { state.error = '미확정 입력을 먼저 적용하거나 취소하세요.'; state.previous = true; mark(); return false; }
      const index = state.sources.findIndex(source => source.id === state.selectedId);
      if (index < 0) return false;
      const before = historySnapshot();
      state.sources = state.sources.filter((_, sourceIndex) => sourceIndex !== index);
      state.selectedId = null;
      state.draft = null;
      state.drag = null;
      record(before);
      state.error = null;
      state.previous = false;
      mark();
      return true;
    },
    setEnabled(id, enabled) {
      const index = state.sources.findIndex(source => source.id === id);
      if (index < 0) return false;
      const before = historySnapshot();
      state.sources[index] = { ...state.sources[index], enabled: Boolean(enabled) };
      record(before);
      if (state.draft) { state.previous = true; state.error ||= '입력 적용 전'; }
      mark(); return true;
    },
    setVisible(id, visible) {
      const index = state.sources.findIndex(source => source.id === id);
      if (index < 0) return false;
      state.sources[index] = { ...state.sources[index], visible: Boolean(visible) };
      mark(); return true;
    },
    setProbe(point, { recordHistory = false } = {}) {
      try {
        const validated = validatePoint(point, '측정점');
        if (recordHistory) record(historySnapshot());
        state.probe = validated;
        if (!state.draft) { state.error = null; state.previous = false; }
        else { state.previous = true; state.error ||= '입력 적용 전'; }
        mark();
        return true;
      } catch (error) { state.error = error.message; state.previous = true; mark(); return false; }
    },
    setPlane(plane) {
      if (!['xy', 'xz', 'yz'].includes(plane)) return false;
      if (state.drag) this.cancelDrag();
      state.plane = plane;
      if (state.draft) { state.previous = true; state.error ||= '입력 적용 전'; }
      mark();
      return true;
    },
    beginDrag(id, plane = state.plane, handle = 'body', anchor = null) {
      if (state.draft) { state.error = '미확정 입력을 적용하거나 취소한 뒤 끌 수 있습니다.'; state.previous = true; mark(); return false; }
      const source = state.sources.find(item => item.id === id);
      if (!source || !['xy', 'xz', 'yz'].includes(plane)) return false;
      state.selectedId = id;
      state.drag = { id, plane, handle, anchor:anchor?[...anchor]:sourcePosition(source), before: historySnapshot(), sourceBefore:clone(source), origin: [...sourcePosition(source)] };
      state.error = null;
      state.previous = false;
      mark();
      return true;
    },
    previewDrag(position) {
      if (!state.drag) return false;
      try {
        const nextPosition = validatePoint(position, '끌기 좌표');
        const index = state.sources.findIndex(source => source.id === state.drag.id);
        if (index < 0) return false;
        const next = clone(state.sources),source=state.drag.sourceBefore,delta=nextPosition.map((value,axis)=>value-state.drag.anchor[axis]);
        if(source.type==='finite-line'){
          if(state.drag.handle==='start')next[index]={...next[index],start:nextPosition};
          else if(state.drag.handle==='end')next[index]={...next[index],end:nextPosition};
          else next[index]={...next[index],start:source.start.map((v,i)=>v+delta[i]),end:source.end.map((v,i)=>v+delta[i])};
        }else if(source.type==='infinite-line'){
          if(state.drag.handle==='direction')next[index]={...next[index],direction:nextPosition.map((v,i)=>v-source.position[i])};
          else next[index]={...next[index],position:source.position.map((v,i)=>v+delta[i])};
        }else next[index]={...next[index],position:nextPosition};
        state.sources = validatePointSources(next);
        mark();
        return true;
      } catch (error) { state.error = error.message; mark(); return false; }
    },
    commitDrag(position = null) {
      if (!state.drag) return false;
      if (position && !this.previewDrag(position)) { const message = state.error; this.cancelDrag(); state.error = message; state.previous = true; mark(); return false; }
      const drag = state.drag;
      const source = state.sources.find(item => item.id === drag.id);
      state.drag = null;
      if (!source || JSON.stringify(source)===JSON.stringify(drag.sourceBefore)) { mark(); return false; }
      record(drag.before);
      state.error = null;
      state.previous = false;
      mark();
      return true;
    },
    cancelDrag() {
      if (!state.drag) return false;
      const before = state.drag.before;
      state.sources = clone(before.sources);
      state.probe = [...before.probe];
      state.selectedId = before.selectedId;
      state.drag = null;
      state.error = null;
      state.previous = false;
      mark();
      return true;
    },
    undo() {
      if (state.drag) this.cancelDrag();
      if (state.draft) { state.error = '미확정 입력을 적용하거나 취소한 뒤 undo할 수 있습니다.'; state.previous = true; mark(); return false; }
      const previous = state.past.pop();
      if (!previous) return false;
      state.future.push(historySnapshot());
      restore(previous);
      return true;
    },
    redo() {
      if (state.drag) this.cancelDrag();
      if (state.draft) { state.error = '미확정 입력을 적용하거나 취소한 뒤 redo할 수 있습니다.'; state.previous = true; mark(); return false; }
      const next = state.future.pop();
      if (!next) return false;
      state.past.push(historySnapshot());
      restore(next);
      return true;
    },
    captureComparison() {
      state.comparison = { ...physicsSnapshot(), result: clone(result()), revision };
      mark();
      return clone(state.comparison);
    },
    clearComparison() { state.comparison = null; mark(); },
    replaceWorld(project) {
      const sources=validatePointSources(project.sources),probe=validatePoint(project.probe,'측정점'),plane=project.plane;
      if(!['xy','xz','yz'].includes(plane))throw new PointChargeInputError('EM 단면은 xy/xz/yz 중 하나여야 합니다.');
      const selectedId=project.selectedId==null?null:String(project.selectedId);if(selectedId&&!sources.some(source=>source.id===selectedId))throw new PointChargeInputError('선택 ID가 저장 원천에 없습니다.');
      let comparison=null;if(project.comparison){const comparisonSources=validatePointSources(project.comparison.sources),comparisonProbe=validatePoint(project.comparison.probe,'비교 측정점');comparison={sources:clone(comparisonSources),probe:[...comparisonProbe],result:evaluatePointChargeWorld(comparisonSources,comparisonProbe),revision:revision+1};}
      state.sources=clone(sources);state.probe=[...probe];state.plane=plane;state.selectedId=selectedId;state.comparison=comparison;state.draft=null;state.drag=null;state.error=null;state.previous=false;state.past=[];state.future=[];
      nextId=1;mark();return true;
    },
    invalidateAsync() { calculationToken += 1; state.calculationToken = calculationToken; },
  };
}
