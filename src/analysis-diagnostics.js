const ANALYSIS_LABELS = { dc: "DC 동작점", transient: "시간응답", ac: "AC 주파수" };

export function analysisLabel(analysis) {
  return ANALYSIS_LABELS[analysis] ?? String(analysis ?? "해석");
}

const SOLVER_LIMIT_HINT = "반복 계산이 수렴하지 못했습니다. 입력값이 틀렸다는 뜻은 아니고 해석기의 수치 한계일 수 있습니다. 시간 간격이나 소스 진폭을 줄여 보세요.";

function relatedComponents(circuit, error) {
  const detailed = error?.details?.constraints?.map((constraint) => constraint.componentId) ?? [];
  if (detailed.length) return [...new Set(detailed)];
  const message = `${error?.message ?? ""} ${error?.hint ?? ""}`;
  return circuit.components
    .filter((component) => message.includes(component.id) || message.includes(component.props?.ref ?? component.id))
    .map((component) => component.id);
}

/**
 * The whole failure as plain data (code, message, hint, details), kept in runState.error: a re-render (undo, workspace switch, resize) must
 * show the same hint, details and related parts as the first render. Anything that is not a solver error is stored as UNKNOWN.
 */
export function failureRecord(error) {
  if (!error?.code) return { code: "UNKNOWN", message: String(error), hint: "", details: null };
  return { code: error.code, message: error.message, hint: error.hint ?? "", details: error.details ? structuredClone(error.details) : null };
}

export function describeCircuitFailure(circuit, settings, error) {
  const analysis = analysisLabel(settings?.analysis);
  const certainty = error?.details?.certainty === "confirmed"
    || ["INVALID_VALUE", "INVALID_ANALYSIS", "TOO_MANY_POINTS", "NO_GROUND", "FLOATING_NODE", "VOLTAGE_SOURCE_SHORT", "DIODE_MODEL_RANGE", "IDEAL_CONSTRAINT_CONFLICT", "IDEAL_CONSTRAINT_REDUNDANCY", "INITIAL_CONDITION_CONFLICT"].includes(error?.code)
      ? "confirmed"
      : ["NO_CONVERGENCE", "NUMERIC_FAILURE"].includes(error?.code) ? "inferred" : "unknown";
  const certaintyLabel = certainty === "confirmed" ? "확인된 원인" : certainty === "inferred" ? "수치 증상 기반 추정" : "원인 판단 불가";
  const constraints = (error?.details?.constraints ?? []).map((constraint) => ({
    componentId: constraint.componentId,
    ref: constraint.ref,
    pinLabel: constraint.pinLabel,
    role: constraint.role,
    value: constraint.value,
    input: constraint.input,
    text: `${constraint.ref} [${constraint.componentId}] ${constraint.pinLabel} · ${constraint.role} · 입력 ${constraint.input} · 계산 ${Number(constraint.value.toPrecision(8))} V`,
  }));
  return {
    analysis,
    code: error?.code ?? "UNKNOWN",
    message: error?.message ?? "해석 중 알 수 없는 오류가 발생했습니다.",
    hint: error?.hint || (error?.code === "NO_CONVERGENCE" ? SOLVER_LIMIT_HINT : "지원 범위 안에서 원인을 특정하지 못했습니다. 연결·값과 solver 오류 코드를 확인하세요."),
    certainty,
    certaintyLabel,
    constraints,
    relatedComponentIds: relatedComponents(circuit, error),
  };
}

export function resultAvailabilityText(runState, analysis, probeCount) {
  const label = analysisLabel(analysis);
  if (runState?.status === "error") return `${label} 실패 · 프로브 ${probeCount ? `${probeCount}개 보존` : "없음"} · 유효 결과 없음`;
  if (runState?.status === "stale") return `현재 회로와 다른 이전 결과 · 프로브 ${probeCount ? `${probeCount}개` : "없음"} · CSV 차단`;
  if (runState?.status === "not-run") return `${label} 미실행 · 프로브 ${probeCount ? `${probeCount}개 준비` : "없음"}`;
  return null;
}
