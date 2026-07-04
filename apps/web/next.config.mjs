/** @type {import('next').NextConfig} */
const nextConfig = {
  // The AI and db layers are workspace TS packages consumed as source.
  transpilePackages: ['@retentionos/ai', '@retentionos/db'],
}

export default nextConfig
