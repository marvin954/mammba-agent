export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

export async function POST(req: NextRequest) {
  try {
    const { lead_id, script_override } = await req.json()

    // ── Guard: API key configured? ─────────────────────────
    const blandKey = process.env.BLAND_API_KEY
    if (!blandKey || blandKey.trim() === '') {
      return NextResponse.json(
        { error: 'Bland.ai API key not configured. Add BLAND_API_KEY to your Vercel environment variables.' },
        { status: 400 }
      )
    }

    const { data: lead, error } = await supabaseAdmin
      .from('leads')
      .select('*')
      .eq('id', lead_id)
      .single()

    if (error || !lead) {
      return NextResponse.json({ error: 'Lead not found' }, { status: 404 })
    }

    // ── Guard: phone number present? ───────────────────────
    if (!lead.phone || lead.phone === 'N/A' || lead.phone.trim() === '') {
      return NextResponse.json(
        { error: `No phone number on file for ${lead.name ?? 'this lead'}. Add a phone number in the CRM first.` },
        { status: 400 }
      )
    }

    const callScript = script_override || buildCallScript(lead)

    // ── App URL for webhook ────────────────────────────────
    const appUrl = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '') ?? ''
    const webhookUrl = appUrl ? `${appUrl}/api/webhooks/bland` : undefined

    const blandRes = await fetch('https://api.bland.ai/v1/calls', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'authorization': blandKey,
      },
      body: JSON.stringify({
        phone_number: lead.phone,
        task: callScript,
        voice: 'maya',
        reduce_latency: true,
        max_duration: 10,
        record: true,
        metadata: { lead_id: lead.id, company: lead.company ?? '' },
        ...(webhookUrl ? { webhook: webhookUrl } : {}),
        analysis_prompt: `Did the prospect agree to a meeting or request a proposal? Summarize the outcome in 1-2 sentences.`,
        analysis_schema: {
          agreed_to_meeting:   'boolean',
          requested_proposal:  'boolean',
          callback_requested:  'boolean',
          outcome_summary:     'string',
          objection_raised:    'string',
        }
      })
    })

    const blandData = await blandRes.json()

    if (!blandRes.ok) {
      return NextResponse.json(
        { error: `Bland.ai error: ${blandData?.message ?? blandData?.error ?? JSON.stringify(blandData)}` },
        { status: 500 }
      )
    }

    await supabaseAdmin.from('activity_log').insert({
      lead_id:   lead.id,
      channel:   'call',
      direction: 'outbound',
      summary:   `AI call initiated to ${lead.name ?? 'lead'} at ${lead.company ?? ''}`,
      body:    callScript,
      result:    'initiated',
    })

    await supabaseAdmin.from('leads').update({
      status:       'Called',
      touches:      (lead.touches || 0) + 1,
      last_contact: new Date().toISOString(),
    }).eq('id', lead.id)

    return NextResponse.json({ success: true, call_id: blandData.call_id })

  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// ── Safe helpers ───────────────────────────────────────────────
function firstName(name: string | null | undefined): string {
  if (!name || name.trim() === '') return 'there'
  return name.trim().split(' ')[0]
}

function safe(val: string | null | undefined, fallback = ''): string {
  return val?.trim() || fallback
}

function buildCallScript(lead: any): string {
  const name    = safe(lead.name,    'the contact')
  const title   = safe(lead.title,   'team member')
  const company = safe(lead.company, 'your organization')
  const county  = safe(lead.county,  'South Florida')
  const first   = firstName(lead.name)

  return `You are a professional sales representative for M.A.M.M.B.A Enterprises LLC,
South Florida's premier medical courier and logistics company. You are calling ${name},
who is the ${title} at ${company} in ${county} County.

Your goal is to have a brief, respectful conversation to explore whether M.A.M.M.B.A can
help them with same-day delivery, scheduled courier routes, or medical specimen transport.

OPENING: "Hi, may I speak with ${name}? … Hi ${first},
this is calling from M.A.M.M.B.A Enterprises LLC. We're a South Florida medical courier
company and we help facilities like ${company} with reliable same-day delivery and
scheduled routes. I'll be brief — do you have about 90 seconds?"

DISCOVERY QUESTIONS (ask 1-2 max):
- "How are deliveries currently handled at ${company}?"
- "Do you ever have urgent or same-day delivery needs?"
- "Are there any reliability issues with your current courier?"

IF INTERESTED: "I'd love to send you a quick proposal showing exactly what a dedicated
route for ${company} would look like and cost. Can I get your email to send that over?"

IF NOT INTERESTED: "Completely understand. Can I ask — is it that you're fully satisfied
with your current setup, or just not the right time?" Then politely close.

IF NO ANSWER: Do not leave a voicemail — hang up. The system will send a ringless voicemail separately.

Always be professional, never pushy. Keep the call under 5 minutes.`
}
