/** @type {import('next').NextConfig} */
const adminBasePath = process.env.NEXT_PUBLIC_ADMIN_BASE_PATH?.trim() || undefined;

const nextConfig = {
  output: "standalone",
  poweredByHeader: false,
  ...(adminBasePath ? { basePath: adminBasePath } : {}),
  turbopack: {
    root: import.meta.dirname
  }
};

export default nextConfig;
