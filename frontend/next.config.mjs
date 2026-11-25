/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "export",
  basePath: process.env.NEXT_PUBLIC_BASE_PATH ?? (process.env.NODE_ENV === "production" ? "/crisis-averted" : ""),
  assetPrefix: process.env.NEXT_PUBLIC_BASE_PATH ?? (process.env.NODE_ENV === "production" ? "/crisis-averted/" : undefined),
  trailingSlash: true,
  images: { unoptimized: true },
};

export default nextConfig;
