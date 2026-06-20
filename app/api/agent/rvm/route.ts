export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

function safe(val: string | null | undefined, fallback = ''): string {
  return val?.trim() || fallback
}

function firstName(name: string | null | undefined): string {
  if (!name || name.trim() === '') return 'there'
  return name.trim().split(' ')[0]
}

export async function POST(req: NextRequest) {
  try {
    const slyEmail = process.env.SLYBROADCAST_EMAIL
    const slyPass  = process.env.SLYBROADCAST_PASSWORD
    const slyPhone = process.env.SLYBROADCAST_PHONE
    if (!slyEmail || !slyPass || !slyPhone) {
      return NextResponse.json(
        { error: 'Slybroadcast not configured.' },
        { status: 400 }
      )
    }

    const { lead_id } = await req.json()
    const { data: lead, error } = await supabaseAdmin.from('leads').select('*').eq('id', lead_id).single()
    if (error || !lead) return NextResponse.json({ error: 'Lead not found' }, { status: 404 })

    const phone = safe(lead.phone)
    if (!phone || phone === 'N/A') {
      return NextResponse.json(
        { error: `No phone number on file for ${safe(lead.name, 'this lead')}.` },
        { status: 400 }
      )
    }

    const rvmMessage = buildRVMScript(lead)

    const toDigits = (n: string) => {
      const d = n.replace(/\D/g, '')
      return d.length === 11 && d.startsWith('1') ? d.slice(1) : d
    }

    const formData = new URLSearchParams({
      c_uid:          slyEmail,
      c_password:     slyPass,
      c_phone:        toDigits(phone),
      c_record_audio: '0',
      c_audio_file:   'tts',
      c_tts_message:  rvmMessage,
      c_date:         'now',
      c_from_number:  toDigits(slyPhone),
    })

    const slyRes  = await fetch('https://www.mobile-sphere.com/gateway/vmb.php', {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body:    formData.toString(),
    })
    const slyText = await slyRes.text()
    const rvmOk   = slyText.toLowerCase().includes('ok') || slyText.toLowerCase().includes('success')

    await supabaseAdmin.from('activity_log').insert({
      lead_id:
