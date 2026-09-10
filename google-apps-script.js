// ============================================================
// WorkSpace4You — Google Apps Script (Write + Read)
// REPLACE your existing Code.gs with this entire file
// Then do: Deploy → Manage Deployments → Edit → New Version → Deploy
//
// OPTIONAL HARDENING: leads (name/phone/email) are readable by
// anyone who has this Web App's URL, since Apps Script URLs aren't
// truly secret. To lock that down, set SHARED_SECRET below to a
// long random string, redeploy, then:
//   - Set SHEETS_SHARED_SECRET in Vercel to the exact same value
//     (api/_sheets.js sends it on every write automatically)
//   - Append "?key=<that same value>" to the URL you save in
//     Admin Dashboard → Setup Guide (that's what the dashboard
//     uses to read leads)
// Until you do this, doGet/doPost behave exactly as before (open).
// ============================================================

var SHARED_SECRET = 'REPLACE_WITH_A_LONG_RANDOM_STRING';

function isKeyConfigured() {
  return SHARED_SECRET.indexOf('REPLACE_WITH') !== 0;
}

function checkKey(key) {
  if (!isKeyConfigured()) return true; // not opted in yet — behaves as before
  return key === SHARED_SECRET;
}

function doGet(e) {
  if (!checkKey(e.parameter && e.parameter.key)) {
    return ContentService
      .createTextOutput(JSON.stringify({ error: 'Unauthorized' }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  // Read all leads from sheet — used by Admin Dashboard
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  var lastRow = sheet.getLastRow();

  if (lastRow <= 1) {
    return ContentService
      .createTextOutput(JSON.stringify({ leads: [] }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  var data = sheet.getRange(2, 1, lastRow - 1, 8).getValues();
  var leads = data.map(function(row) {
    return {
      timestamp: row[0] ? String(row[0]) : '',
      name:      row[1] ? String(row[1]) : '',
      phone:     row[2] ? String(row[2]) : '',
      email:     row[3] ? String(row[3]) : '',
      plan:      row[4] ? String(row[4]) : '',
      amount:    row[5] ? String(row[5]).replace(/[₹,]/g, '') : '',
      status:    row[6] ? String(row[6]) : '',
      txnId:     row[7] ? String(row[7]) : ''
    };
  }).filter(function(r){ return r.name || r.phone; });

  return ContentService
    .createTextOutput(JSON.stringify({ leads: leads }))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  var data = JSON.parse(e.postData.contents);

  if (!checkKey(data.key)) {
    return ContentService
      .createTextOutput(JSON.stringify({ success: false, error: 'Unauthorized' }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();

  if (sheet.getLastRow() === 0) {
    var headers = ['Timestamp', 'Name', 'Phone', 'Email', 'Plan', 'Amount (Rs)', 'Status', 'Transaction ID'];
    sheet.appendRow(headers);
    sheet.getRange(1,1,1,8).setFontWeight('bold').setBackground('#0B3A8D').setFontColor('#ffffff');
    sheet.setFrozenRows(1);
    sheet.setColumnWidth(1,160); sheet.setColumnWidth(2,140); sheet.setColumnWidth(3,130);
    sheet.setColumnWidth(4,180); sheet.setColumnWidth(5,150); sheet.setColumnWidth(6,110);
    sheet.setColumnWidth(7,160); sheet.setColumnWidth(8,200);
  }

  var lastRow = sheet.getLastRow();

  // If status is an update (Paid / Dropped / etc), find the matching existing
  // row by phone AND plan, searching most-recent-first. Matching on phone
  // alone (and taking the first row found) could land the update on a
  // different, older booking from the same repeat customer.
  var existingRow = -1;
  if (data.status !== 'Form Filled' && lastRow > 1) {
    var phoneCol = sheet.getRange(2, 3, lastRow - 1, 1).getValues();
    var planCol  = sheet.getRange(2, 5, lastRow - 1, 1).getValues();
    for (var i = phoneCol.length - 1; i >= 0; i--) {
      var rowPhone = String(phoneCol[i][0]);
      var rowPlan  = String(planCol[i][0]);
      if (rowPhone === String(data.phone) && (!data.plan || rowPlan === String(data.plan))) {
        existingRow = i + 2;
        break;
      }
    }
  }

  if (existingRow > 0) {
    sheet.getRange(existingRow, 7).setValue(data.status);
    if (data.txnId) sheet.getRange(existingRow, 8).setValue(data.txnId);
    colorStatusCell(sheet, existingRow, data.status);
  } else {
    sheet.appendRow([
      data.timestamp || new Date().toLocaleString('en-IN', {timeZone:'Asia/Kolkata'}),
      data.name || '',
      data.phone || '',
      data.email || '',
      data.plan || '',
      data.amount ? 'Rs ' + parseInt(data.amount).toLocaleString('en-IN') : '',
      data.status || 'Form Filled',
      data.txnId || ''
    ]);
    colorStatusCell(sheet, sheet.getLastRow(), data.status);
  }

  SpreadsheetApp.flush();

  return ContentService
    .createTextOutput(JSON.stringify({success: true}))
    .setMimeType(ContentService.MimeType.JSON);
}

function colorStatusCell(sheet, row, status) {
  var cell = sheet.getRange(row, 7);
  if (status === 'Paid') {
    cell.setBackground('#D1FAE5').setFontColor('#065F46').setFontWeight('bold');
  } else if (status === 'Dropped at Payment') {
    cell.setBackground('#FEE2E2').setFontColor('#991B1B').setFontWeight('bold');
  } else {
    cell.setBackground('#FEF3C7').setFontColor('#92400E').setFontWeight('normal');
  }
}
