export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  try {
    const { voice, phone } = await req.json()
    if (!voice) return NextResponse.json({ error: 'voice required' }, { status: 400 })
    if (!phone) return NextResponse.json({ error: 'Phone number required' }, { status: 400 })

    const key = process.env.BLAND_API_KEY
    if (!key) return NextResponse.json({ error: 'BLAND_API_KEY not set' }, { status: 400 })

    const res = await fetch('https://api.bland.ai/v1/calls', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'authorization': key },
      body: JSON.stringify({
        phone_number: phone,
        voice,
        max_duration: 2,
        task: `You are doing a voice test for M.A.M.M.B.A Enterprises LLC. Say exactly this and nothing else: "Hi, this is a test call from M.A.M.M.B.A Enterprises LLC. You are hearing the ${voice} voice. This is how your AI sales agent will sound on outbound calls. Have a great day." Then hang up.`,
        record: false,
      }),
    })

    const data = await res.json()
    if (!res.ok) return NextResponse.json({ error: data?.message || data?.error || 'Call failed' }, { status: 500 })

    return NextResponse.json({ success: true, call_id: data.call_id })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
