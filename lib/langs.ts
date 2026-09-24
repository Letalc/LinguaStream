export type Lang = "es" | "en" | "pt";

export const LANGS: { code: Lang; label: string; flag: string }[] = [
  { code: "es", label: "Español", flag: "🇦🇷" },
  { code: "en", label: "English", flag: "🇺🇸" },
  { code: "pt", label: "Português", flag: "🇧🇷" },
];

export const langLabel = (code: string) => LANGS.find((l) => l.code === code)?.label ?? code;
export const isLang = (x: string | null | undefined): x is Lang => x === "es" || x === "en" || x === "pt";
