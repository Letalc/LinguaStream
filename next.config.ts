import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Allow phones on the same Wi-Fi to load the dev server (e.g. http://192.168.x.x:3000),
  // so the audience view can be tested on a real phone during development.
  allowedDevOrigins: ["192.168.*.*", "10.*.*.*", "*.local"],
};

export default nextConfig;
