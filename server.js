const express = require('express')
const Anthropic = require('@anthropic-ai/sdk')
const path = require('path')

const app = express()
app.use(express.json())
app.use(express.static(path.join(__dirname, 'public')))

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

app.get('/api/health', async function(req, res) {
  try {
    var msg = await client.messages.create({ model: 'claude-sonnet-4-5', max_tokens: 20, messages: [{ role: 'user', content: 'Say OK' }] })
    res.json({ status: 'ok', claude: msg.content[0].text })
  } catch (err) {
    res.json({ status: 'error', error: err.message })
  }
})

// Each phase is a FIXED single question — no AI, no done:true
// Only deep_discovery uses AI and can signal completion
app.post('/api/next-question', async function(req, res) {
  var body = req.body
  var phase = body.phase || 'greenfield_brownfield'
  var context = body.context || {}
  var responses = body.responses || []

  // Fixed phases return a hardcoded question — no risk of looping
  if (phase === 'greenfield_brownfield') {
    return res.json({
      done: false,
      question: 'Is this a new implementation from scratch, or do you have existing systems you are transforming?',
      type: 'options',
      options: [
        'Greenfield — brand new implementation, no existing system',
        'Brownfield — we have existing systems to transform or migrate',
        'Hybrid — new areas being added alongside existing systems',
        'Not yet decided'
      ]
    })
  }

  if (phase === 'current_system') {
    return res.json({
      done: false,
      question: 'What is your primary technology platform today?',
      type: 'options',
      options: ['SAP', 'Oracle (EBS, Fusion or Cloud)', 'Microsoft Dynamics 365', 'Salesforce', 'Workday', 'Legacy / custom-built systems', 'Multiple systems — no single platform']
    })
  }

  if (phase === 'functional_area') {
    return res.json({
      done: false,
      question: 'Which functional area does this engagement primarily focus on?',
      type: 'options',
      options: ['Finance & Controlling', 'Sales & Customer Management', 'Procurement & Supply Chain', 'Human Resources & Payroll', 'Manufacturing & Operations', 'Data & Analytics', 'IT Infrastructure & Integration', 'Other']
    })
  }

  if (phase === 'specific_focus') {
    // AI generates specific options based on area + system
    var focusPrompt = 'A customer is implementing ' + (context.system || 'an enterprise system') + ' for ' + (context.area || 'their business') + '.\n\nGenerate ONE question asking what specific capability or process they want to focus on. Provide 5-6 specific, realistic options for this exact combination.\n\nReturn ONLY this JSON, no markdown:\n{"done":false,"question":"What specific capability or process do you want to focus on?","type":"options","options":["Option 1","Option 2","Option 3","Option 4","Option 5"]}'
    try {
      var msg = await client.messages.create({
        model: 'claude-sonnet-4-5', max_tokens: 400,
        messages: [{ role: 'user', content: focusPrompt }]
      })
      var raw = (msg.content.find(function(b){ return b.type==='text' })||{}).text || ''
      var clean = raw.replace(/```json/g,'').replace(/```/g,'').trim()
      var parsed = JSON.parse(clean)
      parsed.done = false  // never allow done:true from this phase
      return res.json(parsed)
    } catch(e) {
      return res.json({
        done: false,
        question: 'What specific capability or process do you want to focus on?',
        type: 'options',
        options: ['Core system implementation', 'Process optimisation', 'System integration', 'Reporting & analytics', 'Migration from legacy', 'Other — please describe']
      })
    }
  }

  if (phase === 'deep_discovery') {
    var deepCount = responses.filter(function(r){ return r.phase === 'deep_discovery' }).length
    // Hard cap — after 6 questions always complete
    if (deepCount >= 6) return res.json({ done: true })

    var history = responses.map(function(r){ return 'Q: ' + r.question + '\nA: ' + r.answer }).join('\n\n')

    var deepPrompt = [
      'You are a senior enterprise transformation consultant doing blueprint discovery.',
      'Customer context:',
      'Problem: ' + (context.problem || ''),
      'Approach: ' + (context.approach || ''),
      'System: ' + (context.system || ''),
      'Area: ' + (context.area || ''),
      'Focus: ' + (context.focus || ''),
      '',
      'Questions answered so far (' + deepCount + ' of max 6):',
      history,
      '',
      'Ask the single most valuable next blueprint question. Uncover: current state, future state, pain points, key design decisions, integration or migration needs.',
      'Rules: build on the last answer, be specific to their system and area, never repeat.',
      deepCount >= 5 ? 'This is the LAST question — make it count, then set done:true in your NEXT call.' : '',
      '',
      'Return ONLY valid JSON:',
      'Options: {"done":false,"question":"...","type":"options","options":["A","B","C","D"]}',
      'Free text: {"done":false,"question":"...","type":"text","hint":"e.g. ..."}',
      'If truly complete: {"done":true}'
    ].filter(Boolean).join('\n')

    try {
      var message = await client.messages.create({
        model: 'claude-sonnet-4-5', max_tokens: 500,
        messages: [{ role: 'user', content: deepPrompt }]
      })
      var raw = (message.content.find(function(b){ return b.type==='text' })||{}).text || '{}'
      var clean = raw.replace(/```json/g,'').replace(/```/g,'').trim()
      var result = JSON.parse(clean)
      // Safety: if done:true but fewer than 3 deep questions, keep going
      if (result.done && deepCount < 3) {
        result.done = false
        result.question = 'What is the biggest pain point in your current ' + (context.area || 'process') + ' that this project must solve?'
        result.type = 'text'
        result.hint = 'e.g. manual reconciliation, lack of real-time visibility, data in multiple systems'
      }
      return res.json(result)
    } catch(err) {
      console.error('deep_discovery error:', err.message)
      return res.json({
        done: false,
        question: 'What is the biggest pain point in your current ' + (context.area || 'process') + ' that this project must solve?',
        type: 'text',
        hint: 'e.g. manual processes, lack of visibility, disconnected systems'
      })
    }
  }

  return res.json({ done: true })
})

