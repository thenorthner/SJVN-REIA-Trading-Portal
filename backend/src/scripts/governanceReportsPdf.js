/**
 * Governance and assurance reports — Activity, and (to follow) Audit,
 * Regulatory, Statutory, Operational and Internal MIS.
 * Layout primitives come from reportPdfKit so every report reads as one family.
 */
import {
  M, CONTENT_W, MUTED, RED, AMBER, GREEN, INK,
  rs, stamp, nowLabel, newDoc, header, kpiBand, sectionTitle, table, notes, ensureSpace, pageNumbers,
} from './reportPdfKit.js';

// ─── Activity report ──────────────────────────────────────────────────────
export function generateActivityReportPdf(r, meta, res) {
  const generatedAt = nowLabel();
  const t = r.totals;
  const scope = [
    r.filters.module ? `module ${r.filters.module}` : null,
    r.filters.user_id ? `user ${r.filters.user_id}` : null,
  ].filter(Boolean).join(', ');

  const ctx = {
    vertical: 'Governance',
    title: 'ACTIVITY REPORT',
    subtitle: `${r.window.from || 'start'} to ${r.window.to || 'date'}${scope ? ` · ${scope}` : ''}`,
    generatedAt,
  };
  const doc = newDoc(res, 'SJVN Activity Report', `SJVN_Activity_Report_${new Date().toISOString().slice(0, 10)}.pdf`);

  header(doc, ctx);
  let y = 84;

  y = kpiBand(doc, y, [
    { label: 'Business actions', value: String(t.business_actions) },
    { label: 'Sign-ins', value: String(t.sign_ins) },
    { label: 'Active users', value: String(t.distinct_users) },
    { label: 'Busiest day', value: r.busiest_day ? `${r.busiest_day.day.slice(5)} (${r.busiest_day.business_actions})` : '—' },
  ]);

  doc.fillColor(MUTED).font('Helvetica').fontSize(7.5).text(
    `${t.events} recorded event(s) in total. Sign-ins are counted separately throughout:`
    + ' they are the single most frequent event and would otherwise dominate every breakdown.',
    M, y, { width: CONTENT_W },
  );
  y += 22;

  y = sectionTitle(doc, y, 'Activity by module');
  y = table(doc, y, [
    { label: 'Module', w: 150, value: (x) => x.module || '—' },
    { label: 'Events', w: 110, align: 'right', value: (x) => x.events },
    { label: 'Business actions', w: 140, align: 'right', value: (x) => x.business_actions },
    { label: 'Users', w: 123, align: 'right', value: (x) => x.users },
  ], r.by_module, ctx);
  y += 18;

  y = sectionTitle(doc, y, 'Activity by user', 'Ordered by business actions. Top 20.');
  y = table(doc, y, [
    { label: 'User', w: 140, value: (x) => x.user_name },
    { label: 'Role', w: 100, value: (x) => x.user_role },
    { label: 'Business', w: 62, align: 'right', value: (x) => x.business_actions },
    { label: 'Events', w: 55, align: 'right', value: (x) => x.events },
    { label: 'Modules', w: 60, align: 'right', value: (x) => x.modules_touched },
    { label: 'Last seen', w: 106, align: 'right', value: (x) => stamp(x.last_seen) },
  ], r.by_user, ctx);
  y += 18;

  y = ensureSpace(doc, y, 160, ctx);
  y = sectionTitle(doc, y, 'Most frequent actions', 'Sign-ins excluded.');
  y = table(doc, y, [
    { label: 'Action', w: 240, value: (x) => x.action },
    { label: 'Module', w: 160, align: 'left', value: (x) => x.module || '—' },
    { label: 'Count', w: 123, align: 'right', value: (x) => x.count },
  ], r.top_actions, ctx);
  y += 18;

  y = ensureSpace(doc, y, 160, ctx);
  y = sectionTitle(doc, y, 'Daily activity');
  y = table(doc, y, [
    { label: 'Day', w: 130, value: (x) => x.day },
    { label: 'Business actions', w: 140, align: 'right', value: (x) => x.business_actions },
    { label: 'Sign-ins', w: 120, align: 'right', value: (x) => x.sign_ins },
    { label: 'Users', w: 133, align: 'right', value: (x) => x.users },
  ], r.daily, ctx);
  y += 18;

  y = ensureSpace(doc, y, 160, ctx);
  y = sectionTitle(doc, y, 'Recent activity', 'Most recent 60 business actions.');
  table(doc, y, [
    { label: 'When', w: 92, value: (x) => stamp(x.created_at) },
    { label: 'User', w: 96, value: (x) => x.user_name },
    { label: 'Role', w: 82, value: (x) => x.user_role },
    { label: 'Module', w: 62, value: (x) => x.module || '—' },
    { label: 'Action', w: 106, value: (x) => x.action },
    { label: 'Record', w: 85, value: (x) => x.entity_id || x.entity_type || '—' },
  ], r.recent, ctx);

  pageNumbers(doc);
  doc.end();
}

