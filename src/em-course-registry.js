import { EXPERIMENTS as electrostatics } from './em-course-electrostatics.js';
import { EXPERIMENTS as coaxial } from './em-course-coaxial.js';
import { EXPERIMENTS as magnetostatics } from './em-course-magnetostatics.js';
import { EXPERIMENTS as boundaries } from './em-course-boundaries.js';
import { EXPERIMENTS as integrals } from './em-course-integrals.js';
import { EXPERIMENTS as induction } from './em-course-induction.js';
import { EXPERIMENTS as waves } from './em-course-waves.js';
import { EXPERIMENTS as transmission } from './em-course-transmission.js';

export const EXPERIMENTS = Object.freeze([...electrostatics, ...coaxial, ...magnetostatics,...boundaries,...integrals,...induction,...waves,...transmission]);
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
  { title: '자기유도', status: 'implemented', description: '2실험: 고정 루프의 Faraday/Lenz 기전력, 이동도선의 운동기전력. 공간 유도E·상호인덕턴스는 미지원' },
  { title: '파동 · 전송선', status: 'implemented', description: '3실험: 균질 무손실 매질파, 평면경계 수직입사 반사, 무손실 전송선·복소부하·정재파' },
  { title: '미지원 · 후속 확장', status: 'planned', description: '임의 형상 경계값/PDE·유한면 일반 위치·사입사·손실/분산·고차모드·안테나·공간 유도장·상호인덕턴스. 전체 학부의 모든 주제 완료를 뜻하지 않음' },
]);
