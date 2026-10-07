import { EXPERIMENTS as electrostatics } from './em-course-electrostatics.js';
import { EXPERIMENTS as coaxial } from './em-course-coaxial.js';
import { EXPERIMENTS as magnetostatics } from './em-course-magnetostatics.js';
import { EXPERIMENTS as boundaries } from './em-course-boundaries.js';
import { EXPERIMENTS as integrals } from './em-course-integrals.js';
import { EXPERIMENTS as induction } from './em-course-induction.js';
import { EXPERIMENTS as waves } from './em-course-waves.js';
import { EXPERIMENTS as transmission } from './em-course-transmission.js';
// Hayt Ch.8 lecture groups (6주차): forces & torque, materials & boundaries, magnetic circuit, energy & inductance.
import { EXPERIMENTS as forces } from './em-course-forces.js';
import { EXPERIMENTS as materials } from './em-course-materials.js';
import { EXPERIMENTS as magneticCircuit } from './em-course-magnetic-circuit.js';
import { EXPERIMENTS as magneticParallel } from './em-course-magnetic-parallel.js';
import { EXPERIMENTS as inductance } from './em-course-inductance.js';
import { EXPERIMENTS as virtualWork } from './em-course-virtual-work.js';

export const EXPERIMENTS = Object.freeze([...electrostatics, ...coaxial, ...magnetostatics, ...boundaries, ...integrals, ...induction, ...waves, ...transmission,
  ...forces, ...materials, ...magneticCircuit, ...magneticParallel, ...inductance, ...virtualWork]);
const byId = new Map();
for (const experiment of EXPERIMENTS) {
  if (!experiment?.id || !experiment.title || typeof experiment.evaluate !== 'function') {
    throw new TypeError('대학 전자기학 실험 정의가 올바르지 않습니다.');
  }
  if (byId.has(experiment.id)) throw new Error('중복 실험 ID: ' + experiment.id);
  byId.set(experiment.id, experiment);
}
export const getExperiment = id => byId.get(id);
export const COURSE_ROADMAP = Object.freeze([
  { title: '정전계 · 정전용량 · 정자계', status: 'implemented', description: '12실험: 유한/무한 선전하, 무한면·원판축, 평행판, 고정전하/전압 동축, 직선전류·루프축, 동축 전류(얇은·두꺼운·면)' },
  { title: '경계조건 · 가우스 · 암페어', status: 'implemented', description: '6실험: 평면 유전체 경계·층상 평행판, 점/선/면 가우스면, 직선전류 암페어 경로' },
  { title: '자기유도', status: 'implemented', description: '2실험: 고정 루프의 Faraday/Lenz 기전력, 이동도선의 운동기전력. 공간 유도E는 미지원(인덕턴스 L·M은 아래 8장 묶음)' },
  { title: '파동 · 전송선', status: 'implemented', description: '3실험: 균질 무손실 매질파, 평면경계 수직입사 반사, 무손실 전송선·복소부하·정재파' },
  { title: '자기력 · 토크 (Hayt 8.1–8.4, 6주차)', status: 'implemented', description: '7실험: 로런츠 원운동, 직선전류 옆 직사각 루프, 평행 도선·면전류판, 솔레노이드 자기압, 루프 토크 τ=m×B, 쌍극자 원거리 장' },
  { title: '자성체 · 경계 (Hayt 8.5–8.7, 6주차)', status: 'implemented', description: '4실험: 자화·구속전류(막대자석), 자화율·투자율, 자기 경계조건·굴절, 철/초전도체 위 선전류의 영상' },
  { title: '자기회로 (Hayt 8.8, 6주차)', status: 'implemented', description: '3실험: 공극 코어의 NI·B(비선형 B–H 표, 반복 풀이), 히스테리시스 루프와 손실(개념 모형), 3다리 코어의 병렬 자기회로 자속 분배(선형 μ_r, 공극 g₂ 스윕). 병렬 회로의 비선형 B–H는 미지원' },
  { title: '에너지 · 인덕턴스 (Hayt 8.9–8.10, 6주차)', status: 'implemented', description: '6실험: 솔레노이드·동축·토로이드 L, 상호 인덕턴스와 직렬 연결, 가상변위법(공극 흡인력, 두 솔레노이드 힘)' },
  { title: '전자기1 복습 (6주차)', status: 'implemented', description: '새 실험 없이 기존 실험으로 복습: 가우스(gauss-*), 전위·평행판·정전용량, 유전체 경계, 정자계 암페어(ampere-wire, coax-current*), 직선전류·루프 B' },
  { title: '미지원 · 후속 확장', status: 'planned', description: '임의 형상 경계값/PDE·유한면 일반 위치·사입사·손실/분산·고차모드·안테나·공간 유도장·비선형 병렬 자기회로·curl/Stokes·벡터퍼텐셜 지도. 전체 학부의 모든 주제 완료를 뜻하지 않음' },
]);
