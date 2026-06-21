export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'

const PREVIEW_TEXT = "Hi, this is calling from M.A.M.M.B.A Enterprises LLC — South Florida's premier medical courier. I'd love to connect and tell you more about our same-day delivery routes."

export async function POST(req: NextRequest) {
  try {
    const { voice_id } = await req.json()
    if (!voice_id) return NextResponse.json({ error: 'voice_id required' }, { status: 400 })

    const key = process.env.BLAND_API_KEY
    if (!key) return NextResponse.json({ error: 'BLAND_API_KEY not set' }, { status: 400 })

    const res = await fetch('https://api.bland.ai/v1/speak', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'authorization': key,
      },
      body: JSON.stringify({
        text:       PREVIEW_TEXT,
        voice_id:   voice_id,
        stream:     false,
      }),
    })

    if (!res.ok) {
      const err = await res.text()
      return NextResponse.json({ error: `Bland TTS error: ${err.slice(0, 200)}` }, { status: 500 })
    }

    const audioBuffer = await res.arrayBuffer()

    return new NextResponse(audioBuffer, {
      status: 200,
      headers: {
        'Content-Type':  'audio/wav',
        'Cache-Control': 'no-store',
      },
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
