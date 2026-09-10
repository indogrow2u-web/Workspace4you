// ============================================================
// Workspace4You — Agreement template rendering
// Substitutes {{placeholders}} in an admin-authored template with the
// application's real data. Every substituted value is HTML-escaped —
// the template itself is admin-trusted HTML, but the values (customer
// name, business name, etc.) are customer-supplied and must not be
// able to inject markup into a document that gets displayed back to
// them (and to admins) as HTML.
// ============================================================

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderTemplate(content, vars) {
  return String(content).replace(/\{\{(\w+)\}\}/g, function (_, key) {
    return Object.prototype.hasOwnProperty.call(vars, key) ? escapeHtml(vars[key]) : '';
  });
}

function formatDate(d) {
  var dt = d instanceof Date ? d : new Date(d);
  return dt.getDate() + '/' + (dt.getMonth() + 1) + '/' + dt.getFullYear();
}

function addMonths(date, months) {
  var d = new Date(date);
  d.setMonth(d.getMonth() + months);
  return d;
}

// Builds the placeholder map for one application. `virtualAddress` comes
// from the live site config (contact.address) so it stays in sync with
// whatever the admin has set there.
function buildAgreementVars(app, virtualAddress) {
  var start = new Date();
  var end = addMonths(start, app.duration === 'annual' ? 12 : 1);
  var identifier = app.gstin || app.cin || app.llpin || app.udyam_number || app.pan || '—';
  var uses = Array.isArray(app.address_usage) ? app.address_usage.join(', ') : '';

  return {
    customerName: app.full_name || '',
    businessName: app.business_name || '',
    businessType: app.business_type || '',
    businessIdentifier: identifier,
    virtualAddress: virtualAddress || '',
    planName: app.plan_name || 'Virtual Address',
    duration: app.duration === 'annual' ? '12 Months' : 'Monthly',
    startDate: formatDate(start),
    endDate: formatDate(end),
    permittedUse: uses || 'as agreed',
    applicationCode: app.application_code || ''
  };
}

module.exports = { escapeHtml, renderTemplate, buildAgreementVars, formatDate, addMonths };
