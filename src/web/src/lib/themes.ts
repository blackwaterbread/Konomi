export type ThemeId = "dark" | "white" | "auto";

export interface ThemeConfig {
  id: ThemeId;
  label: string;
  /** null = follows system */
  isDark: boolean | null;
}

export const THEMES: ThemeConfig[] = [
  { id: "auto", label: "자동", isDark: null },
  { id: "dark", label: "Dark", isDark: true },
  { id: "white", label: "White", isDark: false },
];
