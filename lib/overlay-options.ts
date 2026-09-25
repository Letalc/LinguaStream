import { isLang, type Lang } from "./langs";

const HEX = /^[0-9a-f]{6}$/i;

export type OverlayOptions = {
  lang: Lang;
  size: number;
  lines: number;
  box: boolean;
  color: string;
};

export function overlayOptions(params: URLSearchParams): OverlayOptions {
  const langParam = params.get("lang");
  const sizeRaw = params.get("size");
  const linesRaw = params.get("lines");
  const sizeParam = sizeRaw === null ? Number.NaN : Number(sizeRaw);
  const linesParam = linesRaw === null ? Number.NaN : Number(linesRaw);
  const colorParam = params.get("color") ?? "ffffff";

  return {
    lang: isLang(langParam) ? langParam : "es",
    size: Number.isFinite(sizeParam) ? clamp(Math.round(sizeParam), 20, 96) : 42,
    lines: Number.isFinite(linesParam) ? clamp(Math.round(linesParam), 1, 4) : 2,
    box: params.get("bg") !== "0",
    color: `#${HEX.test(colorParam) ? colorParam : "ffffff"}`,
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
