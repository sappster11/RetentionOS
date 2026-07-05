/** @type {import('next').NextConfig} */
const nextConfig = {
  // The AI, content, and db layers are workspace TS packages consumed as source.
  transpilePackages: ['@retentionos/ai', '@retentionos/content', '@retentionos/db', '@retentionos/engine'],
}

export default nextConfig
