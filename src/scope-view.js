import { traceColor } from "./trace-color.js";
import { escapeHtml } from "./safe-dom.js";
import { axisDisplayUnit, engineering, extremaIndices, fittedAxis, fittedXAxis, nearestSampleIndex, zoomAxis, X_DIVISIONS, Y_DIVISIONS } from "./scope-model.js";
import { axisSide, cursorIndexAfterKey, layoutCursorLabels } from "./cursor-label-model.js";

const LABELS = { V: "전압", A: "전류", dBV: "전압 레벨", dBA: "전류 레벨", "°": "위상" };

/** SVG instrument view. Owns display state only; solver samples remain untouched. */
export class ScopeView {
  constructor(svg, controls, readout) {
    this.svg = svg;
    this.controls = controls;
    this.readout = readout;
    this.axes = new Map();
    this.xAxis = null;
    this.result = null;
    this.series = [];
    this.signature = "";
    this.cursorIndex = null;
    this.hoverIndex = null;
    this.pinnedIndex = null;
    this.selectedTraceKeys = new Map();
    this.stale = false;
    this.forceFit = true;
    this.wheelBalance = new Map();
    this.renderCount = 0;
    controls.addEventListener("click", (event) => {
      const button = event.target.closest("[data-scale-step]");
      if (button) this.step(button.dataset.scaleAxis, Number(button.dataset.scaleStep));
    });
    controls.addEventListener("wheel", (event) => {
      const control = event.target.closest("[data-scale-control]");
      if (!control || !this.result) return;
      event.preventDefault();
      this.wheelStep(control.dataset.scaleControl, event);
    }, { passive: false });
    readout.addEventListener("click", (event) => {
      const button = event.target.closest("[data-cursor-trace-key]");
      if (!button) return;
      this.selectedTraceKeys.set(button.dataset.axisSide, button.dataset.cursorTraceKey);
      this.renderCursor();
    });
    this.resizeObserver = new ResizeObserver(() => { if (this.result) this.render(); });
    this.resizeObserver.observe(svg);
  }

  inspect() {
    return structuredClone({ x: this.xAxis, axes: Object.fromEntries(this.axes), geometry: this.geometry, cursorIndex: this.cursorIndex, hoverIndex: this.hoverIndex, pinnedIndex: this.pinnedIndex, selectedTraceKeys: Object.fromEntries(this.selectedTraceKeys), renderCount: this.renderCount });
  }

  resetForProject() {
    this.forceFit = true;
    this.xAxis = null;
    this.axes.clear();
    this.cursorIndex = null;
    this.hoverIndex = null;
    this.pinnedIndex = null;
    this.selectedTraceKeys.clear();
    this.wheelBalance.clear();
  }

  setData(result, series, stale = false) {
    const signature = series.map((item) => [item.key, item.label, item.quantity, item.color].join(":" )).join("|");
    if (result === this.result && signature === this.signature && stale === this.stale && !this.forceFit) return;
    const changedAnalysis = result?.analysis !== this.result?.analysis;
    const changedResult = result !== this.result;
    this.result = result;
    this.series = series;
    const availableKeys = new Set(series.map((item) => item.key));
    for (const [side, key] of this.selectedTraceKeys) if (!availableKeys.has(key)) this.selectedTraceKeys.delete(side);
    this.signature = signature;
    this.stale = stale;
    if (!result || !series.length) {
      this.svg.innerHTML = "";
      this.controls.replaceChildren();
      document.getElementById("scope-zero-note")?.classList.add("hidden");
      this.cursorIndex = null;
      this.hoverIndex = null;
      this.pinnedIndex = null;
      return;
    }
    this.logarithmic = result.analysis === "ac";
    this.xValues = result.xValues.map((value) => this.logarithmic ? Math.log10(value) : value);
    if (changedAnalysis || this.forceFit || !this.xAxis || this.xAxis.automatic) this.xAxis = fittedXAxis(result.xValues, this.logarithmic);
    const grouped = new Map();
    for (const item of series) {
      if (!grouped.has(item.quantity)) grouped.set(item.quantity, []);
      grouped.get(item.quantity).push(item);
    }
    const next = new Map();
    this.displayError = null;
    const priority = (quantity) => ["V", "dBV", "°"].includes(quantity) ? 0 : 1;
    for (const [quantity, items] of [...grouped].sort(([left], [right]) => priority(left) - priority(right))) {
      const previous = this.axes.get(quantity);
      try {
        next.set(quantity, previous && !previous.automatic && !changedAnalysis && !this.forceFit
          ? previous
          : fittedAxis(items.flatMap((item) => item.values), { includeZero: ["V", "A"].includes(quantity) }));
      } catch (error) {
        this.displayError = error.message;
        this.svg.replaceChildren();
        this.controls.textContent = `그래프 표시 제한: ${error.message} 계산 원시값/CSV는 변경하지 않았습니다.`;
        this.readout.textContent = this.controls.textContent;
        return;
      }
    }
    this.axes = next;
    this.forceFit = false;
    if (changedResult) {
      this.hoverIndex = null;
      this.pinnedIndex = null;
      this.selectedTraceKeys.clear();
    }
    this.cursorIndex = result.analysis === "dc" ? 0 : this.pinnedIndex ?? this.hoverIndex;
    this.render();
  }

