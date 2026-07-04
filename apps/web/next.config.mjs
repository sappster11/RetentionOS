/** @type {import('next').NextConfig} */
const nextConfig = {
  // The AI layer is a workspace TS package consumed as source.
  transpilePackages: ['@retentionos/ai'],
}

export default nextConfig
