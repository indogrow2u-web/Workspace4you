// ============================================================
// Workspace4You — Application ID generator
// Format: WA-YYYYMMDD-NNNNN (date the application was created +
// its zero-padded database id). Assigned right after the row is
// inserted, once we know the real id, so it's always unique.
// ============================================================

function buildApplicationCode(id, createdAt) {
  const d = createdAt ? new Date(createdAt) : new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const seq = String(id).padStart(5, '0');
  return `WA-${y}${m}${day}-${seq}`;
}

module.exports = { buildApplicationCode };
