/**
 * The approval chain a hydro station bill climbs before it can be issued.
 *
 * SJVN routes each bill inside C&SO: whoever raises it sends it to a next
 * approver and names a final approver, and each approver in turn may approve,
 * reject, or forward it on to someone else before the final one signs. Only
 * then is the bill releasable.
 *
 * The chain is built a step at a time rather than laid out up front, because
 * who the next approver is genuinely changes as the bill moves — an approver
 * forwarding to a colleague is a normal step, not an exception.
 */
import db from '../db/index.js';
import { newId } from '../util.js';

export const SEGREGATION_REFUSAL =
  'Segregation of duties: whoever raised this bill cannot approve it. It needs a different approver.';

export const ACTIONS = ['APPROVE', 'REJECT', 'FORWARD'];

/**
 * Whether this user raising and approving the same bill would be one person
 * moving money end to end.
 *
 * Approval is what makes a bill payable to fifteen beneficiaries, so it is the
 * one control worth being strict about. Identity is compared on the recorded
 * user id; a bill with no id recorded falls back to the name, which can in
 * principle catch two people who share one — and that is the safe direction to
 * err in, because being asked for a second approver costs a message while
 * letting the maker clear their own bill is the failure the control exists for.
 */
export function makerCheckerConflict(bill, user) {
  if (!bill || !user) return null;
  if (bill.created_by && user.id) {
    return bill.created_by === user.id ? SEGREGATION_REFUSAL : null;
  }
  if (bill.prepared_by && (bill.prepared_by === user.name || bill.prepared_by === user.email)) {
    return SEGREGATION_REFUSAL;
  }
  return null;
}

/** The step currently waiting on someone, if any. */
export function pendingStep(billId) {
  return db.prepare(
    `SELECT * FROM hydro_bill_approvals WHERE bill_id = ? AND status = 'PENDING' LIMIT 1`,
  ).get(billId) || null;
}

/** The whole chain, in the order it happened. */
export function approvalTrail(billId) {
  return db.prepare(
    'SELECT * FROM hydro_bill_approvals WHERE bill_id = ? ORDER BY level, created_at',
  ).all(billId);
}

function nextLevel(billId) {
  const row = db.prepare(
    'SELECT COALESCE(MAX(level), 0) m FROM hydro_bill_approvals WHERE bill_id = ?',
  ).get(billId);
  return row.m + 1;
}

function resolveApprover(userId) {
  const u = db.prepare('SELECT id, name, email, role, is_active FROM users WHERE id = ?').get(userId);
  if (!u) throw Object.assign(new Error(`No user with id ${userId}`), { status: 400 });
  if (!u.is_active) throw Object.assign(new Error(`${u.name} is not an active user`), { status: 400 });
  return u;
}

/**
 * Send a bill into approval.
 *
 * The final approver is named at the start and stays fixed: it is the signature
 * the beneficiaries' bill goes out on, and letting each step rewrite it would
 * mean nobody could say in advance who is accountable for the bill.
 */
export function sendForApproval(bill, { nextApproverId, finalApproverId, comments, user }) {
  if (bill.status !== 'DRAFT') {
    throw Object.assign(new Error(`${bill.bill_no} is ${bill.status} — only a draft can be sent for approval`), { status: 400 });
  }
  if (bill.approval_status === 'IN_APPROVAL') {
    throw Object.assign(new Error(`${bill.bill_no} is already with an approver`), { status: 409 });
  }
  if (bill.approval_status === 'APPROVED') {
    throw Object.assign(new Error(`${bill.bill_no} is already approved`), { status: 409 });
  }
  if (!nextApproverId || !finalApproverId) {
    throw Object.assign(new Error('Both a next approver and a final approver are required'), { status: 400 });
  }

  const next = resolveApprover(nextApproverId);
  const final = resolveApprover(finalApproverId);

  const conflict = makerCheckerConflict(bill, next);
  if (conflict) throw Object.assign(new Error(conflict), { status: 400 });

  const isFinal = next.id === final.id;
  const id = newId('HBA');
  db.transaction(() => {
    db.prepare(`
      INSERT INTO hydro_bill_approvals
        (id, bill_id, level, approver_user_id, approver_name, is_final, status, comments)
      VALUES (?, ?, ?, ?, ?, ?, 'PENDING', ?)
    `).run(id, bill.id, nextLevel(bill.id), next.id, next.name, isFinal ? 1 : 0, comments || null);
    db.prepare(`
      UPDATE hydro_station_bills
      SET approval_status = 'IN_APPROVAL', final_approver_id = ?, final_approver_name = ?,
          updated_at = datetime('now')
      WHERE id = ?
    `).run(final.id, final.name, bill.id);
  })();

  return {
    step_id: id,
    with: next.name,
    final_approver: final.name,
    is_final_step: isFinal,
  };
}