app.post('/api/summarise', async function(req, res) {
  var body = req.body
  var responses = body.responses || []
  var context = body.context || {}
  var level = body.level || 'executive'

  var history = responses.map(function(r, i){
    return (i+1) + '. Q: ' + r.question + '\n   A: ' + r.answer
  }).join('\n\n')

  var levelInstr = level === 'executive'
    ? 'EXECUTIVE LEVEL: plain business language, strategic decisions, business impact, high-level next steps. Concise.'
    : 'OPERATIONAL LEVEL: specific functional/technical detail, system names, process steps, configuration decisions, concrete next actions.'

  var prompt = [
    'Senior enterprise transformation consultant. Summarise this discovery workshop.',
    context.problem ? 'Problem: ' + context.problem : '',
    context.approach ? 'Approach: ' + context.approach : '',
    context.system ? 'System: ' + context.system : '',
    context.area ? 'Area: ' + context.area : '',
    context.focus ? 'Focus: ' + context.focus : '',
    '', 'Workshop responses:', history, '',
    levelInstr, '',
    'Use EXACTLY these four sections:',
    '1. WHAT WE COVERED\n2. CONCLUSIONS & IMPLICATIONS\n3. OPEN AREAS & GAPS\n4. RECOMMENDED NEXT STEPS',
    'Bullet points within each section. Reference specific answers. Be concrete.'
  ].filter(Boolean).join('\n')

  try {
    var message = await client.messages.create({
      model: 'claude-sonnet-4-5', max_tokens: 1500,
      messages: [{ role: 'user', content: prompt }]
    })
    var text = (message.content.find(function(b){ return b.type==='text' })||{}).text || ''
    res.json({ summary: text, level: level })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.post('/api/export-csv', function(req, res) {
  var body = req.body
  var esc = function(v){ return '"' + String(v||'').replace(/"/g,'""') + '"' }
  var headers = ['#','Session','Customer','Consultant','Date','Problem','Approach','System','Area','Focus','Phase','Question','Answer']
  var rows = (body.responses||[]).map(function(r,i){
    var c=body.context||{}; var m=body.meta||{}
    return [i+1,m.session,m.customer,m.consultant,m.date,c.problem,c.approach,c.system,c.area,c.focus,r.phase,r.question,r.answer]
  })
  var csv = [headers].concat(rows).map(function(r){ return r.map(esc).join(',') }).join('\n')
  res.setHeader('Content-Type','text/csv')
  res.setHeader('Content-Disposition','attachment; filename="Workshop_'+((body.meta||{}).customer||'session').replace(/\s+/g,'_')+'_'+((body.meta||{}).date||'')+'.csv"')
  res.send(csv)
})

app.post('/api/export-word', function(req, res) {
  var body = req.body
  var responses = body.responses||[]; var meta=body.meta||{}; var context=body.context||{}
  var summary=body.summary||''; var level=body.level||'executive'
  var respRows = responses.map(function(r,i){
    return '<tr><td>'+(i+1)+'</td><td>'+(r.phase||'')+'</td><td>'+r.question+'</td><td>'+r.answer+'</td></tr>'
  }).join('')
  var summaryHtml = summary
    ? '<h2>Summary ('+(level==='executive'?'Executive':'Operational')+')</h2><div style="white-space:pre-wrap;font-size:11pt;line-height:1.8">'+summary+'</div>'
    : '<h2>Summary</h2><p style="color:#9ca3af;font-style:italic">No summary generated.</p>'
  var html = '<!DOCTYPE html><html><head><meta charset="UTF-8"/><style>body{font-family:Calibri,Arial,sans-serif;max-width:820px;margin:40px auto;color:#111;font-size:11pt;line-height:1.6}h1{font-size:20pt;color:#1a56db;border-bottom:3px solid #1a56db;padding-bottom:8px;margin-bottom:16px}h2{font-size:14pt;color:#1e3a5f;margin-top:28px;border-left:4px solid #1a56db;padding-left:10px;margin-bottom:10px}.meta{width:100%;border-collapse:collapse;margin-bottom:24px}.meta td{padding:5px 10px;border:1px solid #BFDBFE;font-size:10pt}.meta td:first-child{font-weight:600;background:#EFF6FF;width:160px;color:#1e3a5f}table.r{width:100%;border-collapse:collapse;margin:10px 0 20px;font-size:10pt}table.r th{background:#1a56db;color:#fff;padding:7px 10px;text-align:left}table.r td{padding:7px 10px;border-bottom:1px solid #e5e7eb;vertical-align:top}table.r tr:nth-child(even) td{background:#f9fafb}.footer{margin-top:40px;font-size:9pt;color:#9ca3af;border-top:1px solid #e5e7eb;padding-top:8px;text-align:center}</style></head><body>'
  html += '<h1>Discovery Workshop — Blueprint</h1><table class="meta">'
  html += '<tr><td>Customer</td><td>'+(meta.customer||'')+'</td></tr>'
  html += '<tr><td>Consultant</td><td>'+(meta.consultant||'')+'</td></tr>'
  html += '<tr><td>Date</td><td>'+(meta.date||'')+'</td></tr>'
  html += '<tr><td>Session ID</td><td>'+(meta.session||'')+'</td></tr>'
  html += '<tr><td>Problem</td><td>'+(context.problem||'')+'</td></tr>'
  html += '<tr><td>Approach</td><td>'+(context.approach||'')+'</td></tr>'
  html += '<tr><td>System</td><td>'+(context.system||'N/A — Greenfield')+'</td></tr>'
  html += '<tr><td>Area</td><td>'+(context.area||'')+'</td></tr>'
  html += '<tr><td>Focus</td><td>'+(context.focus||'')+'</td></tr>'
  html += '<tr><td>Questions</td><td>'+responses.length+'</td></tr></table>'
  html += summaryHtml
  html += '<h2>Full Response Log</h2><table class="r"><tr><th>#</th><th>Phase</th><th>Question</th><th>Answer</th></tr>'+respRows+'</table>'
  html += '<div class="footer">Discovery Workshop &middot; '+(meta.session||'')+' &middot; '+(meta.date||'')+'</div></body></html>'
  res.setHeader('Content-Type','application/msword')
  res.setHeader('Content-Disposition','attachment; filename="Blueprint_'+(meta.customer||'workshop').replace(/\s+/g,'_')+'_'+(meta.date||'')+'.doc"')
  res.send(html)
})

app.get('*', function(req, res) {
  res.sendFile(path.join(__dirname, 'public', 'index.html'))
})

var PORT = process.env.PORT || 3000
app.listen(PORT, function(){ console.log('Running on port ' + PORT) })
module.exports = app
