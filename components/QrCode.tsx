"use client";

import QRCode from "qrcode";
import { useEffect, useState } from "react";

/** QR rendered client-side as inline SVG (crisp at any size, works offline). */
export function QrCode({ value, className = "" }: { value: string; className?: string }) {
  const [svg, setSvg] = useState("");
  useEffect(() => {
    QRCode.toString(value, { type: "svg", margin: 1, errorCorrectionLevel: "M", color: { dark: "#000000", light: "#ffffff" } })
      .then(setSvg)
      .catch(() => setSvg(""));
  }, [value]);
  return (
    <div
      className={`overflow-hidden rounded-xl bg-white p-3 [&>svg]:h-full [&>svg]:w-full ${className}`}
      aria-label={`QR code for ${value}`}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