/**
 * Act on the step a bill is waiting at.
 *
 * APPROVE at a non-final step needs somewhere to send it next, so the caller
 * either names the next approver or says this is the final signature — which is
 * the "tick the Final box" the desk knows.
 */
export function actOnApproval(bill, { action, comments, nextApproverId, markFinal, user }) {
  if (!ACTIONS.includes(action)) {
    throw Object.assign(new Error(`action must be one of ${ACTIONS.join(', ')}`), { status: 400 });
  }
  const step = pendingStep(bill.id);
  if (!step) {
    throw Object.assign(new Error(`${bill.bill_no} is not waiting on an approval`), { status: 400 });
  }
  if (step.approver_user_id && user?.id && step.approver_user_id !== user.id) {
    throw Object.assign(
      new Error(`${bill.bill_no} is with ${step.approver_name}, not you`),
      { status: 403 },
    );
  }
  const conflict = makerCheckerConflict(bill, user);
  if (conflict) throw Object.assign(new Error(conflict), { status: 400 });
  if (!comments) {
    throw Object.assign(new Error('An approval decision must carry a comment'), { status: 400 });
  }

  const close = db.prepare(`
    UPDATE hydro_bill_approvals SET status = ?, comments = ?, acted_at = datetime('now') WHERE id = ?
  `);

  if (action === 'REJECT') {
    db.transaction(() => {
      close.run('REJECTED', comments, step.id);
      db.prepare(`UPDATE hydro_station_bills SET approval_status = 'REJECTED', updated_at = datetime('now') WHERE id = ?`)
        .run(bill.id);
    })();
    return { outcome: 'REJECTED', by: step.approver_name };
  }

  // Approving the last step is what releases the bill. A step is the last one
  // either because it was created as final, or because this approver says so.
  const finishing = action === 'APPROVE' && (step.is_final || markFinal);
  if (finishing) {
    db.transaction(() => {
      close.run('APPROVED', comments, step.id);
      db.prepare(`UPDATE hydro_station_bills SET approval_status = 'APPROVED', updated_at = datetime('now') WHERE id = ?`)
        .run(bill.id);
    })();
    return { outcome: 'APPROVED', by: step.approver_name };
  }

  // Otherwise it moves on, and needs somewhere to go.
  if (!nextApproverId) {
    throw Object.assign(
      new Error('Name the next approver, or mark this as the final approval'),
      { status: 400 },
    );
  }
  const next = resolveApprover(nextApproverId);
  const nextConflict = makerCheckerConflict(bill, next);
  if (nextConflict) throw Object.assign(new Error(nextConflict), { status: 400 });

  const newStepId = newId('HBA');
  db.transaction(() => {
    close.run(action === 'FORWARD' ? 'FORWARDED' : 'APPROVED', comments, step.id);
    db.prepare(`
      INSERT INTO hydro_bill_approvals
        (id, bill_id, level, approver_user_id, approver_name, is_final, status)
      VALUES (?, ?, ?, ?, ?, ?, 'PENDING')
    `).run(
      newStepId, bill.id, nextLevel(bill.id), next.id, next.name,
      next.id === bill.final_approver_id ? 1 : 0,
    );
  })();

  return {
    outcome: action === 'FORWARD' ? 'FORWARDED' : 'APPROVED_AND_MOVED_ON',
    by: step.approver_name,
    now_with: next.name,
    is_final_step: next.id === bill.final_approver_id,
  };
}

/** Bills sitting in a given user's approval inbox. */
export function approvalInbox(userId) {
  return db.prepare(`
    SELECT b.id, b.bill_no, b.station_name, b.billing_month, b.bill_kind,
           b.total_charges, b.approval_status, a.id AS step_id, a.level, a.is_final,
           a.created_at AS waiting_since
    FROM hydro_bill_approvals a
    JOIN hydro_station_bills b ON b.id = a.bill_id
    WHERE a.status = 'PENDING' AND a.approver_user_id = ? AND b.status <> 'CANCELLED'
    ORDER BY a.created_at
  `).all(userId);
}
