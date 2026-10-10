import type { NextConfig } from "next";

/**
 * Basic hardening for every page. The invite token lives in the URL, so nothing may leak it through a Referer header.
 * (A strict script-src policy is a later step: Next needs nonces for that.)
 */
const securityHeaders = [
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const config: NextConfig = {
  // The floating dev badge sits over the bottom tab bar on a phone, so hide it.
  devIndicators: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default config;