  fit() {
    if (!this.result) return;
    const { result, series, stale } = this;
    this.forceFit = true;
    this.setData(result, series, stale);
  }

  point(event) {
    const matrix = this.svg.getScreenCTM();
    if (!matrix) return null;
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
    return { x: point.x, y: point.y };
  }

  inside(point, tolerance = 0) {
    const g = this.geometry;
    return g && point && point.x >= g.left - tolerance && point.x <= g.left + g.plotWidth + tolerance && point.y >= g.top - tolerance && point.y <= g.top + g.plotHeight + tolerance;
  }

  step(key, direction, fraction = .5) {
    if (!this.result) return;
    if (key === "x") {
      if (this.result.analysis === "dc") return;
      this.xAxis = zoomAxis(this.xAxis, direction, fraction, X_DIVISIONS);
    } else if (this.axes.has(key)) this.axes.set(key, zoomAxis(this.axes.get(key), direction, fraction));
    this.render();
  }

  wheelStep(key, event, fraction = .5) {
    const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 800 : 1);
    const balance = (this.wheelBalance.get(key) ?? 0) + delta;
    this.wheelBalance.set(key, balance);
    if (Math.abs(balance) < 40) return;
    this.wheelBalance.set(key, 0);
    this.step(key, balance > 0 ? 1 : -1, fraction);
  }

  wheel(event) {
    if (!this.result) return;
    const point = this.point(event);
    if (!point || !this.geometry) return;
    const g = this.geometry;
    const quantities = [...this.axes.keys()];
    let key = "x";
    if (event.altKey || point.x > g.left + g.plotWidth) key = quantities[1] ?? quantities[0];
    else if (event.shiftKey || point.x < g.left || this.result.analysis === "dc") key = quantities[0];
    const fraction = key === "x" ? (point.x - g.left) / g.plotWidth : 1 - (point.y - g.top) / g.plotHeight;
    this.wheelStep(key, event, Math.max(0, Math.min(1, fraction)));
  }

  panFrom(snapshot, deltaX) {
    if (!snapshot.x || !this.geometry || this.result?.analysis === "dc") return;
    const shift = -deltaX / this.geometry.plotWidth * (snapshot.x.maximum - snapshot.x.minimum);
    this.xAxis = { ...snapshot.x, minimum: snapshot.x.minimum + shift, maximum: snapshot.x.maximum + shift, automatic: false };
    this.render();
  }

  restore(snapshot) {
    if (!snapshot?.x) return;
    this.xAxis = structuredClone(snapshot.x);
    this.axes = new Map(Object.entries(structuredClone(snapshot.axes)));
    this.render();
  }

  moveCursor(point) {
    if (!this.result || this.result.analysis === "dc") return;
    if (this.result.analysis === "transient" && this.pinnedIndex !== null) return;
    this.hoverIndex = this.indexAtPoint(point);
    this.cursorIndex = this.hoverIndex;
    this.renderCursor();
  }

  indexAtPoint(point) {
    if (!this.result || this.result.analysis === "dc" || !this.inside(point, 1)) return null;
    const fraction = Math.max(0, Math.min(1, (point.x - this.geometry.left) / this.geometry.plotWidth));
    const tx = this.xAxis.minimum + fraction * (this.xAxis.maximum - this.xAxis.minimum);
    const target = this.logarithmic ? 10 ** tx : tx;
    const values = this.result.xValues;
    const tolerance = Math.max(Number.MIN_VALUE, (values.at(-1) - values[0]) * 1e-10);
    return target < values[0] - tolerance || target > values.at(-1) + tolerance ? null : nearestSampleIndex(values, target);
  }

  pinCursorAt(point) {
    if (this.result?.analysis !== "transient") return false;
    const index = this.indexAtPoint(point);
    if (index === null) return false;
    this.pinnedIndex = index;
    this.cursorIndex = index;
    this.renderCursor();
    return true;
  }

  clearPinnedCursor() {
    if (this.pinnedIndex === null) return false;
    this.pinnedIndex = null;
    this.cursorIndex = this.hoverIndex;
    this.renderCursor();
    return true;
  }

  keyCursor(key) {
    if (this.result?.analysis !== "transient") return false;
    if (key === "Escape") return this.clearPinnedCursor();
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(key)) return false;
    const next = cursorIndexAfterKey(this.pinnedIndex, key, this.result.xValues.length);
    if (next === null) return false;
    if (next !== this.pinnedIndex) {
      this.pinnedIndex = next;
      this.cursorIndex = next;
      this.renderCursor();
    }
    return true;
  }

  coordinates(x, value, quantity) {
    const g = this.geometry;
    const axis = this.axes.get(quantity);
    return {
      x: g.left + (x - this.xAxis.minimum) / (this.xAxis.maximum - this.xAxis.minimum) * g.plotWidth,
      y: g.top + (1 - (value - axis.minimum) / (axis.maximum - axis.minimum)) * g.plotHeight,
    };
  }

  renderControls() {
    const items = [
      ...(this.result.analysis === "dc" ? [] : [{ key: "x", label: this.logarithmic ? "주파수" : "시간", axis: this.xAxis, unit: this.logarithmic ? "dec" : "s" }]),
      ...[...this.axes].map(([key, axis]) => ({ key, label: LABELS[key] ?? key, axis, unit: key })),
    ];
    this.controls.innerHTML = items.map(({ key, label, axis, unit }) => `<div class="scale-control" data-scale-control="${escapeHtml(key)}" title="휠로 한 칸당 눈금을 조절합니다"><span>${label}<small>${axis.automatic ? "자동" : "고정"}</small></span><div><button type="button" data-scale-axis="${escapeHtml(key)}" data-scale-step="-1" aria-label="${label} 눈금 값 줄이기">−</button><output>${engineering(axis.division, unit)}/div</output><button type="button" data-scale-axis="${escapeHtml(key)}" data-scale-step="1" aria-label="${label} 눈금 값 늘리기">+</button></div></div>`).join("");
  }

  render() {
    if (!this.result || !this.series.length || this.displayError) return;
    this.renderCount += 1;
    const active = this.controls.contains(document.activeElement) ? {
      axis: document.activeElement.dataset.scaleAxis, step: document.activeElement.dataset.scaleStep,
    } : null;
    this.renderControls();
    if (active?.axis && active.step) this.controls.querySelector(`[data-scale-axis="${active.axis}"][data-scale-step="${active.step}"]`)?.focus({ preventScroll: true });
    const width = Math.max(260, this.svg.clientWidth || 600);
    const height = Math.max(180, this.svg.clientHeight || 320);
    const transientAxes = this.result.analysis === "transient";
    const hasLeftAxis = transientAxes ? [...this.axes.keys()].some((quantity) => axisSide(quantity) === "left") : this.axes.size > 0;
    const hasRightAxis = transientAxes ? [...this.axes.keys()].some((quantity) => axisSide(quantity) === "right") : this.axes.size > 1;
    const left = hasLeftAxis ? 68 : 24;
    const right = hasRightAxis ? 76 : 24;
    const top = 28;
    const bottom = 36;
    const g = this.geometry = { width, height, left, right, top, bottom, plotWidth: width - left - right, plotHeight: height - top - bottom };
    this.svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    let markup = `<defs><clipPath id="scope-data-clip"><rect x="${left}" y="${top}" width="${g.plotWidth}" height="${g.plotHeight}"/></clipPath></defs><rect class="scope-surface" x="${left}" y="${top}" width="${g.plotWidth}" height="${g.plotHeight}"/>`;
    const isDC = this.result.analysis === "dc";
    for (let tick = 0; tick <= X_DIVISIONS; tick += 1) {
      const x = left + g.plotWidth * tick / X_DIVISIONS;
      markup += `<line class="plot-grid" x1="${x}" y1="${top}" x2="${x}" y2="${top + g.plotHeight}"/>`;
      if (!isDC && (width > 700 || tick % 2 === 0)) {
        const transformed = this.xAxis.minimum + this.xAxis.division * tick;
        const value = this.logarithmic ? 10 ** transformed : transformed;
        const cleaned = Math.abs(value) < Math.abs(this.xAxis.division) * 1e-9 && !this.logarithmic ? 0 : value;
        markup += `<text class="plot-axis" x="${x}" y="${height - 12}" text-anchor="middle">${engineering(cleaned, this.logarithmic ? "Hz" : "s", 3)}</text>`;
      }
    }
    for (let tick = 0; tick <= Y_DIVISIONS; tick += 1) {
      const y = top + g.plotHeight * tick / Y_DIVISIONS;
      markup += `<line class="plot-grid" x1="${left}" y1="${y}" x2="${left + g.plotWidth}" y2="${y}"/>`;
    }
    [...this.axes].forEach(([quantity, axis], axisIndex) => {
      const display = axisDisplayUnit(axis, quantity);
      const isRight = transientAxes ? axisSide(quantity) === "right" : axisIndex === 1;
      const x = isRight ? left + g.plotWidth + 8 : left - 8;
      const anchor = isRight ? "start" : "end";
      markup += `<text class="plot-axis-title" x="${isRight ? left + g.plotWidth : left}" y="17" text-anchor="${isRight ? "end" : "start"}">${LABELS[quantity] ?? quantity} · ${display.unit}</text>`;
      for (let tick = 0; tick <= Y_DIVISIONS; tick += 2) {
        const value = axis.maximum - axis.division * tick;
        const cleaned = Math.abs(value) < axis.division * 1e-9 ? 0 : value;
        markup += `<text class="plot-axis" x="${x}" y="${top + g.plotHeight * tick / Y_DIVISIONS + 4}" text-anchor="${anchor}">${Number((cleaned * display.scale).toPrecision(4))} ${display.unit}</text>`;
      }
      if (axis.minimum <= 0 && axis.maximum >= 0) {
        const y = this.coordinates(0, 0, quantity).y;
        markup += `<line class="scope-zero" x1="${left}" y1="${y}" x2="${left + g.plotWidth}" y2="${y}"/>`;
      }
    });
    markup += '<g clip-path="url(#scope-data-clip)">';
    for (const item of this.series) {
      const color = traceColor(item.color);
      if (isDC) {
        if (!Number.isFinite(item.values[0]) || item.values[0] === null) continue;
        const y = this.coordinates(0, item.values[0], item.quantity).y;
        markup += `<line class="plot-line" stroke="${color}" x1="${left}" y1="${y}" x2="${left + g.plotWidth}" y2="${y}"/>`;
      } else {
        const indexes = extremaIndices(this.xValues, item.values, this.xAxis.minimum, this.xAxis.maximum, Math.ceil(g.plotWidth));
        if (indexes.length) {
          if (indexes[0] > 0) indexes.unshift(indexes[0] - 1);
          if (indexes.at(-1) < this.xValues.length - 1) indexes.push(indexes.at(-1) + 1);
        } else {
          const nearby = nearestSampleIndex(this.xValues, this.xAxis.minimum);
          if (nearby !== null) indexes.push(...[nearby - 1, nearby, nearby + 1].filter((index) => index >= 0 && index < this.xValues.length));
        }
        let path = "";
        let penDown = false;
        for (const index of indexes) {
          const value = item.values[index];
          if (value === null || !Number.isFinite(value)) { penDown = false; continue; }
          const point = this.coordinates(this.xValues[index], value, item.quantity);
          path += `${penDown ? "L" : "M"}${point.x.toFixed(2)} ${point.y.toFixed(2)}`;
          penDown = true;
        }
        markup += `<path class="plot-line" stroke="${color}" d="${path}"/>`;
      }
    }
    markup += '</g><g id="scope-cursor"></g>';
    if (isDC) markup += `<text class="plot-axis" x="${left + g.plotWidth / 2}" y="${height - 12}" text-anchor="middle">DC 동작점 · 시간축 없음</text>`;
    if (this.stale) markup += `<text class="scope-stale" x="${left + 8}" y="${top + 17}">이전 결과 · 다시 실행 필요</text>`;
    this.svg.innerHTML = markup;
    const note = document.getElementById("scope-zero-note");
    if (note) {
      const undefinedSeries = this.series.filter(item => item.values.some(value => value === null || !Number.isFinite(value)));
      note.classList.toggle("hidden", !undefinedSeries.length);
      note.textContent = undefinedSeries.length ? "0 진폭의 로그 크기는 −∞, 위상은 미정입니다. 정의되지 않은 점은 이어 그리지 않으며 CSV에는 −Infinity / 빈 위상으로 보존합니다." : "";
    }
    this.renderCursor();
  }

  renderCursor() {
    const target = this.svg.querySelector("#scope-cursor");
    if (!target) return;
    target.replaceChildren();
    const index = this.cursorIndex;
    if (index === null || !this.result || index >= this.result.xValues.length) {
      this.readout.textContent = "휠: 시간/주파수 · 왼쪽 눈금 또는 Shift+휠: 전압 · 오른쪽 눈금 또는 Alt+휠: 전류";
      return;
    }
    const isDC = this.result.analysis === "dc";
    const pinned = this.result.analysis === "transient" && this.pinnedIndex !== null;
    const parts = [this.stale ? "이전 결과" : pinned ? "고정 측정" : "측정", `index ${index}`, isDC ? "DC" : engineering(this.result.xValues[index], this.logarithmic ? "Hz" : "s", 6)];
    const g = this.geometry;
    const x = this.coordinates(this.xValues[index], 0, this.series[0].quantity).x;
    let markup = isDC ? "" : `<g clip-path="url(#scope-data-clip)"><line class="plot-cursor" x1="${x}" y1="${g.top}" x2="${x}" y2="${g.top + g.plotHeight}"/>`;
    const sortedSeries = [...this.series].sort((left, right) => String(left.key).localeCompare(String(right.key)));
    for (const [ordinal, item] of sortedSeries.entries()) {
      const value = item.values[index];
      const logarithmicZero = this.result.analysis === "ac" && value === Number.NEGATIVE_INFINITY && ["dBV", "dBA"].includes(item.quantity);
      const formatted = value !== null && (Number.isFinite(value) || logarithmicZero) ? engineering(value, item.quantity, 6) : "미정";
      parts.push(`#${ordinal + 1} ${item.label} = ${formatted}`);
      if (!isDC && value !== null && Number.isFinite(value)) {
        const point = this.coordinates(this.xValues[index], value, item.quantity);
        markup += `<circle cx="${point.x}" cy="${point.y}" r="3.5" fill="${traceColor(item.color)}"/>`;
      }
    }
    if (!isDC) markup += "</g>";
    if (this.result.analysis === "transient") {
      const layout = layoutCursorLabels({ series: this.series, index, axes: this.axes, xAxis: this.xAxis, xValue: this.result.xValues[index], geometry: g, selectedKeys: this.selectedTraceKeys.values() });
      for (const entry of layout.entries) {
        if (entry.offscreen) parts.push(`#${entry.ordinal} ${entry.label}: 화면밖`);
      }
      for (const entry of layout.placed) {
        const color = traceColor(entry.color);
        const sideX = entry.side === "right" ? g.left + g.plotWidth : g.left;
        const textX = entry.side === "right" ? sideX - 5 : sideX + 5;
        const anchor = entry.side === "right" ? "end" : "start";
        const formatted = engineering(entry.value, entry.quantity, 6);
        const label = `#${entry.ordinal} ${entry.label} ${formatted}`;
        markup += `<g class="scope-cursor-badge" data-trace-key="${escapeHtml(entry.key)}" data-axis-side="${entry.side}" role="img" aria-label="${escapeHtml(label)}"><line class="scope-measure-guide" stroke="${color}" x1="${x}" y1="${entry.anchorY}" x2="${sideX}" y2="${entry.anchorY}"/><line class="scope-badge-leader" stroke="${color}" x1="${sideX}" y1="${entry.anchorY}" x2="${sideX}" y2="${entry.badgeY}"/><text x="${textX}" y="${entry.badgeY + 4}" text-anchor="${anchor}" fill="${color}">#${entry.ordinal} ${escapeHtml(formatted)}</text></g>`;
      }
      if (layout.hiddenCount) parts.push(`배지 ${layout.hiddenCount}개 숨김 · 전체 값은 이 목록에 표시`);
      const choices = layout.entries.map((entry) => {
        const formatted = entry.value !== null && Number.isFinite(entry.value) ? engineering(entry.value, entry.quantity, 6) : "미정";
        const selected = this.selectedTraceKeys.get(entry.side) === entry.key;
        return `<button type="button" class="cursor-trace-choice" data-cursor-trace-key="${escapeHtml(entry.key)}" data-axis-side="${entry.side}" aria-pressed="${selected}" title="${escapeHtml(entry.label)} 배지를 우선 표시"><span style="--trace-color:${traceColor(entry.color)}"></span>#${entry.ordinal} ${escapeHtml(entry.label)} = ${escapeHtml(formatted)}</button>`;
      }).join("");
      this.readout.innerHTML = `<span class="cursor-summary">${escapeHtml(parts.join("  ·  "))}</span><div class="cursor-trace-choices" aria-label="측정 trace 배지 선택">${choices}</div>`;
    }
    target.innerHTML = markup;
    if (this.result.analysis !== "transient") this.readout.textContent = parts.join("  ·  ");
  }
}
