import { describe, expect, it } from "vitest";
import { overlayOptions } from "./overlay-options";

describe("overlayOptions", () => {
  it("uses safe defaults", () => {
    expect(overlayOptions(new URLSearchParams())).toEqual({
      lang: "es",
      size: 42,
      lines: 2,
      box: true,
      color: "#ffffff",
    });
  });

  it("bounds layout values and rejects invalid colors", () => {
    const options = overlayOptions(new URLSearchParams("lang=pt&size=999&lines=0&bg=0&color=red%3Bdisplay:none"));
    expect(options).toEqual({ lang: "pt", size: 96, lines: 1, box: false, color: "#ffffff" });
  });
});
