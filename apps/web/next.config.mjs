/** @type {import('next').NextConfig} */
const nextConfig = {
  // The AI, content, and db layers are workspace TS packages consumed as source.
  transpilePackages: [
    '@retentionos/ai',
    '@retentionos/content',
    '@retentionos/db',
    '@retentionos/engine',
    // Only the ./tools subpath is imported (tool defs as data — no MCP SDK/stdio code).
    '@retentionos/mcp-engine',
  ],
}

export default nextConfig
