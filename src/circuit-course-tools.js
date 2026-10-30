// The live course tools in tab order (ids are the data-circuit-course-tool values). Pure.
import { COMPLEX_TOOL, THREE_PHASE_TOOL, LOADS_TOOL, MAXPOWER_TOOL } from './circuit-course-tool-defs.js';
import { COUPLED_TOOL, TRANSFORMER_TOOL } from './circuit-course-tool-coupled.js';
import { BODE_TOOL, RESONANCE_TOOL } from './circuit-course-tool-freq.js';
import { FILTER_TOOL, SCALING_TOOL } from './circuit-course-tool-filters.js';

export const TOOLS = Object.freeze([COMPLEX_TOOL, THREE_PHASE_TOOL, LOADS_TOOL, MAXPOWER_TOOL, COUPLED_TOOL, TRANSFORMER_TOOL, BODE_TOOL, RESONANCE_TOOL, FILTER_TOOL, SCALING_TOOL]);
export const getTool = id => TOOLS.find(t => t.id === id) ?? null;
