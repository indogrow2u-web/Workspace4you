// ============================================================
// Workspace4You — Server-side pricing engine
// Mirrors the client-side pricing logic in index.html so the
// amount charged via Razorpay is always computed from the live
// site config on the server — the browser only tells us which
// plan/duration/seat-count was picked, never how much to charge.
// ============================================================

const SEAT_CAP = 6;
const SOLD_OUT = { 'Power Seat': true, 'Glass Cabin': true };

// Virtual Address commitment terms, in months. 'month' is the only
// non-committed option — everything else locks the customer in for that
// many months and is charged that many months' advance upfront (see
// computeTotal below), not just 1 month like 'month' gets.
const VA_TERM_MONTHS = { month: 1, annual: 12, '24month': 24, '36month': 36 };

function seatFactor(n) {
  const g = Math.floor(n / 3), r = n - g * 3;
  let factor = g * 2.25;
  if (r === 2) factor += 1.75;
  else if (r === 1) factor += 1;
  return factor;
}

function buildPackages(prices) {
  return {
    'Virtual Address': { type: 'virtual', monthlyRate: prices.virtualAddressMonthly, annualRate: prices.virtualAddressAnnual },
    'Business Starter': { type: 'onetime', service: prices.businessStarter, vaRate: prices.virtualAddressMonthly },
    'Day Pass': { type: 'day', service: prices.dayPass },
    'Open Desk': { type: 'seat', base: prices.openDesk },
    'Power Seat': { type: 'seat', base: prices.powerSeat },
    'Semi-Enclosed Cubicle': { type: 'seat', base: prices.semiEnclosed },
    'Glass Cabin': { type: 'seat', base: prices.glassCabin }
  };
}

// Returns the total payable amount (in rupees) for a plan, or null if the
// plan name is unknown or currently sold out.
function computeTotal(planName, opts, prices) {
  if (SOLD_OUT[planName]) return null;
  const packages = buildPackages(prices);
  const def = packages[planName];
  if (!def) return null;

  let base;
  if (def.type === 'virtual') {
    const dur = (opts && opts.duration) || 'month';
    const months = VA_TERM_MONTHS[dur] || 1;
    // Month-to-month: standard (higher) monthly rate, 1 month deposit +
    // 1 month advance -- unchanged from before. Any committed term
    // (12/24/36 months): the discounted annual rate, 1 month deposit +
    // the FULL committed term paid as advance upfront (e.g. 24 months
    // locks in 24 months' advance, not just 1) -- these are two
    // deliberately different rules, not the same formula with a
    // different month count.
    const rate = dur === 'month' ? def.monthlyRate : def.annualRate;
    base = rate * (1 + months);
  } else if (def.type === 'onetime') {
    base = def.vaRate + def.service;
  } else if (def.type === 'day') {
    base = def.service;
  } else if (def.type === 'seat') {
    const seats = Math.max(1, Math.min(SEAT_CAP, parseInt((opts && opts.seats) || 1, 10) || 1));
    base = 2 * Math.round(def.base * seatFactor(seats));
  } else {
    return null;
  }

  return base + Math.round(base * 0.18);
}

module.exports = { computeTotal, seatFactor, SEAT_CAP, SOLD_OUT, VA_TERM_MONTHS };
