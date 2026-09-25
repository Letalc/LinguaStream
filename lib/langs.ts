export type Lang = "es" | "en" | "pt";

export const LANGS: { code: Lang; label: string }[] = [
  { code: "es", label: "Español" },
  { code: "en", label: "English" },
  { code: "pt", label: "Português" },
];

export const langLabel = (code: string) => LANGS.find((l) => l.code === code)?.label ?? code;
export const isLang = (x: string | null | undefined): x is Lang => x === "es" || x === "en" || x === "pt";
