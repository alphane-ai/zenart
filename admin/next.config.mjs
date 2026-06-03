/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  poweredByHeader: false,
  turbopack: {
    root: import.meta.dirname
  }
};

export default nextConfig;
