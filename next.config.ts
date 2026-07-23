import type { NextConfig } from "next";
import { execFileSync } from "node:child_process";

function gitOutput(args: string[]): string | undefined {
  try {
    return execFileSync("git", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim() || undefined;
  } catch {
    return undefined;
  }
}

export function resolveLastSyncDate(
  environment: NodeJS.ProcessEnv = process.env,
): string {
  const explicitDate = environment.SKETCHYCUT_LAST_SYNC_DATE?.trim();
  if (explicitDate && /^\d{4}-\d{2}-\d{2}$/.test(explicitDate)) {
    return explicitDate;
  }

  const deployedCommit = environment.VERCEL_GIT_COMMIT_SHA?.trim();
  const localUpstream = gitOutput([
    "rev-parse",
    "--abbrev-ref",
    "--symbolic-full-name",
    "@{upstream}",
  ]);
  const commit = deployedCommit ?? localUpstream ?? "HEAD";
  return gitOutput(["show", "-s", "--format=%cs", commit]) ?? "unknown";
}

export function sketchyCutContentSecurityPolicy(
  environment: "development" | "production" | "test" | undefined = process.env.NODE_ENV,
  vercel: string | undefined = process.env.VERCEL,
  googleAnalyticsId: string | undefined = process.env.NEXT_PUBLIC_GOOGLE_ANALYTICS_ID,
): string {
  const developmentEval = environment === "development" ? " 'unsafe-eval'" : "";
  const analyticsEnabled = vercel === "1" && Boolean(googleAnalyticsId?.trim());
  const analyticsScript = analyticsEnabled ? " https://www.googletagmanager.com" : "";
  const analyticsImages = analyticsEnabled
    ? " https://www.google-analytics.com https://www.googletagmanager.com"
    : "";
  const analyticsConnections = analyticsEnabled
    ? " https://www.google-analytics.com https://region1.google-analytics.com"
    : "";
  return `default-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; frame-src https://www.youtube-nocookie.com; object-src 'none'; script-src 'self' 'unsafe-inline'${analyticsScript}${developmentEval}; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:${analyticsImages}; connect-src 'self'${analyticsConnections}; worker-src 'self' blob:; font-src 'self'; media-src 'none'; upgrade-insecure-requests`;
}

type WebpackConfiguration = {
  resolve?: {
    extensionAlias?: Record<string, string[]>;
  };
};

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  distDir: process.env.SKETCHYCUT_NEXT_DIST_DIR ?? ".next",
  env: {
    SKETCHYCUT_LAST_SYNC_DATE: resolveLastSyncDate(),
  },
  headers() {
    return Promise.resolve([{
      source: "/:path*",
      headers: [
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "X-Frame-Options", value: "DENY" },
        { key: "Referrer-Policy", value: "no-referrer" },
        { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
        {
          key: "Content-Security-Policy",
          value: sketchyCutContentSecurityPolicy()
        }
      ]
    }]);
  },
  webpack(config: WebpackConfiguration): WebpackConfiguration {
    config.resolve ??= {};
    config.resolve.extensionAlias = {
      ".js": [".ts", ".tsx", ".js"],
      ".mjs": [".mts", ".mjs"],
      ".cjs": [".cts", ".cjs"]
    };
    return config;
  }
};

export default nextConfig;
