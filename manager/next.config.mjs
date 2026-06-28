/** @type {import('next').NextConfig} */
const managerBasePath = process.env.NEXT_PUBLIC_MANAGER_BASE_PATH?.trim() || undefined;

const nextConfig = {
  output: "standalone",
  poweredByHeader: false,
  ...(managerBasePath ? { basePath: managerBasePath } : {}),
  turbopack: {
    root: import.meta.dirname
  }
};

export default nextConfig;
