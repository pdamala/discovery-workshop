const express = require('express')
const Anthropic = require('@anthropic-ai/sdk')

const app = express()
app.use(express.json())
app.use(express.static('public'))

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

// ── Modules config ──────────────────────────────────────────────────────────
const MODULES = {
  WM: {
    label: 'SAP WM — Warehouse Management',
    scenario: 'SAP WM Classic Warehouse Management blueprint discovery',
    topics: [
      { id: 'org', label: 'Warehouse Organisation Structure', question: 'How many physical warehouse locations are in scope, and what is their relationship to SAP plants and storage locations today?', options: ['One warehouse, one plant — straightforward mapping', 'Multiple warehouses under one plant', 'Multiple warehouses across multiple plants', 'Warehouse structure not yet defined'] },
      { id: 'storage', label: 'Storage Types & Bin Structure', question: 'What types of physical storage exist or are planned in the warehouse?', options: ['Bulk floor storage only', 'Racking / shelving with fixed bin locations', 'Mixed — bulk, racking and specialist zones', 'Automated / high-bay racking (ASRS)'] },
      { id: 'inbound', label: 'Inbound & Goods Receipt', question: 'What is the primary source of inbound goods into the warehouse?', options: ['Purchase orders from external vendors (MM-PO)', 'Stock transport orders from other plants (STO)', 'Production order completions from shop floor (PP)', 'Mix of all inbound types'] },
      { id: 'outbound', label: 'Outbound & Goods Issue', question: 'What triggers outbound movements from the warehouse?', options: ['Sales orders and customer deliveries (SD)', 'Production supply — issuing to production orders (PP)', 'Stock transfers to other plants or locations', 'Mix of outbound scenarios'] },
      { id: 'inventory', label: 'Inventory & Stock Management', question: 'How does the customer currently manage stock accuracy and inventory counting?', options: ['Annual full physical stock take — operations stop', 'Cycle counting — ongoing rolling counts', 'Ad hoc counts only — no structured process', 'No formal counting process in place'] },
      { id: 'integration', label: 'Integration & Master Data', question: 'Which SAP modules or external systems must integrate with the warehouse processes?', options: ['MM and FI only', 'MM + SD + FI', 'MM + SD + PP + FI — full supply chain', 'SAP plus external WMS or logistics systems'] }
    ]
  },
  FICO: {
    label: 'SAP FI/CO — Finance & Controlling',
    scenario: 'SAP Finance and Controlling blueprint discovery',
    topics: [
      { id: 'org', label: 'Finance Organisation Structure', question: 'What is the legal and financial reporting structure that needs to be reflected in SAP?', options: ['Single company code — one legal entity', 'Multiple company codes — multiple legal entities', 'Group structure requiring consolidation', 'Joint ventures or partnership structures'] },
      { id: 'gl', label: 'General Ledger & Chart of Accounts', question: 'What is the current state of the chart of accounts and general ledger?', options: ['Existing chart of accounts to migrate into SAP', 'New chart of accounts to be designed from scratch', 'Group chart of accounts plus local charts per entity', 'Multiple legacy charts to harmonise into one'] },
      { id: 'appar', label: 'Accounts Payable & Receivable', question: 'What are the current pain points in procure-to-pay and order-to-cash?', options: ['Manual invoice processing — no automation', 'Payment terms and cash discount management issues', 'Manual reconciliation between sub-ledger and GL', 'Multi-currency and cross-border payment complexity'] },
      { id: 'controlling', label: 'Controlling & Cost Management', question: 'How does the business currently track costs and profitability?', options: ['Cost centres only — departmental cost tracking', 'Cost centres plus profit centres — P&L by business unit', 'Product costing — cost of goods manufactured', 'Profitability analysis (CO-PA) by customer or product'] },
      { id: 'reporting', label: 'Financial Reporting Requirements', question: 'What are the primary financial reporting obligations SAP must support?', options: ['Statutory reporting — local GAAP only', 'IFRS alongside local GAAP — parallel ledgers needed', 'Group consolidation reporting', 'Management reporting and KPI dashboards'] },
      { id: 'migration', label: 'Data Migration & Cutover', question: 'What financial data needs to be migrated into SAP at go-live?', options: ['Open items only — AP, AR, GL balances', 'Full transaction history for current fiscal year', 'Multi-year history migration required', 'Asset register and fixed asset history included'] }
    ]
  },
  MM: {
    label: 'SAP MM — Materials Management',
    scenario: 'SAP Materials Management blueprint discovery',
    topics: [
      { id: 'org', label: 'Procurement Organisation Structure', question: 'How is procurement organised today and how should it map into SAP?', options: ['Centralised procurement — one purchasing organisation', 'Decentralised — each plant procures independently', 'Hybrid — central contracts, local purchase orders', 'Group-level procurement across multiple company codes'] },
      { id: 'materials', label: 'Material Master & Master Data', question: 'What is the current state of material master data?', options: ['Clean structured data — migration straightforward', 'Data spread across multiple systems — needs consolidation', 'Inconsistent data — significant cleansing needed', 'No structured master — to be created fresh in SAP'] },
      { id: 'procurement', label: 'Procurement Process Design', question: 'What procurement processes need to be designed in the SAP blueprint?', options: ['Standard purchase requisition to PO to goods receipt', 'Framework agreements — contracts and scheduling agreements', 'Service procurement — external labour and services', 'MRP-driven procurement from production planning'] },
      { id: 'inventory', label: 'Inventory Management', question: 'How is inventory currently managed and what must change in SAP?', options: ['Plant and storage location level only', 'Batch management required — expiry dates and lot tracking', 'Serial number tracking for individual items', 'Consignment or pipeline materials in scope'] },
      { id: 'valuation', label: 'Material Valuation', question: 'How should materials be valued in SAP?', options: ['Standard price for manufactured goods', 'Moving average price for traded and raw materials', 'Split valuation — same material valued differently by batch or plant', 'Not yet decided — needs finance alignment'] }
    ]
  },
  SD: {
    label: 'SAP SD — Sales & Distribution',
    scenario: 'SAP Sales and Distribution blueprint discovery',
    topics: [
      { id: 'org', label: 'Sales Organisation Structure', question: 'How is the sales organisation structured and how should it map into SAP?', options: ['Single sales org — one country, one channel', 'Multiple sales orgs — different regions or business units', 'Multiple distribution channels — direct, wholesale, online', 'Complex matrix — multiple orgs, channels and divisions'] },
      { id: 'order', label: 'Order Management Process', question: 'What types of sales orders and customer transactions are in scope?', options: ['Standard sales orders only', 'Rush orders, scheduling agreements and contracts', 'Returns, credit memos and debit memos', 'Third-party and drop-shipment orders'] },
      { id: 'pricing', label: 'Pricing & Discount Structure', question: 'How complex is the pricing structure that needs to be configured in SD?', options: ['Simple — one price list per material', 'Customer-specific pricing and discount agreements', 'Complex — multiple condition types, scales, promotions', 'Transfer pricing for intercompany sales'] },
      { id: 'delivery', label: 'Delivery & Shipping', question: 'What are the outbound delivery and shipping requirements?', options: ['Single plant fulfilment from one location', 'Multi-plant — partial deliveries and consolidation', 'Third-party logistics (3PL) integration', 'Drop-shipment — vendor ships direct to customer'] },
      { id: 'billing', label: 'Billing & Revenue', question: 'What billing scenarios must the blueprint cover?', options: ['Standard invoice on goods issue', 'Milestone billing for projects or contracts', 'Subscription or periodic billing', 'Revenue recognition under IFRS 15 required'] }
    ]
  },
  PP: {
    label: 'SAP PP — Production Planning',
    scenario: 'SAP Production Planning blueprint discovery',
    topics: [
      { id: 'strategy', label: 'Production Strategy', question: 'What is the primary production strategy used by the customer today?', options: ['Make-to-stock (MTS) — produce to forecast', 'Make-to-order (MTO) — produce on customer order', 'Engineer-to-order (ETO) — custom design per order', 'Mixed — some products MTS, others MTO'] },
      { id: 'bom', label: 'Bill of Materials & Product Structure', question: 'How complex are the bills of materials that need to be set up in SAP PP?', options: ['Simple single-level BOMs — few components', 'Multi-level BOMs — assemblies within assemblies', 'Variant BOMs — configurable products with many options', 'Co-products or by-products produced simultaneously'] },
      { id: 'routing', label: 'Routing & Work Centres', question: 'How is the manufacturing process structured in terms of work centres and operations?', options: ['Simple — few work centres, minimal routing steps', 'Standard routings with defined sequence per product', 'Rate routings — repetitive manufacturing on lines', 'Complex — parallel operations and sub-contracting'] },
      { id: 'planning', label: 'Production Planning & MRP', question: 'How does the customer currently plan production and material requirements?', options: ['Fully manual — spreadsheets and experience', 'Basic MRP run but mostly manual adjustments', 'MRP with capacity levelling', 'Advanced planning tool (APO/IBP) alongside PP'] },
      { id: 'shopfloor', label: 'Shop Floor Execution', question: 'How is production order execution and confirmation managed today?', options: ['Paper-based — manual recording, supervisor enters SAP', 'Basic SAP confirmation at order level', 'Operation-level confirmation with goods movements', 'MES integration — shop floor system feeds SAP in real time'] }
    ]
  },
  HR: {
    label: 'SAP HR/HCM — Human Capital Management',
    scenario: 'SAP HR / HCM blueprint discovery',
    topics: [
      { id: 'org', label: 'HR Organisation Structure', question: 'What is the organisational structure that needs to be reflected in SAP HR?', options: ['Single country, single legal entity', 'Multiple countries — different legal requirements per country', 'Matrix organisation — employees report to multiple managers', 'Complex group with shared services HR model'] },
      { id: 'scope', label: 'HR Process Scope', question: 'Which HR processes are in scope for the blueprint?', options: ['Core HR only — employee master data and org management', 'Core HR plus payroll', 'Core HR, payroll plus time management', 'Full HCM suite including talent and recruitment'] },
      { id: 'payroll', label: 'Payroll Design', question: 'How is payroll currently processed and what must change?', options: ['In-house payroll — to be run in SAP', 'Outsourced payroll — SAP HR feeds external provider', 'Currently manual — full redesign needed', 'Multiple payrolls — different rules per country or type'] },
      { id: 'time', label: 'Time & Attendance', question: 'How are working time and absences managed today?', options: ['Manual timesheets — paper or spreadsheet', 'Time clock system — needs SAP integration', 'Manager approval of time online', 'Shift planning and complex work schedule rules in scope'] },
      { id: 'data', label: 'Employee Data & Migration', question: 'What is the current state of employee data to be migrated into SAP?', options: ['Structured in current HR system — clean migration possible', 'Spread across multiple systems — consolidation needed', 'Significant data quality gaps', 'No existing HR system — data created fresh in SAP'] }
    ]
  },
  SAC: {
    label: 'SAP Analytics Cloud — Planning & Analytics',
    scenario: 'SAP Analytics Cloud blueprint discovery',
    topics: [
      { id: 'purpose', label: 'Primary Use Case & Scope', question: 'What is the primary business driver for implementing SAP Analytics Cloud?', options: ['Replace existing financial planning and budgeting tools', 'Build management reporting and dashboards on SAP data', 'Enable self-service analytics for business users', 'Replace BPC or BW-based planning with SAC Planning'] },
      { id: 'data', label: 'Data Sources & Architecture', question: 'Where will SAC source its data from?', options: ['SAP S/4HANA live connection — real-time data', 'SAP BW or BW/4HANA — pre-modelled data warehouse', 'Mix of SAP and non-SAP sources', 'Non-SAP only — flat files, cloud or third-party ERP'] },
      { id: 'planning', label: 'Planning Process Design', question: 'If planning is in scope, how is the planning process structured today?', options: ['Top-down — central finance sets targets, business units allocate', 'Bottom-up — business units build plans, finance consolidates', 'Driver-based — key metrics drive the financial model', 'Rolling forecast — continuous reforecast not annual budget'] },
      { id: 'users', label: 'User Groups & Access', question: 'Who will use SAC and what type of access do they need?', options: ['Finance team only — central planning and reporting', 'Finance plus business unit controllers — distributed planning', 'Broad business users — self-service dashboards', 'Executive leadership — read-only KPI views only'] },
      { id: 'governance', label: 'Data Governance', question: 'What is the biggest data governance challenge the SAC blueprint must address?', options: ['Multiple versions of the truth — different teams use different numbers', 'No single master data model — inconsistent hierarchies', 'Data latency — reporting lags behind operations', 'No clear data ownership — roles and responsibilities undefined'] }
    ]
  }
}

