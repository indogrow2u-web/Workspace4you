// ============================================================
// Workspace4You — Server-side pricing engine
// Mirrors the client-side pricing logic in index.html so the
// amount charged via Razorpay is always computed from the live
// site config on the server — the browser only tells us which
// plan/duration/seat-count was picked, never how much to charge.
// ============================================================

const SEAT_CAP = 6;
const SOLD_OUT = { 'Power Seat': true, 'Glass Cabin': true };

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
    const rate = (opts && opts.duration === 'annual') ? def.annualRate : def.monthlyRate;
    base = 2 * rate;
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

module.exports = { computeTotal, seatFactor, SEAT_CAP, SOLD_OUT };
