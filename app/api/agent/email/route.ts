export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { Resend } from 'resend'
import { supabaseAdmin } from '@/lib/supabase'

function getResend() {
  const key = process.env.RESEND_API_KEY
  if (!key) throw new Error('Missing RESEND_API_KEY env var')
  return new Resend(key)
}

export async function POST(req: NextRequest) {
  try {
    if (!process.env.RESEND_API_KEY) return NextResponse.json({ error: 'Resend not configured.' }, { status: 400 })

    const { lead_id, email_number = 1, subject_override, body_override } = await req.json()
    const { data: lead, error } = await supabaseAdmin.from('leads').select('*').eq('id', lead_id).single()
    if (error || !lead) return NextResponse.json({ error: 'Lead not found' }, { status: 404 })
    if (!lead.email) return NextResponse.json({ error: 'No email for this lead' }, { status: 400 })

    // ── Load persona ───────────────────────────────────────
    const { data: rows } = await supabaseAdmin.from('settings').select('key, value')
    const s: Record<string, string> = {}
    for (const r of rows || []) s[r.key] = r.value
    // Lead's detected language takes priority over active_agent setting
    const leadLang = (lead.preferred_language || 'auto').toLowerCase()
    const isSofia  = leadLang === 'spanish' || (leadLang === 'auto' && (s.active_agent || 'marcus') === 'sofia')
    const persona = isSofia ? {
      name: 'Sofia', role: 'Coordinadora de Logística',
      company: s.company_name || 'Mamba Enterprises',
      tone: 'cálida y profesional', language: 'spanish',
    } : {
      name:     s.agent_name   || 'Marcus',
      role:     s.agent_role   || 'Logistics Coordinator',
      company:  s.company_name || 'Mamba Enterprises',
      tone:     s.agent_tone   || 'confident and direct, with warmth',
      language: 'english',
    }

    let subject = subject_override
    let htmlBody = body_override
    if (!subject || !htmlBody) {
      const generated = await generateEmailWithClaude(lead, email_number, persona)
      subject  = subject  || generated.subject
      htmlBody = htmlBody || generated.html
    }

    const resend = getResend()
    const result = await resend.emails.send({
      from: `${persona.name} at ${persona.company} <${process.env.FROM_EMAIL}>`,
      to:   lead.email, subject, html: htmlBody,
      tags: [{ name: 'lead_id', value: lead.id }, { name: 'email_number', value: String(email_number) }],
    })

    await supabaseAdmin.from('activity_log').insert({
      lead_id: lead.id, channel: 'email', direction: 'outbound',
      summary: `Email ${email_number} sent to ${lead.name} — "${subject}"`,
      body:    htmlBody, result: 'sent',
    })
    await supabaseAdmin.from('leads').update({
      status: 'Emailed', touches: (lead.touches || 0) + 1,
      last_contact:  new Date().toISOString(),
      next_followup: new Date(Date.now() + 3 * 86400000).toISOString(),
      sequence_step: email_number,
    }).eq('id', lead.id)

    return NextResponse.json({ success: true, email_id: result.data?.id })
  } catch (err: any) { return NextResponse.json({ error: err.message }, { status: 500 }) }
}

async function generateEmailWithClaude(lead: any, emailNumber: number, p: { name: string; role: string; company: string; tone: string }) {
  const emailTypes = [
    'a cold introduction email — introduce yourself and the company, ask one discovery question, end with a CTA for a 10-minute call',
    'a value follow-up email — focus on the backup driver guarantee and cost savings vs in-house delivery',
    'a pain point email — ask directly if they have any weak links in their current delivery setup',
    'a social proof email — describe the reliability benefits other South Florida facilities experience',
    'a final breakup email — respectful close, leave the door open, ask for a referral',
  ]
  const emailType = emailTypes[Math.min(emailNumber - 1, emailTypes.length - 1)]
  const name    = (lead.name    ?? 'the contact').trim() || 'the contact'
  const title   = (lead.title   ?? 'decision maker').trim() || 'decision maker'
  const company = (lead.company ?? 'the organization').trim() || 'the organization'
  const county  = (lead.county  ?? 'South Florida').trim()   || 'South Florida'

  const prompt = `Write ${emailType} for ${name}, ${title} at ${company} in ${county} County, Florida.

You are ${p.name}, ${p.role} at ${p.company}. You represent ${p.company} — South Florida's premier same-day medical courier specializing in STAT dispatch, scheduled routes, and HIPAA-compliant specimen transport across Broward, Miami-Dade, and Palm Beach counties. Always refer to the company as '${p.company}' — never use any other company name.

Tone: ${p.tone}.
Their estimated monthly contract value: ${lead.monthly_value ?? 'TBD'}/mo.

Requirements:
- Subject line: compelling, under 8 words, no clickbait
- Body: professional, direct, under 150 words
- Single CTA only
- Sign off with a professional closing — leave the name as [AGENT_NAME] and role as [AGENT_ROLE]
- Language: write the ENTIRE email in ${ (p as any).language === "spanish" ? "Spanish" : "English"}

Respond ONLY with valid JSON, no markdown:
{"subject": "...", "body_plain": "...", "body_html": "..."}`

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY!, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 800, messages: [{ role: 'user', content: prompt }] }),
  })
  const data = await res.json()
  const text = data.content?.[0]?.text || '{}'
  const fill = (str: string) => str
    .replace(/\[AGENT_NAME\]|\[Your Name\]|\[name\]/gi, p.name)
    .replace(/\[AGENT_ROLE\]|\[Your Role\]/gi, p.role)
    .replace(/\[COMPANY\]/gi, p.company)
  try {
    const parsed = JSON.parse(text.replace(/```json|```/g, '').trim())
    return { subject: fill(parsed.subject || `Courier services for ${company}`), html: fill(parsed.body_html || `<p>${parsed.body_plain || ''}</p>`) }
  } catch {
    return {
      subject: `Reliable courier routes — ${company}`,
      html: `<p>Hi ${(lead.name ?? 'there').trim().split(' ')[0]},<br><br>This is ${p.name} from ${p.company}. We help South Florida facilities with same-day courier routes. Would you be open to a 10-minute call?<br><br>Best,<br>${p.name}<br>${p.role} — ${p.company}</p>`,
    }
  }
}