// ─── Regulatory report ────────────────────────────────────────────────────
export function generateRegulatoryReportPdf(r, meta, res) {
  const generatedAt = nowLabel();
  const t = r.totals;
  const ctx = {
    vertical: 'Compliance',
    title: 'REGULATORY REPORT',
    subtitle: 'Approval position and CERC filing status',
    generatedAt,
  };
  const doc = newDoc(res, 'SJVN Regulatory Report', `SJVN_Regulatory_Report_${new Date().toISOString().slice(0, 10)}.pdf`);

  header(doc, ctx);
  let y = 84;

  y = kpiBand(doc, y, [
    { label: 'Mandatory approvals verified', value: `${t.mandatory_verified} of ${t.mandatory}` },
    { label: 'Outstanding', value: String(t.mandatory_outstanding), tone: t.mandatory_outstanding ? RED : GREEN },
    { label: 'Filings overdue', value: String(t.filings_overdue), tone: t.filings_overdue ? RED : GREEN },
    { label: 'Margin cap breaches', value: String(t.margin_cap_breaches), tone: t.margin_cap_breaches ? RED : GREEN },
  ]);

  y = sectionTitle(doc, y, 'Approval completeness by counterparty',
    'Mandatory approvals only. Records marked not applicable are excluded from the denominator.');
  y = table(doc, y, [
    { label: 'Counterparty', w: 175, value: (x) => x.name },
    { label: 'Type', w: 60, value: (x) => x.entity_type },
    { label: 'Mandatory', w: 68, align: 'right', value: (x) => x.mandatory },
    { label: 'Verified', w: 60, align: 'right', value: (x) => x.mandatory_verified },
    { label: 'Outstanding', w: 75, align: 'right', value: (x) => x.mandatory_outstanding, colour: (x) => (x.mandatory_outstanding ? RED : GREEN) },
    { label: 'Complete', w: 85, align: 'right',
      value: (x) => (x.completeness_pct === null ? '—' : `${x.completeness_pct}%`),
      colour: (x) => (x.completeness_pct === 100 ? GREEN : x.completeness_pct >= 50 ? AMBER : RED) },
  ], r.by_entity, ctx);
  y += 18;

  y = sectionTitle(doc, y, 'Approval status mix');
  y = table(doc, y, [
    { label: 'Status', w: 300, value: (x) => x.status },
    { label: 'Records', w: 223, align: 'right', value: (x) => x.count },
  ], r.by_status, ctx);
  y += 18;

  y = ensureSpace(doc, y, 170, ctx);
  y = sectionTitle(doc, y, 'Outstanding mandatory approvals',
    'The action list — mandatory approvals not yet verified.');
  y = table(doc, y, [
    { label: 'Counterparty', w: 140, value: (x) => x.entity_name },
    { label: 'Approval', w: 200, value: (x) => x.label },
    { label: 'Status', w: 90, value: (x) => x.status, colour: () => AMBER },
    { label: 'Reference', w: 93, value: (x) => x.reference_no || '—' },
  ], r.gaps, ctx, { emptyMessage: 'No outstanding mandatory approvals.' });
  y += 18;

  y = ensureSpace(doc, y, 120, ctx);
  y = sectionTitle(doc, y, 'Approval validity');
  if (r.validity.note) {
    y = notes(doc, y, [r.validity.note]);
  } else {
    y = table(doc, y, [
      { label: 'Counterparty', w: 180, value: (x) => x.entity_name },
      { label: 'Approval', w: 200, value: (x) => x.label },
      { label: 'Valid until', w: 143, align: 'right', value: (x) => x.valid_until, colour: () => AMBER },
    ], r.validity.expiring_within_90_days, ctx, { emptyMessage: 'Nothing expiring within 90 days.' });
  }
  y += 18;

  y = ensureSpace(doc, y, 170, ctx);
  const cap = r.cerc.margin_cap;
  y = sectionTitle(doc, y, 'CERC Form-IV filing position',
    `Trading margin cap in force: Rs ${cap.low}/kWh where sale price is at or below Rs ${cap.price_threshold}/kWh, Rs ${cap.high}/kWh above it.`);
  y = table(doc, y, [
    { label: 'Form', w: 118, value: (x) => x.form_no },
    { label: 'Period', w: 55, value: (x) => x.period },
    { label: 'Status', w: 55, value: (x) => x.status, colour: (x) => (x.status === 'SUBMITTED' ? GREEN : AMBER) },
    { label: 'Due', w: 62, value: (x) => x.due_date || '—', colour: (x) => (x.is_overdue ? RED : INK) },
    { label: 'Volume MU', w: 60, align: 'right', value: (x) => x.total_volume_mu },
    { label: 'Margin', w: 68, align: 'right', value: (x) => rs(x.trading_margin) },
    { label: 'Rs/kWh', w: 48, align: 'right', value: (x) => x.avg_margin_per_unit },
    { label: 'Breach', w: 57, align: 'right', value: (x) => x.breach_count, colour: (x) => (x.breach_count ? RED : GREEN) },
  ], r.cerc.filings, ctx, { emptyMessage: 'No Form-IV records.' });
  y += 18;

  const overdue = r.cerc.filings.filter((f) => f.is_overdue);
  const breaching = r.cerc.filings.filter((f) => f.breach_count > 0);
  if (overdue.length || breaching.length) {
    y = ensureSpace(doc, y, 80, ctx);
    y = sectionTitle(doc, y, 'Points requiring attention');
    notes(doc, y, [
      ...overdue.map((f) => `${f.form_no} for ${f.period} is past its due date of ${f.due_date} and still ${f.status}.`),
      ...breaching.map((f) => `${f.form_no} records ${f.breach_count} transaction line(s) breaching the trading margin cap.`),
    ]);
  }

  pageNumbers(doc);
  doc.end();
}

