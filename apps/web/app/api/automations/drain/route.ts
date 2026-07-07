// The dispatcher endpoint (docs/11): materializes due schedule runs and executes queued
// ones. Hit by Vercel Cron (vercel.json) every minute in production, or manually in dev.
// Gated by ROS_DRAIN_SECRET when set (send it as the x-drain-secret header); open when
// unset (local/dev convenience — the whole app is pre-auth today).
import { drainAutomationRuns } from '@retentionos/engine'
import { json, publicErrorResponse } from '@/lib/api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(req: Request) {
  try {
    const secret = process.env.ROS_DRAIN_SECRET
    if (secret && req.headers.get('x-drain-secret') !== secret) {
      return json({ error: { code: 'forbidden', message: 'Bad drain secret.' } }, 403)
    }
    const result = await drainAutomationRuns({ limit: 25 })
    return json(result)
  } catch (err) {
    return publicErrorResponse(err)
  }
}

// Vercel Cron sends GET.
export async function GET(req: Request) {
  return POST(req)
}
