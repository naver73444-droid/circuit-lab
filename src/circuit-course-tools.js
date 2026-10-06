// The live course tools in tab order (ids are the data-circuit-course-tool values). Pure.
import { COMPLEX_TOOL, THREE_PHASE_TOOL, LOADS_TOOL, MAXPOWER_TOOL } from './circuit-course-tool-defs.js';
import { COUPLED_TOOL, TRANSFORMER_TOOL } from './circuit-course-tool-coupled.js';

export const TOOLS = Object.freeze([COMPLEX_TOOL, THREE_PHASE_TOOL, LOADS_TOOL, MAXPOWER_TOOL, COUPLED_TOOL, TRANSFORMER_TOOL]);
export const getTool = id => TOOLS.find(t => t.id === id) ?? null;