// ─── Audit report ─────────────────────────────────────────────────────────
export function generateAuditReportPdf(r, meta, res) {
  const generatedAt = nowLabel();
  const ig = r.integrity;
  const sod = r.segregation_of_duties;
  const ctx = {
    vertical: 'Assurance',
    title: 'AUDIT REPORT',
    subtitle: `Control assurance${r.window.from || r.window.to ? ` · ${r.window.from || 'start'} to ${r.window.to || 'date'}` : ''}`,
    generatedAt,
  };
  const doc = newDoc(res, 'SJVN Audit Report', `SJVN_Audit_Report_${new Date().toISOString().slice(0, 10)}.pdf`);

  header(doc, ctx);
  let y = 84;

  y = kpiBand(doc, y, [
    { label: 'Chain integrity', value: ig.is_valid ? 'Verified' : 'BROKEN', tone: ig.is_valid ? GREEN : RED },
    { label: 'Records checked', value: String(ig.records_checked) },
    { label: 'Duty conflicts', value: String(sod.violation_count), tone: sod.violation_count ? RED : GREEN },
    { label: 'Privileged actions', value: String(r.privileged.total) },
  ]);

  // ── Integrity ──
  y = sectionTitle(doc, y, 'Audit trail integrity',
    'Every log entry is hash-chained to the one before it; the check re-hashes the whole chain.');
  y = notes(doc, y, [
    ig.is_valid
      ? `The chain is intact across all ${ig.records_checked} record(s). No entry has been altered or removed since it was written.`
      : `Integrity FAILED: ${ig.message} (record ${ig.broken_log_id}). Investigate immediately — a record has been altered or removed.`,
  ]);
  y += 10;

  // ── Segregation of duties ──
  y = ensureSpace(doc, y, 120, ctx);
  y = sectionTitle(doc, y, 'Segregation of duties',
    'The same person creating and approving one record. Bid maker-checker now blocks this at source; historical conflicts still surface here.');
  if (!sod.violation_count) {
    y = notes(doc, y, ['No segregation-of-duties conflicts found — creation and approval were performed by different users throughout.']);
    y += 10;
  } else {
    y = table(doc, y, [
      { label: 'Module', w: 90, value: (x) => x.module || '—' },
      { label: 'Record', w: 150, value: (x) => x.entityId },
      { label: 'User (created & approved)', w: 180, value: (x) => x.userName },
      { label: 'When', w: 103, align: 'right', value: (x) => stamp(x.timestamp) },
    ], sod.violations, ctx);
    y += 18;
  }

  // ── Privileged actions ──
  y = ensureSpace(doc, y, 150, ctx);
  y = sectionTitle(doc, y, 'Privileged actions',
    'Deletions, reversals, cancellations, overrides and validation waivers — actions that remove or overturn a record.');
  y = table(doc, y, [
    { label: 'Action', w: 260, value: (x) => x.action },
    { label: 'Module', w: 160, value: (x) => x.module || '—' },
    { label: 'Count', w: 103, align: 'right', value: (x) => x.count },
  ], r.privileged.by_action, ctx, { emptyMessage: 'No privileged actions in this period.' });
  y += 18;

  if (r.privileged.recent.length) {
    y = ensureSpace(doc, y, 150, ctx);
    y = sectionTitle(doc, y, 'Privileged actions — detail', 'Most recent 40.');
    y = table(doc, y, [
      { label: 'When', w: 92, value: (x) => stamp(x.created_at) },
      { label: 'User', w: 96, value: (x) => x.user_name },
      { label: 'Action', w: 110, value: (x) => x.action, colour: () => AMBER },
      { label: 'Module', w: 60, value: (x) => x.module || '—' },
      { label: 'Record', w: 90, value: (x) => x.entity_id || x.entity_type || '—' },
      { label: 'Reason', w: 75, value: (x) => x.reason || '—' },
    ], r.privileged.recent, ctx);
    y += 18;
  }

  // ── Reversals ──
  if (r.reversals.length) {
    y = ensureSpace(doc, y, 120, ctx);
    y = sectionTitle(doc, y, 'Financial reversals',
      'Append-only ledgers are corrected by an opposing entry, never by deletion. Each reversal is listed with its reason.');
    y = table(doc, y, [
      { label: 'When', w: 92, value: (x) => stamp(x.created_at) },
      { label: 'User', w: 100, value: (x) => x.user_name },
      { label: 'Action', w: 100, value: (x) => x.action },
      { label: 'Record', w: 96, value: (x) => x.entity_id || '—' },
      { label: 'Reason', w: 135, value: (x) => x.reason || '—' },
    ], r.reversals, ctx);
    y += 18;
  }

  y = ensureSpace(doc, y, 60, ctx);
  y = sectionTitle(doc, y, 'Data exports');
  notes(doc, y, [
    r.export_events
      ? `${r.export_events} data export event(s) were logged in this period.`
      : 'No data export events were logged in this period.',
  ]);

  pageNumbers(doc);
  doc.end();
}

