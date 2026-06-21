export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

export async function POST(req: NextRequest) {
  try {
    const { lead_id, script_override } = await req.json()

    const blandKey = process.env.BLAND_API_KEY
    if (!blandKey || blandKey.trim() === '') {
      return NextResponse.json({ error: 'Bland.ai API key not configured.' }, { status: 400 })
    }

    const { data: lead, error } = await supabaseAdmin.from('leads').select('*').eq('id', lead_id).single()
    if (error || !lead) return NextResponse.json({ error: 'Lead not found' }, { status: 404 })

    if (!lead.phone || lead.phone === 'N/A' || lead.phone.trim() === '') {
      return NextResponse.json({ error: `No phone number on file for ${lead.name ?? 'this lead'}.` }, { status: 400 })
    }

    // ── Load persona from settings ─────────────────────────
    const { data: rows } = await supabaseAdmin.from('settings').select('key, value')
    const s: Record<string, string> = {}
    for (const r of rows || []) s[r.key] = r.value
    const persona = {
      name:    s.agent_name    || 'Marcus',
      role:    s.agent_role    || 'Logistics Coordinator',
      company: s.company_name  || 'Mamba Enterprises',
      tone:    s.agent_tone    || 'confident and direct, with warmth',
      voice:   s.bland_voice   || 'derek',
    }

    const callScript = script_override || buildCallScript(lead, persona)
    const appUrl     = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '') ?? ''
    const webhookUrl = appUrl ? `${appUrl}/api/webhooks/bland` : undefined

    const blandRes = await fetch('https://api.bland.ai/v1/calls', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'authorization': blandKey },
      body: JSON.stringify({
        phone_number: lead.phone,
        task:         callScript,
        voice:        persona.voice,
        reduce_latency: true,
        max_duration:   10,
        record:         true,
        metadata: { lead_id: lead.id, company: lead.company ?? '' },
        ...(webhookUrl ? { webhook: webhookUrl } : {}),
        analysis_prompt: 'Did the prospect agree to a meeting or request a proposal? Summarize in 1-2 sentences.',
        analysis_schema: {
          agreed_to_meeting: 'boolean', requested_proposal: 'boolean',
          callback_requested: 'boolean', outcome_summary: 'string', objection_raised: 'string',
        },
      }),
    })

    const blandData = await blandRes.json()
    if (!blandRes.ok) return NextResponse.json({ error: `Bland.ai error: ${blandData?.message ?? blandData?.error ?? JSON.stringify(blandData)}` }, { status: 500 })

    await supabaseAdmin.from('activity_log').insert({
      lead_id: lead.id, channel: 'call', direction: 'outbound',
      summary: `AI call initiated to ${lead.name ?? 'lead'} at ${lead.company ?? ''} — voice: ${persona.voice}`,
      body:    callScript, result: 'initiated',
    })
    await supabaseAdmin.from('leads').update({
      status: 'Called', touches: (lead.touches || 0) + 1, last_contact: new Date().toISOString(),
    }).eq('id', lead.id)

    return NextResponse.json({ success: true, call_id: blandData.call_id })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

function firstName(name: string | null | undefined): string {
  if (!name || name.trim() === '') return 'there'
  return name.trim().split(' ')[0]
}
function safe(val: string | null | undefined, fallback = ''): string {
  return val?.trim() || fallback
}

function buildCallScript(lead: any, p: { name: string; role: string; company: string; tone: string }): string {
  const leadName    = safe(lead.name,    'the contact')
  const leadTitle   = safe(lead.title,   'team member')
  const leadCompany = safe(lead.company, 'your organization')
  const county      = safe(lead.county,  'South Florida')
  const first       = firstName(lead.name)

  return `You are ${p.name}, a ${p.role} at ${p.company} — South Florida's premier same-day medical courier. Your tone is ${p.tone}. You are calling ${leadName}, ${leadTitle} at ${leadCompany} in ${county} County.

Your goal: have a brief, respectful conversation to explore whether ${p.company} can help with same-day delivery, scheduled courier routes, or medical specimen transport.

OPENING: "Hi, may I speak with ${leadName}? ... Hi ${first}, this is ${p.name} calling from ${p.company}. We're a South Florida medical courier and we help facilities like ${leadCompany} with reliable same-day delivery and scheduled routes. I'll be brief — do you have about 90 seconds?"

DISCOVERY (ask 1-2 max):
- "How are deliveries currently handled at ${leadCompany}?"
- "Do you ever have urgent or same-day delivery needs?"
- "Any reliability issues with your current courier?"

IF INTERESTED: "I'd love to send you a quick proposal showing exactly what a dedicated route for ${leadCompany} would look like. Can I get your email?"

IF NOT INTERESTED: "Completely understand — is it that you're fully satisfied, or just not the right time?" Then close politely.

IF VOICEMAIL: Hang up. The system will send a ringless voicemail separately.

Be professional, never pushy. Keep it under 5 minutes.`
}
