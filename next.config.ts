import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV === "development";
// Vercel sets VERCEL_ENV at build time: 'production' | 'preview' | 'development'.
const isVercelPreview = process.env.VERCEL_ENV === "preview";

/**
 * Deploy version, baked into the client bundle. PWARegister registers
 * `/sw.js?v=<version>`, so each deploy installs a fresh service worker (new cache names,
 * re-cached offline page) and the "New version available" prompt appears.
 */
const appVersion = (
  process.env.VERCEL_GIT_COMMIT_SHA ??
  process.env.VERCEL_DEPLOYMENT_ID ??
  (isDev ? "dev" : `build-${Date.now().toString(36)}`)
).slice(0, 16);

/** Origin of the configured Supabase project, if it isn't a *.supabase.co URL already covered. */
function supabaseOrigins(): string[] {
  const raw = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  if (!raw) return [];
  try {
    const url = new URL(raw);
    if (url.hostname.endsWith(".supabase.co")) return [];
    return [url.origin, `${url.protocol === "http:" ? "ws:" : "wss:"}//${url.host}`];
  } catch {
    return [];
  }
}

/**
 * Content-Security-Policy (ARCHITECTURE §8).
 *
 * script-src needs 'unsafe-inline': the App Router streams its bootstrap and RSC payload
 * as inline <script> tags. Removing it requires per-request nonces, which forces every
 * page (including /offline and /privacy) to render dynamically — not worth it here since
 * the app renders no user-supplied HTML (React escapes all text) and loads no third-party
 * scripts. 'unsafe-eval' is only added in development (React's dev tooling uses eval).
 */
function contentSecurityPolicy(): string {
  const connect = ["'self'", "https://*.supabase.co", "wss://*.supabase.co", ...supabaseOrigins()];
  const script = ["'self'", "'unsafe-inline'"];
  const style = ["'self'", "'unsafe-inline'"];
  const img = ["'self'", "data:", "blob:"];
  const font = ["'self'"];
  const frame: string[] = [];

  if (isDev) {
    script.push("'unsafe-eval'");
    connect.push("ws:"); // hot reload
  }

  // Vercel preview deployments inject the Vercel Toolbar (comments/feedback) from
  // vercel.live. Allow it there only; production stays locked down.
  if (isVercelPreview) {
    script.push("https://vercel.live");
    connect.push("https://vercel.live", "wss://ws-us3.pusher.com");
    img.push("https://vercel.live", "https://vercel.com");
    style.push("https://vercel.live");
    font.push("https://vercel.live", "https://assets.vercel.com");
    frame.push("https://vercel.live");
  }

  const directives: Array<[string, string[]]> = [
    ["default-src", ["'self'"]],
    ["script-src", script],
    ["style-src", style],
    ["img-src", img],
    ["font-src", font],
    ["connect-src", connect],
    ["worker-src", ["'self'"]],
    ["manifest-src", ["'self'"]],
    ["frame-src", frame.length ? frame : ["'none'"]],
    ["object-src", ["'none'"]],
    ["frame-ancestors", ["'none'"]],
    ["base-uri", ["'self'"]],
    ["form-action", ["'self'"]],
  ];
  return directives.map(([name, values]) => `${name} ${values.join(" ")}`).join("; ");
}

const securityHeaders = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy() },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  // Private members-only tool: keep every URL out of search engines.
  { key: "X-Robots-Tag", value: "noindex, nofollow" },
];

const nextConfig: NextConfig = {
  turbopack: {
    root: process.cwd(),
  },
  poweredByHeader: false,
  env: {
    NEXT_PUBLIC_APP_VERSION: appVersion,
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
      {
        // The browser must always fetch the latest service worker.
        source: "/sw.js",
        headers: [
          {
            key: "Content-Type",
            value: "application/javascript; charset=utf-8",
          },
          {
            key: "Cache-Control",
            value: "no-cache, no-store, must-revalidate",
          },
          {
            key: "Service-Worker-Allowed",
            value: "/",
          },
        ],
      },
      {
        source: "/icons/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=86400, stale-while-revalidate=604800",
          },
        ],
      },
    ];
  },
  async redirects() {
    // Installed PWAs and old bookmarks may still open the pre-v1 URLs (ARCHITECTURE §7.1).
    // Temporary (307) so browsers don't cache them forever.
    return [
      { source: "/dashboard", destination: "/calendar", permanent: false },
      { source: "/shift-board", destination: "/board", permanent: false },
      { source: "/post-shift", destination: "/post", permanent: false },
      { source: "/notifications", destination: "/alerts", permanent: false },
      { source: "/schedule-setup", destination: "/profile", permanent: false },
    ];
  },
};

export default nextConfig;
