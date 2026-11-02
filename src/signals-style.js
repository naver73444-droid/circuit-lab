// Stylesheet of the signals workspace. Colors come only from the app theme tokens (styles.css),
// so dark and light themes both work. Injected once per document by ensureCourseStyle.
export const SIGNALS_STYLE = `
.sg{box-sizing:border-box;max-width:1180px;margin:0 auto;padding:clamp(10px,2.2vw,22px);color:var(--text);font:var(--fs-md)/1.55 var(--font-sans)}
.sg *{box-sizing:border-box}
.sg [hidden]{display:none!important}
.sg-tabs{display:grid;grid-template-columns:repeat(auto-fit,minmax(104px,1fr));gap:6px;margin:0 0 12px}
.sg-tabs button{min-height:40px;padding:4px 6px;font-size:var(--fs-body);line-height:1.25;border-radius:var(--radius-sm);overflow-wrap:anywhere}
.sg-tabs button[aria-current=step]{background:var(--selection);border-color:var(--accent);font-weight:var(--fw-semibold)}
.sg-ref{margin:0 0 10px}.sg-ref label{display:flex;align-items:center;gap:8px;font-size:var(--fs-body);color:var(--muted)}.sg-ref select{min-height:40px;flex:1 1 auto;max-width:100%;font-size:var(--fs-md)}
.sg-head{display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 12px;margin:0 0 8px}
.sg-head h2{margin:0;font-size:var(--fs-lg);font-weight:var(--fw-semibold)}
.sg-head span{color:var(--muted);font-size:var(--fs-sm)}
.sg-steps{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:6px;margin:0 0 8px}
.sg-steps button{min-height:38px;padding:4px 6px;font-size:var(--fs-body);line-height:1.25;border-radius:var(--radius-sm);overflow-wrap:anywhere}
.sg-steps button[aria-current=step]{background:var(--selection);border-color:var(--accent);font-weight:var(--fw-semibold)}
.sg-step-tiny{display:none}
.sg-guide-body{margin:0 0 10px;max-width:72ch;font-size:var(--fs-md);line-height:1.65}
.sg-chips{display:flex;flex-wrap:wrap;align-items:center;gap:6px 8px;margin:8px 0 0}
.sg-chips>.sg-name{font-size:var(--fs-sm);color:var(--muted);margin-right:2px}
.sg-chips button{min-height:34px;padding:3px 12px;border-radius:var(--radius-sm);font-size:var(--fs-body)}
.sg-chips button[aria-pressed=true]{background:var(--selection);border-color:var(--accent)}
.sg-dyn{display:contents}
.sg-controls{display:flex;flex-wrap:wrap;gap:8px 20px;align-items:flex-end;padding:10px 14px 12px;border:1px solid var(--line-soft);border-radius:var(--radius-md);background:var(--panel)}
.sg-ctl{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:baseline;gap:0 10px;flex:1 1 230px;min-width:0}
.sg-ctl>.sg-name{font-size:var(--fs-sm);color:var(--muted)}
.sg-ctl>output{font:var(--fw-semibold) var(--fs-body) var(--mono);text-align:right;white-space:nowrap}
.sg-ctl>input[type=range]{grid-column:1/-1;width:100%;min-width:0;margin:2px 0 0;height:28px;accent-color:var(--accent)}
.sg-ctl select{grid-column:1/-1;width:100%;min-height:36px;padding:0 8px}
.sg-scrub{flex:2 1 320px;grid-template-columns:auto minmax(0,1fr) auto;align-items:center;gap:0 10px}
.sg-scrub>.sg-name{grid-column:1/-1}
.sg-scrub>input[type=range]{grid-column:2;margin:0}
.sg-scrub>button{min-width:64px}
.sg-scrub>output{min-width:5.5em}
.sg-stage{margin-top:12px;border:1px solid var(--line-soft);border-radius:var(--radius-md);background:var(--canvas);overflow:hidden;min-height:220px}
.sg-svg{display:block;width:100%;max-width:100%;user-select:none;-webkit-user-select:none;touch-action:pan-y}
.sg-svg.sg-drag{cursor:crosshair}
.sg-svg:focus-visible{outline:var(--focus-ring);outline-offset:-2px}
.sg-svg .sg-frame{fill:none;stroke:var(--line-soft)}
.sg-svg .sg-grid{stroke:var(--grid);stroke-width:1}
.sg-svg .sg-axis{stroke:var(--zero);stroke-width:1.2}
.sg-svg .sg-tick{font:var(--fs-xs) var(--font-sans);fill:var(--muted)}
.sg-svg .sg-title{font:var(--fw-semibold) var(--fs-sm) var(--font-sans);fill:var(--muted)}
.sg-svg .sg-note{font:var(--fs-sm) var(--font-sans);fill:var(--text)}
.sg-svg .sg-note.muted{fill:var(--muted)}
.sg-svg .sg-note.tint{fill:var(--c)}
.sg-svg .ln{fill:none;stroke:var(--c);stroke-width:2.2;stroke-linejoin:round;stroke-linecap:round}
.sg-svg .ln.thin{stroke-width:1.3}
.sg-svg .ln.faint{opacity:.35}
.sg-svg .ln.thick{stroke-width:2.8}
.sg-svg .faintpole{opacity:.6}
.sg-svg .ln.dash{stroke-dasharray:6 4}
.sg-svg .ln.dot,.sg-svg .ref.dot{stroke-dasharray:1.5 5;stroke-linecap:round;stroke-width:2.4}
.sg-svg .fl{fill:var(--c);fill-opacity:.22;stroke:none}
.sg-svg .fl.strong{fill-opacity:.4}
.sg-svg .fl.solid{fill-opacity:1}
.sg-svg .fl.rim{stroke:var(--c);stroke-width:1.5;stroke-dasharray:5 4}
.sg-svg .st{stroke:var(--c);stroke-width:2}
.sg-svg .st.faint{opacity:.3}
.sg-svg .dt{fill:var(--c)}
.sg-svg .dt.ring{stroke:var(--canvas);stroke-width:2}
.sg-svg .dt.hollow{fill:var(--canvas);stroke:var(--c);stroke-width:1.5}
.sg-svg .ref{stroke:var(--c);stroke-width:1.5;fill:none}
.sg-svg .ref.dash{stroke-dasharray:5 4}
.sg-svg .ref.faint{opacity:.55}
.sg-svg .ref.thick{stroke-width:2.6}
.sg-svg .handle{fill:var(--canvas);stroke:var(--c);stroke-width:2.6;cursor:grab}
.sg-svg .c1{--c:var(--accent)}
.sg-svg .c2{--c:var(--success)}
.sg-svg .c3{--c:var(--text)}
.sg-svg .c4{--c:var(--warning)}
.sg-svg .c5{--c:var(--danger)}
.sg-svg .cm{--c:var(--muted)}
.sg-read{margin:10px 2px 0;font-size:var(--fs-md)}
.sg-hint{display:none;margin:2px 2px 0;font-size:var(--fs-sm);color:var(--muted)}
.sg-live{margin:2px 2px 0;min-height:1.5em;font:var(--fs-body) var(--mono);color:var(--muted);overflow-wrap:anywhere}
.sg-status{margin:4px 2px 0;min-height:1.4em;font-size:var(--fs-sm);color:var(--danger)}
.sg-details{margin-top:8px;border-top:1px solid var(--line-soft)}
.sg-details>summary{padding:8px 2px;font-size:var(--fs-body);color:var(--muted);cursor:pointer}
.sg-details .course-math{margin:2px 0;font-size:var(--fs-lg)}
.sg-advanced .sg-fields{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:8px 14px;padding:4px 2px 10px}
.sg-advanced label{display:flex;flex-direction:column;gap:3px;font-size:var(--fs-sm);color:var(--muted)}
.sg-advanced input[type=text]{min-height:36px;padding:0 8px;color:var(--text);background:var(--field);border:1px solid var(--line);border-radius:var(--radius-sm);font:var(--fs-body) var(--mono)}
.sg-advanced .sg-help{grid-column:1/-1;margin:0;font-size:var(--fs-sm);color:var(--muted)}
.sg-legend{display:flex;flex-wrap:wrap;gap:4px 14px;margin:8px 4px 0;font-size:var(--fs-sm);color:var(--muted)}
.sg-legend i{display:inline-block;width:14px;height:3px;margin-right:5px;vertical-align:middle;border-radius:var(--radius-sm);background:var(--c)}
.sg-legend>span[hidden]{display:none}
.sg-legend .dash i{background:repeating-linear-gradient(90deg,var(--c) 0 5px,transparent 5px 8px)}
.sg-legend .dot i{background:radial-gradient(circle,var(--c) 1.3px,transparent 1.8px) 0 50%/5px 3px repeat-x}
.sg-legend .mk i{width:9px;height:9px;border-radius:50%}
.sg-legend .band i{width:16px;height:10px;border-radius:var(--radius-sm);background:color-mix(in srgb,var(--c) 30%,transparent);border:1px dashed var(--c)}
.sg-legend .cm{--c:var(--muted)}
.sg-legend .c1{--c:var(--accent)}
.sg-legend .c2{--c:var(--success)}
.sg-legend .c3{--c:var(--text)}
.sg-legend .c4{--c:var(--warning)}
.sg-legend .c5{--c:var(--danger)}
.sg-bubble{position:fixed;left:0;top:0;z-index:30;max-width:calc(100vw - 16px);padding:6px 10px;pointer-events:none;box-shadow:var(--shadow-pop)}
.sg-bubble{border:1px solid var(--accent);border-radius:var(--radius-sm);background:var(--panel);color:var(--text);font:var(--fw-semibold) var(--fs-touch)/1.3 var(--mono);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
@media(max-width:700px){
.sg-tabs{grid-template-columns:repeat(3,minmax(0,1fr));gap:4px;margin-bottom:8px}.sg-ref select{font-size:var(--fs-input)}
.sg-tabs button{min-height:36px;padding:2px 2px;font-size:var(--fs-sm)}
.sg-head{display:none}
.sg-controls{display:block;padding:6px 10px 8px}
.sg-ctl{grid-template-columns:6.4em minmax(0,1fr) 6em;align-items:center;gap:0 8px;min-height:40px}
.sg-ctl>*{grid-row:1}
.sg-ctl>.sg-name{grid-column:1;font-size:var(--fs-sm);line-height:1.2}
.sg-ctl>input[type=range]{grid-column:2;margin:0;height:42px}
.sg-ctl>output{grid-column:3}
.sg-ctl select{grid-column:2/-1;min-height:40px}
.sg-ctl.sg-choice{display:inline-grid;vertical-align:top;width:calc(50% - 9px);margin:2px 8px 2px 0;grid-template-columns:minmax(0,1fr);gap:0}
.sg-ctl.sg-choice>*{grid-row:auto;grid-column:1}
.sg-ctl.sg-choice select{grid-column:1;min-height:40px}
.sg-scrub{grid-template-columns:auto minmax(0,1fr) 6em}
.sg-scrub>.sg-name{display:none}
.sg-scrub>input[type=range]{grid-column:2}
.sg-scrub>button{min-height:40px}
.sg-stage{min-height:200px;margin-top:8px}
.sg-read{font-size:var(--fs-body)}
.sg-hint:not([hidden]){display:block}
/* Phone touch: the plot comes first and the controls sit under it, so the hand on a slider never covers the curve it moves.
   Every control is a 44 px target, text fields and selects use 16 px (iOS zooms into smaller ones), sliders get a 28 px thumb. */
.sg{display:flex;flex-direction:column}
.sg>*{min-width:0}
.sg-stage{order:1}.sg-hint{order:2}.sg-live{order:3}.sg-controls{order:4;margin-top:8px}.sg-read{order:5}.sg-status{order:6}.sg-details{order:7}
.sg-tabs button,.sg-scrub>button,.sg-details>summary{min-height:44px}
.sg-details>summary{padding:12px 2px}
/* Guided mode on a phone: the plot first, the step bar right under it, the presets after the controls, the explanation above the read line.
   The step bar is always one 44 px line (one-word labels; if they still do not fit, the bar scrolls sideways, never the page),
   so its height does not change from step to step. */
.sg-steps{order:2;display:flex;flex-wrap:nowrap;gap:4px;margin:8px 0 0;overflow-x:auto;overflow-y:hidden;scrollbar-width:none}
.sg-steps button{flex:1 1 0;min-width:max-content;height:44px;min-height:44px;padding:0 6px;font-size:var(--fs-sm);white-space:nowrap}
.sg-step-full{display:none}.sg-step-tiny{display:inline}
.sg-chips{order:4}.sg-chips button{min-height:44px}
.sg-guide-body{order:5;margin:10px 0 0;font-size:var(--fs-body)}
.sg-ctl select,.sg-ref select,.sg-advanced input[type=text]{min-height:44px;font-size:var(--fs-input)}
.sg-ctl.sg-choice select{min-height:44px}
.sg-ctl>input[type=range]{height:44px}
.sg input[type=range]{-webkit-appearance:none;appearance:none;background:transparent}
.sg input[type=range]::-webkit-slider-runnable-track{height:6px;border-radius:var(--radius-sm);background:var(--line)}
.sg input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;appearance:none;width:28px;height:28px;margin-top:-11px;border-radius:50%;background:var(--accent);border:3px solid var(--canvas);box-shadow:0 0 0 1px var(--accent)}
.sg input[type=range]::-moz-range-track{height:6px;border-radius:var(--radius-sm);background:var(--line)}
.sg input[type=range]::-moz-range-thumb{width:22px;height:22px;border-radius:50%;background:var(--accent);border:3px solid var(--canvas)}
.sg input[type=range]:focus-visible{outline:var(--focus-ring);outline-offset:2px}
}
/* Sound-spectrum lesson: start/stop bar over the plot, the k | f | 이론 | 측정 table under it. */
.sg-sound-bar{display:flex;flex-wrap:wrap;align-items:center;gap:6px 12px;padding:10px 12px 0}
.sg-sound-bar button{min-height:38px;padding:4px 16px;border-radius:var(--radius-sm);font-weight:var(--fw-semibold)}
.sg-sound-bar button[aria-pressed=true]{background:var(--selection);border-color:var(--accent)}
.sg-sound-status{margin:0;flex:1 1 240px;min-width:0;font-size:var(--fs-body);color:var(--muted)}
.sg-sound-table{padding:2px 12px 12px;overflow-x:auto}
.sg-sound-caption{margin:6px 0 4px;font-size:var(--fs-sm);color:var(--muted)}
.sg-sound-table table{border-collapse:collapse;min-width:100%;font:var(--fs-body)/1.4 var(--mono)}
.sg-sound-table th,.sg-sound-table td{padding:4px 10px;border-bottom:1px solid var(--line-soft);text-align:right;white-space:nowrap}
.sg-sound-table thead th{color:var(--muted);font-weight:var(--fw-semibold);font-family:var(--font-sans)}
.sg-sound-table tbody th{text-align:center;color:var(--muted)}
@media(max-width:700px){
.sg-sound{display:flex;flex-direction:column}.sg-sound>.sg-sound-bar{order:1}.sg-sound>.sg-legend{order:2}.sg-sound>.sg-sound-table{order:3}
.sg-sound-bar{padding:8px 8px 0}.sg-sound-bar button{min-height:44px;flex:1 1 100%}
.sg-sound-table{padding:2px 6px 8px}.sg-sound-table table{font-size:var(--fs-sm)}.sg-sound-table th,.sg-sound-table td{padding:4px 6px}
}
`;
