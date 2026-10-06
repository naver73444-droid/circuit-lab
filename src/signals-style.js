// Stylesheet of the signals workspace. Colors come only from the app theme tokens (styles.css),
// so dark and light themes both work. Injected once per document by ensureCourseStyle.
export const SIGNALS_STYLE = `
.sg{box-sizing:border-box;max-width:1180px;margin:0 auto;padding:clamp(10px,2.2vw,22px);color:var(--text);font:14px/1.55 system-ui,"Malgun Gothic",sans-serif}
.sg *{box-sizing:border-box}
.sg [hidden]{display:none!important}
.sg-tabs{display:grid;grid-template-columns:repeat(auto-fit,minmax(104px,1fr));gap:6px;margin:0 0 12px}
.sg-tabs button{min-height:40px;padding:4px 6px;font-size:13px;line-height:1.25;border-radius:10px;overflow-wrap:anywhere}
.sg-tabs button[aria-current=step]{background:var(--selection);border-color:var(--accent);font-weight:650}
.sg-head{display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 12px;margin:0 0 8px}
.sg-head h2{margin:0;font-size:18px;font-weight:650}
.sg-head span{color:var(--muted);font-size:12px}
.sg-dyn{display:contents}
.sg-controls{display:flex;flex-wrap:wrap;gap:8px 20px;align-items:flex-end;padding:10px 14px 12px;border:1px solid var(--line-soft);border-radius:12px;background:var(--panel)}
.sg-ctl{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:baseline;gap:0 10px;flex:1 1 230px;min-width:0}
.sg-ctl>.sg-name{font-size:12px;color:var(--muted)}
.sg-ctl>output{font:600 13px var(--mono);text-align:right;white-space:nowrap}
.sg-ctl>input[type=range]{grid-column:1/-1;width:100%;min-width:0;margin:2px 0 0;height:28px;accent-color:var(--accent)}
.sg-ctl select{grid-column:1/-1;width:100%;min-height:36px;padding:0 8px}
.sg-scrub{flex:2 1 320px;grid-template-columns:auto minmax(0,1fr) auto;align-items:center;gap:0 10px}
.sg-scrub>.sg-name{grid-column:1/-1}
.sg-scrub>input[type=range]{grid-column:2;margin:0}
.sg-scrub>button{min-width:64px}
.sg-scrub>output{min-width:5.5em}
.sg-stage{margin-top:12px;border:1px solid var(--line-soft);border-radius:12px;background:var(--canvas);overflow:hidden;min-height:220px}
.sg-svg{display:block;width:100%;max-width:100%;user-select:none;-webkit-user-select:none;touch-action:pan-y}
.sg-svg.sg-drag{cursor:crosshair}
.sg-svg:focus-visible{outline:2px solid var(--accent);outline-offset:-2px}
.sg-svg .sg-frame{fill:none;stroke:var(--line-soft)}
.sg-svg .sg-grid{stroke:var(--grid);stroke-width:1}
.sg-svg .sg-axis{stroke:var(--zero);stroke-width:1.2}
.sg-svg .sg-tick{font:11px system-ui,sans-serif;fill:var(--muted)}
.sg-svg .sg-title{font:600 12px system-ui,sans-serif;fill:var(--muted)}
.sg-svg .sg-note{font:12px system-ui,sans-serif;fill:var(--text)}
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
.sg-read{margin:10px 2px 0;font-size:14px}
.sg-live{margin:2px 2px 0;min-height:1.5em;font:13px var(--mono);color:var(--muted);overflow-wrap:anywhere}
.sg-status{margin:4px 2px 0;min-height:1.4em;font-size:12px;color:var(--danger)}
.sg-details{margin-top:8px;border-top:1px solid var(--line-soft)}
.sg-details>summary{padding:8px 2px;font-size:13px;color:var(--muted);cursor:pointer}
.sg-details .course-math{margin:2px 0;font-size:17px}
.sg-advanced .sg-fields{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:8px 14px;padding:4px 2px 10px}
.sg-advanced label{display:flex;flex-direction:column;gap:3px;font-size:12px;color:var(--muted)}
.sg-advanced input[type=text]{min-height:36px;padding:0 8px;color:var(--text);background:var(--field);border:1px solid var(--line);border-radius:8px;font:13px var(--mono)}
.sg-advanced .sg-help{grid-column:1/-1;margin:0;font-size:12px;color:var(--muted)}
.sg-legend{display:flex;flex-wrap:wrap;gap:4px 14px;margin:8px 4px 0;font-size:12px;color:var(--muted)}
.sg-legend i{display:inline-block;width:14px;height:3px;margin-right:5px;vertical-align:middle;border-radius:2px;background:var(--c)}
.sg-legend>span[hidden]{display:none}
.sg-legend .dash i{background:repeating-linear-gradient(90deg,var(--c) 0 5px,transparent 5px 8px)}
.sg-legend .dot i{background:radial-gradient(circle,var(--c) 1.3px,transparent 1.8px) 0 50%/5px 3px repeat-x}
.sg-legend .mk i{width:9px;height:9px;border-radius:50%}
.sg-legend .band i{width:16px;height:10px;border-radius:2px;background:color-mix(in srgb,var(--c) 30%,transparent);border:1px dashed var(--c)}
.sg-legend .cm{--c:var(--muted)}
.sg-legend .c1{--c:var(--accent)}
.sg-legend .c2{--c:var(--success)}
.sg-legend .c3{--c:var(--text)}
.sg-legend .c4{--c:var(--warning)}
.sg-legend .c5{--c:var(--danger)}
@media(max-width:700px){
.sg-tabs{grid-template-columns:repeat(3,minmax(0,1fr));gap:4px;margin-bottom:8px}
.sg-tabs button{min-height:36px;padding:2px 2px;font-size:12px}
.sg-head{display:none}
.sg-controls{display:block;padding:6px 10px 8px}
.sg-ctl{grid-template-columns:6.4em minmax(0,1fr) 6em;align-items:center;gap:0 8px;min-height:34px}
.sg-ctl>*{grid-row:1}
.sg-ctl>.sg-name{grid-column:1;font-size:12px;line-height:1.2}
.sg-ctl>input[type=range]{grid-column:2;margin:0}
.sg-ctl>output{grid-column:3}
.sg-ctl select{grid-column:2/-1}
.sg-ctl.sg-choice{display:inline-grid;vertical-align:top;width:calc(50% - 9px);margin:2px 8px 2px 0;grid-template-columns:minmax(0,1fr);gap:0}
.sg-ctl.sg-choice>*{grid-row:auto;grid-column:1}
.sg-ctl.sg-choice select{grid-column:1}
.sg-scrub{grid-template-columns:auto minmax(0,1fr) 6em}
.sg-scrub>.sg-name{display:none}
.sg-scrub>input[type=range]{grid-column:2}
.sg-stage{min-height:200px;margin-top:8px}
.sg-read{font-size:13px}
}
`;
