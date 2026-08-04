// ============================================================
// WorkSpace4You — Google Apps Script (Write + Read)
// REPLACE your existing Code.gs with this entire file
// Then do: Deploy → Manage Deployments → Edit → New Version → Deploy
// ============================================================

function doGet(e) {
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
  
  var data = JSON.parse(e.postData.contents);
  var lastRow = sheet.getLastRow();
  
  // If status is an update (Paid / Dropped), find existing row by phone and update it
  var phoneCol = lastRow > 1 ? sheet.getRange(2, 3, lastRow - 1, 1).getValues() : [];
  var existingRow = -1;
  if (data.status !== 'Form Filled') {
    for (var i = 0; i < phoneCol.length; i++) {
      if (String(phoneCol[i][0]) === String(data.phone)) {
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
