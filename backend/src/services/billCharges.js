// Rules both settlement engines apply to a bill's lines once they are priced.
//
// A one-off charge — the NOAR application fee, a client registration fee, the
// SLDC consent fee — is due once per application, not once per bill. Pricing a
// contract month by month, or half-month by half-month, used to put it on every
// bill raised under the contract, so the client paid it two, three, four times.

/** A charge levied once per application rather than per MWh or per day. */
export function isOneOff(l) {
  return l.basis === 'flat' || /application/i.test(String(l.basis || ''));
}

/**
 * Leave out the one-off charges an earlier bill under the same contract has
 * already carried. `alreadyBilled` maps a line's description to the invoice
 * number that billed it.
 */
export function dropBilledOnce(lines, alreadyBilled = {}) {
  const warnings = [];
  const kept = lines.filter((l) => {
    const on = isOneOff(l) ? alreadyBilled[l.description] : null;
    if (on) warnings.push(`${l.description} was billed once already, on ${on}; it is not charged again`);
    return !on;
  });
  return { lines: kept, warnings };
}

/**
 * The value GST is charged on. Electricity is exempt from GST (HSN 2716), so on
 * an energy bill only the lines that are a service — the desk's trading margin
 * — are taxable; on the fee bills every line is.
 */
export function gstBase(isEnergyBill, lines) {
  const of = isEnergyBill ? lines.filter((l) => l.gst_taxable) : lines;
  return of.reduce((s, l) => s + l.amount, 0);
}

/**
 * What one unit of each is in MWh, so a register of bills raised in different
 * units adds like with like — a bill of 1 MU is 1,000 MWh, not 1.
 */
export const BOS_UNIT_MWH = { MWh: 1, kWh: 0.001, MU: 1000 };
