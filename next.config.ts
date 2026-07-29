import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  experimental: {
    // /modeles uploads email images through a server action, and the default
    // request cap is 1 MB — below the 2 MB the uploader itself accepts, which
    // would fail as an opaque request error rather than a readable message.
    serverActions: { bodySizeLimit: "3mb" },
  },
};

export default nextConfig;
