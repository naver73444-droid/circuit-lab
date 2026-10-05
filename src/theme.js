/** Appearance is local UI preference only; no solver or project data is touched. */
export function initializeAppearance(select, onChange) {
  const media = matchMedia("(prefers-color-scheme: dark)");
  let preference = "dark";
  try { const saved = localStorage.getItem("circuit-lab.appearance"); if (["dark", "light", "system"].includes(saved)) preference = saved; } catch { /* Private/opaque origins may forbid storage. */ }
  const apply = () => {
    document.documentElement.dataset.theme = preference === "system" ? (media.matches ? "dark" : "light") : preference;
    select.value = preference;
    onChange();
  };
  select.addEventListener("change", () => {
    preference = select.value;
    try { localStorage.setItem("circuit-lab.appearance", preference); } catch { /* Session-only appearance remains usable. */ }
    apply();
  });
  media.addEventListener("change", () => { if (preference === "system") apply(); });
  apply();
}