// ── API: Get modules list ────────────────────────────────────────────────────
app.get('/api/modules', (req, res) => {
  const list = Object.entries(MODULES).map(([k, v]) => ({ key: k, label: v.label }))
  res.json(list)
})

// ── API: Get topics for a module ─────────────────────────────────────────────
app.get('/api/topics/:moduleKey', (req, res) => {
  const mod = MODULES[req.params.moduleKey]
  if (!mod) return res.status(404).json({ error: 'Module not found' })
  res.json(mod.topics)
})

// ── API: AI follow-up question ───────────────────────────────────────────────
app.post('/api/followup', async (req, res) => {
  const { module_key, topic_id, topic_responses, all_responses } = req.body
  const mod = MODULES[module_key]
  if (!mod) return res.status(400).json({ error: 'Invalid module' })

  const topic = mod.topics.find(t => t.id === topic_id)
  if (!topic) return res.status(400).json({ error: 'Invalid topic' })

  if ((topic_responses || []).length >= 6) {
    return res.json({ topic_complete: true })
  }

  const topicHistory = (topic_responses || [])
    .map(r => 'Q: ' + r.question + '\nA: ' + r.answer)
    .join('\n\n')

  const otherContext = (all_responses || [])
    .filter(r => r.topic_id !== topic_id)
    .map(r => '[' + r.topic_label + '] ' + r.question + ' -> ' + r.answer)
    .join('\n')

  const prompt = [
    'You are a senior SAP solution architect running a BLUEPRINT DISCOVERY workshop.',
    'Module: ' + mod.label,
    'Scope: ' + mod.scenario,
    'Current blueprint topic: ' + topic.label,
    '',
    otherContext ? 'Already captured from other topics:\n' + otherContext + '\n' : '',
    topicHistory ? 'Conversation so far on this topic:\n' + topicHistory + '\n' : '',
    'YOUR ROLE: Build a solution blueprint. Ask ONE focused question that uncovers:',
    '- Current state: what the customer has TODAY (systems, processes, volumes)',
    '- Future state: what they need SAP to do',
    '- Pain points and gaps',
    '- Key SAP configuration and design decisions',
    '- Integration, data migration, and change management scope',
    '',
    'RULES:',
    '1. One question only — the single most valuable next blueprint question',
    '2. Build directly on the last answer — probe the specifics revealed',
    '3. Use real SAP terminology: plants, company codes, storage locations, transaction codes, config objects',
    '4. Options must be specific and realistic for this customer situation — not generic',
    '5. Use type text when you need a name, number, system name or date',
    '6. Never repeat anything already answered',
    '7. Set topic_complete true when current state, future state, design decisions and pain points are all understood',
    '',
    'Return ONLY one of these three JSON formats — no markdown, no explanation:',
    '',
    'Options: {"topic_complete":false,"question":"...","type":"options","options":["A","B","C","D"]}',
    'Text: {"topic_complete":false,"question":"...","type":"text","hint":"e.g. ..."}',
    'Done: {"topic_complete":true}'
  ].join('\n')

  try {
    const message = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 500,
      messages: [{ role: 'user', content: prompt }]
    })
    const raw = ((message.content.find(b => b.type === 'text') || {}).text || '{}')
    const clean = raw.replace(/```json/g, '').replace(/```/g, '').trim()
    return res.json(JSON.parse(clean))
  } catch (err) {
    console.error('Claude error:', err.message)
    return res.json({
      topic_complete: false,
      question: 'Can you describe the current process for ' + topic.label + ' and the main pain point you need SAP to solve?',
      type: 'text',
      hint: 'e.g. currently manual, takes 3 days, data quality issues'
    })
  }
})

