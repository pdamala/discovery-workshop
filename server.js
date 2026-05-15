const express = require('express')
const Anthropic = require('@anthropic-ai/sdk')
const path = require('path')

const app = express()
app.use(express.json())
app.use(express.static(path.join(__dirname, 'public')))

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

// ── Health ────────────────────────────────────────────────────────────────
app.get('/api/health', async function(req, res) {
  try {
    var msg = await client.messages.create({ model: 'claude-sonnet-4-5', max_tokens: 20, messages: [{ role: 'user', content: 'Say OK' }] })
    res.json({ status: 'ok', claude: msg.content[0].text })
  } catch (err) {
    res.json({ status: 'error', error: err.message })
  }
})

// ── Next question ─────────────────────────────────────────────────────────
var PHASES = ['greenfield_brownfield', 'current_system', 'functional_area', 'specific_focus', 'deep_discovery']

app.post('/api/next-question', async function(req, res) {
  var body = req.body
  var responses = body.responses || []
  var phase = body.phase || 'greenfield_brownfield'
  var context = body.context || {}

  var history = responses.map(function(r) {
    return 'Q: ' + r.question + '\nA: ' + r.answer
  }).join('\n\n')

  var systemPrompt = [
    'You are a senior enterprise transformation consultant conducting a discovery workshop.',
    'You are system-agnostic — SAP, Oracle, Microsoft Dynamics, Salesforce, Workday, or any platform.',
    'Goal: understand the customer well enough to produce a solution blueprint.',
    context.problem ? 'Problem statement: ' + context.problem : '',
    context.approach ? 'Approach: ' + context.approach : '',
    context.system ? 'Current/target system: ' + context.system : '',
    context.area ? 'Functional area: ' + context.area : '',
    context.focus ? 'Specific focus: ' + context.focus : '',
    history ? 'Conversation so far:\n' + history : ''
  ].filter(Boolean).join('\n')

  var userPrompt = buildPromptForPhase(phase, context, responses)

  try {
    var message = await client.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 600,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }]
    })
    var raw = (message.content.find(function(b) { return b.type === 'text' }) || {}).text || '{}'
    var clean = raw.replace(/```json/g, '').replace(/```/g, '').trim()
    res.json(JSON.parse(clean))
  } catch (err) {
    console.error('next-question error:', err.message)
    res.json({ done: false, question: 'Can you describe the main challenge you are trying to solve?', type: 'text', hint: 'Describe the current situation and what needs to change' })
  }
})

function buildPromptForPhase(phase, context, responses) {
  var fmt = 'Return ONLY valid JSON. No markdown, no explanation.\nOptions: {"done":false,"question":"...","type":"options","options":["A","B","C","D"]}\nText: {"done":false,"question":"...","type":"text","hint":"e.g. ..."}\nDone: {"done":true}'

  if (phase === 'greenfield_brownfield') {
    return 'Ask whether this is a new implementation (greenfield) or they have existing systems to transform (brownfield). Give 3-4 clear, specific options.\n\n' + fmt
  }
  if (phase === 'current_system') {
    return 'The customer has existing systems. Ask what their primary technology platform is. Include SAP, Oracle, Microsoft Dynamics 365, Salesforce, Workday, Legacy / custom-built, and Multiple systems.\n\n' + fmt
  }
  if (phase === 'functional_area') {
    return 'Ask which functional area this engagement covers. Options: Finance & Controlling, Sales & Customer Management, Procurement & Supply Chain, Human Resources & Payroll, Manufacturing & Operations, Data & Analytics, IT Infrastructure & Integration, Other.\n\n' + fmt
  }
  if (phase === 'specific_focus') {
    return 'Based on functional area "' + context.area + '" and system "' + (context.system || 'new implementation') + '", ask what specific capability or process they want to focus on. Generate 5-6 realistic, specific options for this combination.\n\n' + fmt
  }
  if (phase === 'deep_discovery') {
    var count = responses.filter(function(r) { return r.phase === 'deep_discovery' }).length
    if (count >= 8) return '{"done":true}'
    return [
      'Ask ONE focused blueprint discovery question that uncovers:',
      '- Current state: what exists today (processes, systems, volumes, pain points)',
      '- Future state: what they need to achieve',
      '- Key design decisions and configuration choices',
      '- Integration, data migration, or change management needs',
      '',
      'Rules:',
      '1. Build directly on the LAST answer — probe what was just revealed',
      '2. Be specific to their system (' + (context.system || 'their platform') + ') and area (' + (context.area || 'their focus') + ')',
      '3. Options must be specific and realistic — not generic',
      '4. Use text type when you need a name, number, date or specific description',
      '5. Never repeat anything already answered',
      '6. Set done:true only when current state, future state, pain points and design decisions are fully understood',
      '', fmt
    ].join('\n')
  }
  return '{"done":true}'
}

