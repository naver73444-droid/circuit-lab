# Time-response raw-sample cursor labels

- Cursor labels are a transient-view feature. DC, AC magnitude/phase, and phasor views keep their existing semantics.
- Hover reads the nearest actual `xValues` sample. Click/tap movement up to 6 CSS px pins that raw index; a larger movement pans. Escape clears a pinned cursor.
- With graph focus, Left/Right moves one raw index and Home/End selects the first/last raw index. These shortcuts do not run while an input control has focus.
- Voltage badges use the left axis and current badges use the right axis, including current-only plots. Values use the same six-significant-digit engineering formatter as the readout.
- Badge collision layout is deterministic. The text readout remains the complete accessible list when a visual badge is offscreen or hidden for lack of space.
- Zoom, pan, fit, resize, and theme changes change only the view. The pinned raw index and stored probe colors are not edited.
