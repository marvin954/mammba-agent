export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

export async function POST(req: NextRequest) {
  try {
    const { lead_id, script_override } = await req.json()

    const blandKey = process.env.BLAND_API_KEY
    if (!blandKey?.trim()) return NextResponse.json({ error: 'Bland.ai API key not configured.' }, { status: 400 })

    const { data: lead, error } = await supabaseAdmin.from('leads').select('*').eq('id', lead_id).single()
    if (error || !lead) return NextResponse.json({ error: 'Lead not found' }, { status: 404 })
    if (!lead.phone || lead.phone === 'N/A' || lead.phone.trim() === '')
      return NextResponse.json({ error: `No phone number on file for ${lead.name ?? 'this lead'}.` }, { status: 400 })

    // ── Load settings ──────────────────────────────────────
    const { data: rows } = await supabaseAdmin.from('settings').select('key, value')
    const s: Record<string, string> = {}
    for (const r of rows || []) s[r.key] = r.value

    // ── Determine language for this lead ───────────────────
    // 1. If lead has a detected preference → use it
    // 2. Else → use bilingual auto-detect script
    const leadLang = (lead.preferred_language || 'auto').toLowerCase()
    const isSofia  = leadLang === 'spanish'
    const isAuto   = leadLang === 'auto' || leadLang === '' || !leadLang

    const marcusPersona = {
      name:    s.agent_name   || 'Marcus',
      role:    s.agent_role   || 'Logistics Coordinator',
      company: s.company_name || 'Mamba Enterprises',
      tone:    s.agent_tone   || 'confident and direct, with warmth',
      voice:   s.bland_voice  || 'derek',
    }
    const sofiaPersona = {
      name:    'Sofia',
      role:    'Coordinadora de Logística',
      company: s.company_name || 'Mamba Enterprises',
      tone:    'cálida y profesional',
      voice:   'maya',
    }

    const persona   = isSofia ? sofiaPersona : marcusPersona
    const callScript = script_override || (
      isAuto   ? buildBilingualScript(lead, marcusPersona, sofiaPersona) :
      isSofia  ? buildSpanishScript(lead, sofiaPersona) :
                 buildEnglishScript(lead, marcusPersona)
    )

    const appUrl = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '') ?? ''

    const blandRes = await fetch('https://api.bland.ai/v1/calls', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'authorization': blandKey },
      body: JSON.stringify({
        phone_number:   lead.phone,
        task:           callScript,
        voice:          isAuto ? marcusPersona.voice : persona.voice,
        reduce_latency: true,
        max_duration:   10,
        record:         true,
        metadata: { lead_id: lead.id, company: lead.company ?? '' },
        ...(appUrl ? { webhook: `${appUrl}/api/webhooks/bland` } : {}),
        analysis_prompt: 'Detect which language the prospect spoke during this call — English or Spanish. Did they agree to a meeting or request a proposal? Summarize outcome in 1-2 sentences.',
        analysis_schema: {
          language_detected:  'string - must be exactly "english" or "spanish"',
          agreed_to_meeting:  'boolean',
          requested_proposal: 'boolean',
          callback_requested: 'boolean',
          outcome_summary:    'string',
          objection_raised:   'string',
        },
      }),
    })

    const blandData = await blandRes.json()
    if (!blandRes.ok) return NextResponse.json({ error: `Bland.ai error: ${blandData?.message ?? JSON.stringify(blandData)}` }, { status: 500 })

    await supabaseAdmin.from('activity_log').insert({
      lead_id: lead.id, channel: 'call', direction: 'outbound',
      summary: `AI call initiated to ${lead.name ?? 'lead'} at ${lead.company ?? ''} (${isAuto ? 'auto-detect' : persona.name})`,
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

function safe(v: string | null | undefined, f = ''): string { return v?.trim() || f }
function firstName(n: string | null | undefined): string { if (!n?.trim()) return 'there'; return n.trim().split(' ')[0] }

function buildBilingualScript(lead: any, marcus: any, sofia: any): string {
  const first   = firstName(lead.name)
  const name    = safe(lead.name, 'there')
  const company = safe(lead.company, 'your organization')
  const county  = safe(lead.county, 'South Florida')
  return `You are a bilingual AI sales agent representing ${marcus.company}. Your name is Marcus in English and Sofia in Spanish. You are ${marcus.tone}.

CRITICAL RULE: Listen carefully after your opening. If the prospect responds in Spanish, immediately switch to Spanish and stay in Spanish for the entire call. If they respond in English, stay in English. Mirror their language perfectly.

BILINGUAL OPENING — say this exactly:
"Hello, may I speak with ${name}? ... Hi ${first}! / ¡Hola ${first}! This is calling from ${marcus.company} — South Florida's same-day medical courier. / Somos ${marcus.company}, mensajería médica del sur de Florida. Do you have 90 seconds? / ¿Tiene 90 segundos?"

IF THEY RESPOND IN ENGLISH — continue as Marcus:
"Great! We specialize in reliable same-day delivery and scheduled courier routes for facilities like ${company} in ${county} County. How are deliveries currently handled at ${company}?"

IF THEY RESPOND IN SPANISH — continue as Sofia:
"¡Perfecto! Nos especializamos en entregas el mismo día y rutas programadas para instalaciones como ${company} en el condado de ${county}. ¿Cómo manejan actualmente las entregas en ${company}?"

CLOSING (in their language):
- English: "I'd love to send you a quick proposal. Can I get your email?"
- Spanish: "Me encantaría enviarle una propuesta. ¿Me puede dar su correo?"

IF VOICEMAIL: Hang up immediately. Never leave a message.
Professional, never pushy. Under 5 minutes.`
}

function buildEnglishScript(lead: any, p: any): string {
  const first = firstName(lead.name); const name = safe(lead.name, 'the contact')
  const title = safe(lead.title, 'team member'); const company = safe(lead.company, 'your organization'); const county = safe(lead.county, 'South Florida')
  return `You are ${p.name}, a ${p.role} at ${p.company}. Tone: ${p.tone}. Calling ${name}, ${title} at ${company} in ${county} County. Speak English only.

OPENING: "Hi, may I speak with ${name}? Hi ${first}, this is ${p.name} from ${p.company} — South Florida same-day medical courier. Do you have 90 seconds?"
DISCOVERY: "How are deliveries handled at ${company}?" / "Any urgent same-day needs?" / "Reliability issues with current courier?"
IF INTERESTED: "Can I get your email to send a proposal for ${company}?"
IF VOICEMAIL: Hang up. Never pushy. Under 5 minutes.`
}

function buildSpanishScript(lead: any, p: any): string {
  const first = firstName(lead.name); const name = safe(lead.name, 'usted')
  const title = safe(lead.title, 'miembro del equipo'); const company = safe(lead.company, 'su organización'); const county = safe(lead.county, 'el sur de Florida')
  return `Eres ${p.name}, ${p.role} en ${p.company}. Tono: ${p.tone}. Llamas a ${name}, ${title} en ${company} en ${county}. Habla ÚNICAMENTE en español.

APERTURA: "¿Puedo hablar con ${name}? Hola ${first}, soy ${p.name} de ${p.company} — mensajería médica el mismo día en el sur de Florida. ¿Tiene 90 segundos?"
PREGUNTAS: "¿Cómo manejan las entregas en ${company}?" / "¿Necesidades urgentes el mismo día?" / "¿Problemas con su mensajero actual?"
SI INTERESADO: "¿Me puede dar su correo para enviarle una propuesta?"
SI BUZÓN: Cuelgue. Nunca insistente. Menos de 5 minutos.`
}