// ── Summarise ─────────────────────────────────────────────────────────────
app.post('/api/summarise', async function(req, res) {
  var body = req.body
  var responses = body.responses || []
  var context = body.context || {}
  var level = body.level || 'executive'

  var history = responses.map(function(r, i) {
    return (i + 1) + '. Q: ' + r.question + '\n   A: ' + r.answer
  }).join('\n\n')

  var levelInstr = level === 'executive'
    ? 'Write an EXECUTIVE LEVEL summary: plain business language, strategic decisions, business impact, high-level next steps. Concise — executives want headlines not detail.'
    : 'Write an OPERATIONAL / TECHNICAL summary: specific functional and technical detail, system names, process steps, configuration decisions, concrete next actions.'

  var prompt = [
    'You are a senior enterprise transformation consultant. Summarise this discovery workshop.',
    context.problem ? 'Problem: ' + context.problem : '',
    context.approach ? 'Approach: ' + context.approach : '',
    context.system ? 'System: ' + context.system : '',
    context.area ? 'Functional area: ' + context.area : '',
    context.focus ? 'Focus: ' + context.focus : '',
    '',
    'Workshop responses:',
    history,
    '',
    levelInstr,
    '',
    'Structure the summary with EXACTLY these four numbered sections:',
    '1. WHAT WE COVERED',
    '2. CONCLUSIONS & IMPLICATIONS',
    '3. OPEN AREAS & GAPS',
    '4. RECOMMENDED NEXT STEPS',
    '',
    'Use bullet points within each section. Reference specific answers given. Be concrete.'
  ].filter(Boolean).join('\n')

  try {
    var message = await client.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 1500,
      messages: [{ role: 'user', content: prompt }]
    })
    var text = (message.content.find(function(b) { return b.type === 'text' }) || {}).text || ''
    res.json({ summary: text, level: level })
  } catch (err) {
    console.error('summarise error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

// ── Export CSV ────────────────────────────────────────────────────────────
app.post('/api/export-csv', function(req, res) {
  var body = req.body
  var esc = function(v) { return '"' + String(v || '').replace(/"/g, '""') + '"' }
  var headers = ['#', 'Session', 'Customer', 'Consultant', 'Date', 'Problem', 'Approach', 'System', 'Area', 'Focus', 'Phase', 'Question', 'Answer']
  var rows = (body.responses || []).map(function(r, i) {
    var c = body.context || {}; var m = body.meta || {}
    return [i + 1, m.session, m.customer, m.consultant, m.date, c.problem, c.approach, c.system, c.area, c.focus, r.phase, r.question, r.answer]
  })
  var csv = [headers].concat(rows).map(function(r) { return r.map(esc).join(',') }).join('\n')
  res.setHeader('Content-Type', 'text/csv')
  res.setHeader('Content-Disposition', 'attachment; filename="Workshop_' + ((body.meta || {}).customer || 'session').replace(/\s+/g, '_') + '_' + ((body.meta || {}).date || '') + '.csv"')
  res.send(csv)
})

// ── Export Word ───────────────────────────────────────────────────────────
app.post('/api/export-word', function(req, res) {
  var body = req.body
  var responses = body.responses || []
  var meta = body.meta || {}
  var context = body.context || {}
  var summary = body.summary || ''
  var level = body.level || 'executive'

  var respRows = responses.map(function(r, i) {
    return '<tr><td>' + (i + 1) + '</td><td>' + (r.phase || '') + '</td><td>' + r.question + '</td><td>' + r.answer + '</td></tr>'
  }).join('')

  var summaryHtml = summary
    ? '<h2>Summary (' + (level === 'executive' ? 'Executive Level' : 'Operational Level') + ')</h2><div style="white-space:pre-wrap;font-size:11pt;line-height:1.8;color:#111">' + summary + '</div>'
    : '<h2>Summary</h2><p style="color:#9ca3af;font-style:italic">No summary generated — use Pause or Stop during the workshop to generate one.</p>'

  var html = '<!DOCTYPE html><html><head><meta charset="UTF-8"/><style>' +
    'body{font-family:Calibri,Arial,sans-serif;max-width:820px;margin:40px auto;color:#111;font-size:11pt;line-height:1.6}' +
    'h1{font-size:20pt;color:#1a56db;border-bottom:3px solid #1a56db;padding-bottom:8px;margin-bottom:16px}' +
    'h2{font-size:14pt;color:#1e3a5f;margin-top:28px;border-left:4px solid #1a56db;padding-left:10px;margin-bottom:10px}' +
    '.meta{width:100%;border-collapse:collapse;margin-bottom:24px}' +
    '.meta td{padding:5px 10px;border:1px solid #BFDBFE;font-size:10pt}' +
    '.meta td:first-child{font-weight:600;background:#EFF6FF;width:160px;color:#1e3a5f}' +
    'table.r{width:100%;border-collapse:collapse;margin:10px 0 20px;font-size:10pt}' +
    'table.r th{background:#1a56db;color:#fff;padding:7px 10px;text-align:left}' +
    'table.r td{padding:7px 10px;border-bottom:1px solid #e5e7eb;vertical-align:top}' +
    'table.r tr:nth-child(even) td{background:#f9fafb}' +
    '.footer{margin-top:40px;font-size:9pt;color:#9ca3af;border-top:1px solid #e5e7eb;padding-top:8px;text-align:center}' +
    '</style></head><body>' +
    '<h1>Discovery Workshop — Blueprint</h1>' +
    '<table class="meta">' +
    '<tr><td>Customer</td><td>' + (meta.customer || '') + '</td></tr>' +
    '<tr><td>Consultant</td><td>' + (meta.consultant || '') + '</td></tr>' +
    '<tr><td>Date</td><td>' + (meta.date || '') + '</td></tr>' +
    '<tr><td>Session ID</td><td>' + (meta.session || '') + '</td></tr>' +
    '<tr><td>Problem</td><td>' + (context.problem || '') + '</td></tr>' +
    '<tr><td>Approach</td><td>' + (context.approach || '') + '</td></tr>' +
    '<tr><td>Current System</td><td>' + (context.system || 'N/A — Greenfield') + '</td></tr>' +
    '<tr><td>Functional Area</td><td>' + (context.area || '') + '</td></tr>' +
    '<tr><td>Specific Focus</td><td>' + (context.focus || '') + '</td></tr>' +
    '<tr><td>Questions Answered</td><td>' + responses.length + '</td></tr>' +
    '</table>' +
    summaryHtml +
    '<h2>Full Response Log</h2>' +
    '<table class="r"><tr><th>#</th><th>Phase</th><th>Question</th><th>Answer</th></tr>' + respRows + '</table>' +
    '<div class="footer">Discovery Workshop &middot; Session: ' + (meta.session || '') + ' &middot; ' + (meta.date || '') + '</div>' +
    '</body></html>'

  res.setHeader('Content-Type', 'application/msword')
  res.setHeader('Content-Disposition', 'attachment; filename="Blueprint_' + (meta.customer || 'workshop').replace(/\s+/g, '_') + '_' + (meta.date || '') + '.doc"')
  res.send(html)
})

// ── Serve frontend ────────────────────────────────────────────────────────
app.get('*', function(req, res) {
  res.sendFile(path.join(__dirname, 'public', 'index.html'))
})

var PORT = process.env.PORT || 3000
app.listen(PORT, function() { console.log('Running on port ' + PORT) })
module.exports = app
