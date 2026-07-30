/**
 * Governance and assurance reports — Activity, and (to follow) Audit,
 * Regulatory, Statutory, Operational and Internal MIS.
 * Layout primitives come from reportPdfKit so every report reads as one family.
 */
import {
  M, CONTENT_W, MUTED,
  stamp, nowLabel, newDoc, header, kpiBand, sectionTitle, table, ensureSpace, pageNumbers,
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
