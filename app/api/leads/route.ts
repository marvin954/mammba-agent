import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const status = searchParams.get('status')
  const county = searchParams.get('county')

  let query = supabaseAdmin
    .from('leads')
    .select('*, activity_log(id, channel, created_at, summary)')
    .order('created_at', { ascending: false })

  if (status && status !== 'all') query = query.eq('status', status)
  if (county && county !== 'all') query = query.eq('county', county)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const { data, error } = await supabaseAdmin
    .from('leads')
    .insert({
      name:          body.name,
      title:         body.title,
      company:       body.company,
      phone:         body.phone,
      email:         body.email,
      county:        body.county,
      tier:          body.tier,
      industry:      body.industry,
      monthly_value: body.monthly_value,
      priority:      body.priority || 'Medium',
      notes:         body.notes,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data, { status: 201 })
}

export async function PATCH(req: NextRequest) {
  const body = await req.json()
  const { id, ...updates } = body

  const { data, error } = await supabaseAdmin
    .from('leads')
    .update(updates)
    .eq('id', id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  const { error } = await supabaseAdmin.from('leads').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
