export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

export async function GET() {
  const { data, error } = await supabaseAdmin.from('settings').select('key, value')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  const map: Record<string, string> = {}
  for (const row of data || []) map[row.key] = row.value
  return NextResponse.json(map)
}

export async function PATCH(req: NextRequest) {
  const updates = await req.json() as Record<string, string>
  for (const [key, value] of Object.entries(updates)) {
    const { error } = await supabaseAdmin
      .from('settings')
      .upsert({ key, value }, { onConflict: 'key' })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ success: true })
}
