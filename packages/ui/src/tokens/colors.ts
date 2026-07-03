// Canonical palette. tokens.css mirrors these values 1:1 —
// colors.test.ts fails `bun test` if the two files drift.
// Soft/alpha variants (--accent-soft, --up-soft, --down-soft) and --radius
// are CSS-only. static/brand/*.svg|png embed accent/ink hexes — re-export
// those assets if accent or ink ever change.
export const colors = {
  paper: "#0a0b0e",
  surface: "#121419",
  surface2: "#1a1d24",
  line: "#272b34",
  lineSoft: "#1d2128",
  ink: "#eef1f6",
  muted: "#8c95a4",
  faint: "#5a6472",
  accent: "#ff4d97",
  accentContrast: "#14060c",
  up: "#2ce97f",
  down: "#ff5a6a",
  amber: "#ffb454",
  red: "#ff5a6a",
  blue: "#8ab4ff",
  chartBg: "#0f1116",
} as const;

export type ColorToken = keyof typeof colors;

/** CSS custom property name for each token — used by colors.test.ts. */
export const cssVar: Record<ColorToken, string> = {
  paper: "--paper",
  surface: "--surface",
  surface2: "--surface-2",
  line: "--line",
  lineSoft: "--line-soft",
  ink: "--ink",
  muted: "--muted",
  faint: "--faint",
  accent: "--accent",
  accentContrast: "--accent-contrast",
  up: "--up",
  down: "--down",
  amber: "--amber",
  red: "--red",
  blue: "--blue",
  chartBg: "--chart-bg",
};