// ── API: Export CSV ──────────────────────────────────────────────────────────
app.post('/api/export-csv', (req, res) => {
  const { meta, responses, module_label } = req.body
  const esc = v => '"' + String(v || '').replace(/"/g, '""') + '"'
  const headers = ['#', 'Session', 'Customer', 'Consultant', 'Date', 'Module', 'Topic', 'Type', 'Question', 'Answer']
  const rows = responses.map((r, i) => [i + 1, meta.session, meta.customer, meta.consultant, meta.date, module_label, r.topic_label, r.phase === 'ai' ? 'AI follow-up' : 'Opening', r.question, r.answer])
  const csv = [headers, ...rows].map(r => r.map(esc).join(',')).join('\n')
  res.setHeader('Content-Type', 'text/csv')
  res.setHeader('Content-Disposition', 'attachment; filename="Workshop_' + (meta.customer || 'session').replace(/\s+/g, '_') + '_' + meta.date + '.csv"')
  res.send(csv)
})

// ── API: Export Word (HTML opened in Word) ───────────────────────────────────
app.post('/api/export-word', (req, res) => {
  const { meta, responses, module_label, scenario } = req.body
  const byTopic = {}
  responses.forEach(r => {
    if (!byTopic[r.topic_label]) byTopic[r.topic_label] = []
    byTopic[r.topic_label].push(r)
  })
  const topicNames = [...new Set(responses.map(r => r.topic_label))]

  const html = '<!DOCTYPE html><html><head><meta charset="UTF-8"/><style>' +
    'body{font-family:Calibri,Arial,sans-serif;max-width:820px;margin:40px auto;color:#111;font-size:11pt;line-height:1.6}' +
    'h1{font-size:20pt;color:#1a56db;border-bottom:3px solid #1a56db;padding-bottom:8px}' +
    'h2{font-size:14pt;color:#1e3a5f;margin-top:28px;border-left:4px solid #1a56db;padding-left:10px}' +
    'h3{font-size:11pt;color:#374151;margin-top:16px;font-weight:600}' +
    '.meta{width:100%;border-collapse:collapse;margin:16px 0 28px}' +
    '.meta td{padding:5px 10px;border:1px solid #BFDBFE;font-size:10pt}' +
    '.meta td:first-child{font-weight:600;background:#EFF6FF;width:160px;color:#1e3a5f}' +
    'table.r{width:100%;border-collapse:collapse;margin:10px 0 20px;font-size:10pt}' +
    'table.r th{background:#1a56db;color:#fff;padding:7px 10px;text-align:left}' +
    'table.r td{padding:7px 10px;border-bottom:1px solid #e5e7eb;vertical-align:top}' +
    'table.r tr:nth-child(even) td{background:#EFF6FF}' +
    '.footer{margin-top:40px;font-size:9pt;color:#9ca3af;border-top:1px solid #e5e7eb;padding-top:8px;text-align:center}' +
    '</style></head><body>' +
    '<h1>SAP Discovery Workshop Blueprint</h1>' +
    '<table class="meta">' +
    '<tr><td>Customer</td><td>' + meta.customer + '</td></tr>' +
    '<tr><td>Consultant</td><td>' + meta.consultant + '</td></tr>' +
    '<tr><td>Date</td><td>' + meta.date + '</td></tr>' +
    '<tr><td>Session ID</td><td>' + meta.session + '</td></tr>' +
    '<tr><td>Module</td><td>' + module_label + '</td></tr>' +
    '<tr><td>Topics covered</td><td>' + topicNames.length + '</td></tr>' +
    '<tr><td>Questions answered</td><td>' + responses.length + '</td></tr>' +
    '</table>' +
    '<h2>1. Executive Summary</h2>' +
    '<p>This blueprint captures findings from the SAP workshop with <strong>' + meta.customer + '</strong> on <strong>' + meta.date + '</strong>, facilitated by <strong>' + meta.consultant + '</strong>. The session covered ' + topicNames.length + ' topics with ' + responses.length + ' questions answered across the ' + module_label + ' scope.</p>' +
    '<h2>2. Per-Topic Blueprint Findings</h2>' +
    topicNames.map(function(topic) {
      var rows = byTopic[topic] || []
      return '<h3>' + topic + '</h3>' +
        '<table class="r"><tr><th style="width:38%">Question</th><th style="width:47%">Response</th><th>Type</th></tr>' +
        rows.map(function(r) {
          return '<tr><td>' + r.question + '</td><td>' + r.answer + '</td><td>' + (r.phase === 'ai' ? 'AI' : 'Open') + '</td></tr>'
        }).join('') + '</table>'
    }).join('') +
    '<h2>3. Key Design Decisions Required</h2>' +
    '<table class="r"><tr><th style="width:25%">Area</th><th style="width:50%">Decision / Finding</th><th>Priority</th></tr>' +
    topicNames.map(function(t) { return '<tr><td>' + t + '</td><td><em>Consultant to complete</em></td><td>High / Med / Low</td></tr>' }).join('') +
    '</table>' +
    '<h2>4. Recommended Next Steps</h2>' +
    '<table class="r"><tr><th>#</th><th>Action</th><th>Owner</th><th>Date</th></tr>' +
    '<tr><td>1</td><td>Review and validate this blueprint with stakeholders</td><td>' + meta.customer + '</td><td></td></tr>' +
    '<tr><td>2</td><td>Define SAP organisational structure and configuration design</td><td>' + meta.consultant + '</td><td></td></tr>' +
    '<tr><td>3</td><td>Confirm integration requirements with technical teams</td><td>Both</td><td></td></tr>' +
    '<tr><td>4</td><td>Agree data migration scope and approach</td><td>Both</td><td></td></tr>' +
    '<tr><td>5</td><td>Schedule blueprint sign-off workshop</td><td>' + meta.consultant + '</td><td></td></tr>' +
    '</table>' +
    '<h2>5. Full Response Log</h2>' +
    '<table class="r"><tr><th>#</th><th>Topic</th><th>Question</th><th>Answer</th></tr>' +
    responses.map(function(r, i) {
      return '<tr><td>' + (i+1) + '</td><td>' + r.topic_label + '</td><td>' + r.question + '</td><td>' + r.answer + '</td></tr>'
    }).join('') +
    '</table>' +
    '<div class="footer">SAP Discovery Workshop &middot; Session: ' + meta.session + ' &middot; ' + meta.date + '</div>' +
    '</body></html>'

  res.setHeader('Content-Type', 'application/msword')
  res.setHeader('Content-Disposition', 'attachment; filename="Blueprint_' + (meta.customer || 'workshop').replace(/\s+/g, '_') + '_' + meta.date + '.doc"')
  res.send(html)
})

// ── Serve the single-page app ────────────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(__dirname + '/public/index.html')
})

const PORT = process.env.PORT || 3000
app.listen(PORT, () => console.log('Running on port ' + PORT))

module.exports = app
