import type { NextConfig } from "next";

const localNetworkDevOrigins = [
  "10.*.*.*",
  "172.16.*.*",
  "172.17.*.*",
  "172.18.*.*",
  "172.19.*.*",
  "172.20.*.*",
  "172.21.*.*",
  "172.22.*.*",
  "172.23.*.*",
  "172.24.*.*",
  "172.25.*.*",
  "172.26.*.*",
  "172.27.*.*",
  "172.28.*.*",
  "172.29.*.*",
  "172.30.*.*",
  "172.31.*.*",
  "192.168.*.*",
  "169.254.*.*",
];

const nextConfig: NextConfig = {
  // Allow Next dev HMR when opening the app from another device on the local network.
  allowedDevOrigins: localNetworkDevOrigins,
  devIndicators: false,
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "**.supabase.co",
        pathname: "/storage/v1/object/public/staff-photos/**",
      },
      {
        protocol: "https",
        hostname: "www.luchtvaartnieuws.nl",
        pathname: "/sites/default/files/**",
      },
    ],
  },
};

export default nextConfig;
// noah was hier
