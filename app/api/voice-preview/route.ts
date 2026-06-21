export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'

const PREVIEW_TEXT = "Hi, this is calling from M.A.M.M.B.A Enterprises LLC — South Florida's premier same-day medical courier. I'd love to show you how we can handle your delivery routes."

export async function POST(req: NextRequest) {
  try {
    const { voice_id } = await req.json()
    if (!voice_id) return NextResponse.json({ error: 'voice_id required' }, { status: 400 })

    const key = process.env.BLAND_API_KEY
    if (!key) return NextResponse.json({ error: 'BLAND_API_KEY not set' }, { status: 400 })

    // Bland TTS API — built-in voices use 'voice' field, not 'voice_id'
    const res = await fetch('https://api.bland.ai/v1/speak', {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'authorization': `Bearer ${key}`,
      },
      body: JSON.stringify({
        text:  PREVIEW_TEXT,
        voice: voice_id,
      }),
    })

    // Always read body — Bland returns JSON on error, WAV on success
    const contentType = res.headers.get('content-type') || ''

    if (!res.ok || contentType.includes('application/json')) {
      const errText = await res.text()
      let errMsg = errText.slice(0, 300)
      try { errMsg = JSON.parse(errText)?.message || errMsg } catch {}
      return NextResponse.json({ error: `Bland error (${res.status}): ${errMsg}` }, { status: 500 })
    }

    const audioBuffer = await res.arrayBuffer()

    if (audioBuffer.byteLength < 100) {
      return NextResponse.json({ error: 'Bland returned empty audio — voice may not support TTS' }, { status: 500 })
    }

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
