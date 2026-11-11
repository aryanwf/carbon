import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    unoptimized: true,
  },
};

export default nextConfig;

import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";

// Only `next dev` needs the local bindings proxy. Skipping it during
// `next build` avoids opening a remote Workers AI session (and requiring
// Cloudflare credentials) just to build.
if (process.env.NODE_ENV === "development") {
  initOpenNextCloudflareForDev();
}