// ─── Internal MIS report ──────────────────────────────────────────────────
export function generateMisReportPdf(r, meta, res) {
  const generatedAt = nowLabel();
  const ctx = {
    vertical: 'Management',
    title: 'INTERNAL MIS REPORT',
    subtitle: 'Enterprise portfolio · REIA + Power Trading',
    generatedAt,
  };
  const doc = newDoc(res, 'SJVN Internal MIS Report', `SJVN_Internal_MIS_${new Date().toISOString().slice(0, 10)}.pdf`);

  header(doc, ctx);
  let y = 84;

  const p = r.portfolio;
  y = kpiBand(doc, y, [
    { label: 'Portfolio value', value: rs(p.total_value) },
    { label: 'Capacity vs 20 GW', value: p.capacity_pct === null ? '—' : `${p.capacity_pct}%` },
    { label: 'Overall profitability', value: rs(p.overall_profitability), tone: p.overall_profitability >= 0 ? GREEN : RED },
    { label: 'Unresolved exposure', value: rs(r.risk.total_unresolved_exposure), tone: r.risk.total_unresolved_exposure > 0 ? AMBER : GREEN },
  ]);

  y = notes(doc, y, [r.executive_summary]);
  y += 8;

  // ── Portfolio ──
  y = sectionTitle(doc, y, 'Portfolio');
  y = table(doc, y, [
    { label: 'Measure', w: 300, value: (x) => x.k },
    { label: 'Value', w: 223, align: 'right', value: (x) => x.v },
  ], [
    { k: 'Total portfolio value', v: rs(p.total_value) },
    { k: 'Contracted capacity', v: `${p.contracted_capacity_mw} MW of ${p.target_capacity_mw} MW target` },
    { k: 'Overall profitability', v: rs(p.overall_profitability) },
    { k: 'Data completeness (energy records locked)', v: `${p.data_completeness_pct}%` },
  ], ctx);
  y += 18;

  // ── REIA ──
  y = sectionTitle(doc, y, 'REIA — Billing & Settlement', `${r.reia.months} month(s) of billing.`);
  y = table(doc, y, [
    { label: 'Measure', w: 300, value: (x) => x.k },
    { label: 'Amount', w: 223, align: 'right', value: (x) => rs(x.v), colour: (x) => x.tone },
  ], [
    { k: 'Total billed value', v: r.reia.billed_value },
    { k: 'Net profit', v: r.reia.net_profit, tone: r.reia.net_profit >= 0 ? GREEN : RED },
    { k: 'Collected', v: r.reia.collected, tone: GREEN },
    { k: 'Receivables outstanding', v: r.reia.receivables },
    { k: 'Payables outstanding', v: r.reia.payables },
    { k: 'Overdue receivables', v: r.reia.overdue, tone: r.reia.overdue > 0 ? RED : INK },
  ], ctx);
  y += 18;

  // ── Trading ──
  y = ensureSpace(doc, y, 140, ctx);
  y = sectionTitle(doc, y, 'Power Trading', `${r.trading.cleared_quantum_mw} MW cleared on exchange.`);
  y = table(doc, y, [
    { label: 'Stream', w: 200, value: (x) => x.stream },
    { label: 'Basis', w: 110, value: (x) => x.basis },
    { label: 'Margin', w: 213, align: 'right', value: (x) => rs(x.margin), colour: (x) => (x.margin >= 0 ? GREEN : RED) },
  ], r.trading.streams, ctx);
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(8)
    .text(`Net trading margin: ${rs(r.trading.net_margin)}   ·   Open access charges: ${rs(r.trading.open_access_charges)}`, M, y + 4);
  y += 22;

  // ── Risk rollup ──
  y = ensureSpace(doc, y, 160, ctx);
  y = sectionTitle(doc, y, 'Cross-module risk rollup',
    `Security coverage of unresolved exposure: ${Math.round(r.risk.security_coverage_pct)}%.`);
  y = table(doc, y, [
    { label: 'Risk item', w: 360, value: (x) => x.item },
    { label: 'Value', w: 163, align: 'right',
      value: (x) => (x.kind === 'money' ? rs(x.value) : String(x.value)),
      colour: (x) => (x.value > 0 ? (x.kind === 'money' ? RED : AMBER) : GREEN) },
  ], r.risk.items, ctx);
  y += 18;

  // ── Caveats ──
  if (r.caveats.length) {
    y = ensureSpace(doc, y, 80, ctx);
    y = sectionTitle(doc, y, 'Basis and data gaps');
    notes(doc, y, r.caveats);
  }

  pageNumbers(doc);
  doc.end();
}
