/**
 * Banking upload, month-wise repository, Drive slip storage and notification.
 * The target IDs were supplied for this portal and are intentionally kept on
 * the server; browsers never receive either ID.
 */
const Banking = (() => {

  const SPREADSHEET_ID = "1UaSLtGLlC1qnCB1wmMWnygQLkeSqGGaE79ZtWuT4XVk";
  const SLIP_ROOT_FOLDER_ID = "1gITut4H5S6Ul2MWmKM69PPV72pLa2-AL";
  const MAIL_SHEET_NAME = "Mail ID";
  const AUDIT_SHEET_NAME = "Banking Audit Log";
  const CCR_SHEET_NAME = "CCR Register";
  const MAX_ROWS = 1000;
  const MAX_BULK_EXPORT_ROWS = 10000;
  const MAX_SLIP_BYTES = 10 * 1024 * 1024;
  const SLIP_RECEIPT_PREFIX = "BANKING_SLIP_RECEIPT_";
  const SLIP_REQUEST_PREFIX = "BANKING_SLIP_REQUEST_";
  const BATCH_RECEIPT_PREFIX = "BANKING_BATCH_RECEIPT_";
  const SLIP_RECEIPT_TTL_MS = 2 * 60 * 60 * 1000;
  const BATCH_RECEIPT_TTL_MS = 30 * 24 * 60 * 60 * 1000;
  const MAIL_SCOPE = "https://mail.google.com/";
  const MONTH_NAMES = Object.freeze(["JANUARY","FEBRUARY","MARCH","APRIL","MAY","JUNE","JULY","AUGUST","SEPTEMBER","OCTOBER","NOVEMBER","DECEMBER"]);
  let cachedTimeZone = "";

  const TEMPLATE_HEADERS = Object.freeze([
    "SL NO",
    "Courier Partner",
    "AWB",
    "Created at",
    "Clickpost Unified Status",
    "Reference Number",
    "Drop Name",
    "Drop Phone",
    "Drop Address",
    "Drop Pincode",
    "Invoice Number",
    "Invoice Date",
    "Payment Mode",
    "COD Value",
    "UPI Value",
    "UPI Deposit Date",
    "COD Deposit Date",
    "UPI Transaction No",
    "UPI Pic",
    "Bank Name",
    "Rider Name"
  ]);

  const DATE_HEADERS = Object.freeze([
    "Created at",
    "Invoice Date",
    "UPI Deposit Date",
    "COD Deposit Date"
  ]);

  const STORAGE_HEADERS = Object.freeze([
    "Upload Batch ID",
    "Banking Date",
    "Zone",
    "Warehouse",
    "LM Hub"
  ].concat(TEMPLATE_HEADERS).concat([
    "Banking Slip",
    "Uploaded By",
    "Uploaded Email",
    "Uploaded At"
  ]));

  const LEGACY_STORAGE_HEADERS = Object.freeze([
    "Upload Batch ID",
    "Client Request ID",
    "Banking Date",
    "Zone",
    "Warehouse",
    "LM Hub"
  ].concat(TEMPLATE_HEADERS).concat([
    "Banking Slip",
    "Uploaded By",
    "Uploaded Email",
    "Uploaded At"
  ]));

  const BULK_EXPORT_HEADERS = Object.freeze(STORAGE_HEADERS.slice());

  const AUDIT_HEADERS = Object.freeze([
    "Audit ID", "Timestamp", "Outcome", "Action", "AWB",
    "Previous Batch ID", "New Batch ID", "Actor Username", "Actor Name",
    "Actor Email", "Actor Role", "Actor Access Scope", "Selected Zone",
    "Selected Warehouse", "Selected LM Hub", "Source Sheet", "Source Row",
    "Destination Sheet", "Destination Row", "Previous Record JSON",
    "Replacement Record JSON"
  ]);

  const CCR_HEADERS = Object.freeze([
    "CCR ID", "Cash Collection Date", "Zone", "Warehouse", "LM Hub",
    "Coin Rs1 Qty", "Coin Rs2 Qty", "Coin Rs5 Qty", "Coin Rs10 Qty",
    "Note Rs10 Qty", "Note Rs20 Qty", "Note Rs50 Qty", "Note Rs100 Qty",
    "Note Rs200 Qty", "Note Rs500 Qty", "Cash Total", "UPI Amount",
    "Total Collected", "Submitted By", "Submitted Email", "Submitted At",
    "CDR Batch ID", "Cash Deposition Date", "Status", "Mail Thread ID",
    "CCR Mail Sent", "CDR Mail Sent", "Mail Count", "Last Mail Sent At",
    "Last Updated By", "Last Updated Email", "Last Updated At", "CCR Edit Count",
    "Last Change Remarks", "CDR Remarks"
  ]);

  const DENOMINATIONS = Object.freeze([
    ["coin1", "Coin Rs1 Qty", 1], ["coin2", "Coin Rs2 Qty", 2],
    ["coin5", "Coin Rs5 Qty", 5], ["coin10", "Coin Rs10 Qty", 10],
    ["note10", "Note Rs10 Qty", 10], ["note20", "Note Rs20 Qty", 20],
    ["note50", "Note Rs50 Qty", 50], ["note100", "Note Rs100 Qty", 100],
    ["note200", "Note Rs200 Qty", 200], ["note500", "Note Rs500 Qty", 500]
  ]);

  function text(value) {
    return value === null || value === undefined ? "" : String(value).trim();
  }

  function key(value) {
    return text(value).toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  }

  function same(left, right) {
    return key(left) === key(right);
  }

  function userValue(user, name) {
    if (!user) return "";
    if (user[name] !== undefined && user[name] !== null) return user[name];
    const wanted = key(name);
    const matched = Object.keys(user).find(item => key(item) === wanted);
    return matched ? user[matched] : "";
  }

  function roleOf(user) {
    const role = key(userValue(user, "ROLE"));
    return role === "MANAGER" ? "HUB_MANAGER" : role;
  }

  function scopeOf(user) {
    return key(userValue(user, "ACCESS_SCOPE"));
  }

  function canUse(user) {
    const role = roleOf(user);
    return scopeOf(user) !== "CSR" &&
      ["HUB_MANAGER", "ADMIN", "SUPER_ADMIN"].indexOf(role) !== -1;
  }

  function requireAccess(user) {
    if (!canUse(user)) throw new Error(ERROR.ACCESS_DENIED);
  }

  function locationsForUser(user) {
    requireAccess(user);

    const role = roleOf(user);
    const scope = role === "HUB_MANAGER" ? "LM_HUB" : scopeOf(user);
    const userZone = userValue(user, "ZONE");
    const userWarehouse = userValue(user, "WAREHOUSE");
    const userHub = userValue(user, "LM_HUB");

    return Config.locations().filter(location => {
      if (!text(location.zone) || !text(location.warehouse) || !text(location.lmHub)) return false;
      if (scope === "PAN_INDIA") return true;
      if (scope === "ZONE") return same(location.zone, userZone);
      if (scope === "WAREHOUSE") {
        return same(location.zone, userZone) && same(location.warehouse, userWarehouse);
      }
      if (scope === "LM_HUB" || scope === "HUB") {
        return same(location.zone, userZone) &&
          same(location.warehouse, userWarehouse) &&
          same(location.lmHub, userHub);
      }
      return false;
    });
  }

  function locationForUser(user, requested) {
    requested = requested || {};
    return locationsForUser(user).find(location =>
      same(location.zone, requested.zone) &&
      same(location.warehouse, requested.warehouse) &&
      same(location.lmHub, requested.lmHub)
    ) || null;
  }

  function timeZone() {
    if (cachedTimeZone) return cachedTimeZone;
    try {
      cachedTimeZone = SpreadsheetApp.openById(SPREADSHEET_ID).getSpreadsheetTimeZone() || Session.getScriptTimeZone();
    } catch (error) {
      cachedTimeZone = Session.getScriptTimeZone();
    }
    return cachedTimeZone;
  }

  function parseIsoDate(value, fieldName) {
    const raw = text(value);
    const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) throw new Error((fieldName || "Date") + " is invalid.");
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const parsed = new Date(year, month - 1, day, 12, 0, 0, 0);
    if (parsed.getFullYear() !== year || parsed.getMonth() !== month - 1 || parsed.getDate() !== day)
      throw new Error((fieldName || "Date") + " is invalid.");
    return parsed;
  }

  function validateBusinessDate(value) {
    const raw = text(value);
    const parsed = parseIsoDate(raw, "Cash Deposition date");
    const today = Utilities.formatDate(new Date(), timeZone(), "yyyy-MM-dd");
    if (raw > today)
      throw new Error("Cash Deposition date cannot be in the future.");
    return parsed;
  }

  function validateCollectionDate(value) {
    const raw = text(value);
    const parsed = parseIsoDate(raw, "Cash Collection date");
    const today = Utilities.formatDate(new Date(), timeZone(), "yyyy-MM-dd");
    if (raw > today) throw new Error("Cash Collection date cannot be in the future.");
    return parsed;
  }

  function displayDate(date, pattern) {
    return Utilities.formatDate(date, timeZone(), pattern || "dd-MM-yyyy");
  }

  function isValidDisplayDate(value) {
    const raw = text(value);
    const match = raw.match(/^(\d{2})-(\d{2})-(\d{4})$/);
    if (!match) return false;
    const parsed = new Date(Number(match[3]), Number(match[2]) - 1, Number(match[1]), 12, 0, 0, 0);
    return parsed.getFullYear() === Number(match[3]) &&
      parsed.getMonth() === Number(match[2]) - 1 &&
      parsed.getDate() === Number(match[1]);
  }

  function safeCell(value) {
    if (value === null || value === undefined) return "";
    if (typeof value === "number") return isFinite(value) ? value : "";
    if (typeof value === "boolean") return value;
    const raw = String(value).trim();
    return /^[=+\-@]/.test(raw) ? "'" + raw : raw;
  }

  function validateHeaders(headers) {
    const incoming = Array.isArray(headers) ? headers.map(text) : [];
    if (incoming.length !== TEMPLATE_HEADERS.length)
      throw new Error("Use the approved Banking template without adding or removing columns.");
    for (let index = 0; index < TEMPLATE_HEADERS.length; index++) {
      if (!same(incoming[index], TEMPLATE_HEADERS[index])) {
        throw new Error(
          "Column " + (index + 1) + " must be '" + TEMPLATE_HEADERS[index] + "'. Download a fresh Banking template."
        );
      }
    }
  }

  function validateRows(rows) {
    if (!Array.isArray(rows) || !rows.length)
      throw new Error("The banking file does not contain any data rows.");
    if (rows.length > MAX_ROWS)
      throw new Error("Upload a maximum of " + MAX_ROWS + " banking rows at one time.");

    const dateIndexes = DATE_HEADERS.map(header => TEMPLATE_HEADERS.indexOf(header));
    const errors = [];
    const awbIndex = TEMPLATE_HEADERS.indexOf("AWB");
    const seenAwbs = {};
    const prepared = rows.map((source, rowIndex) => {
      const row = Array.isArray(source) ? source.slice(0, TEMPLATE_HEADERS.length) : [];
      while (row.length < TEMPLATE_HEADERS.length) row.push("");

      if (!row.some(value => text(value))) {
        errors.push("Row " + (rowIndex + 2) + ": blank rows are not allowed.");
        return row.map(safeCell);
      }

      const awb = normalizedAwb(row[awbIndex]);
      if (!awb) {
        errors.push("Row " + (rowIndex + 2) + ": AWB is required.");
      } else if (seenAwbs[awb]) {
        errors.push(
          "Row " + (rowIndex + 2) + ": AWB '" + text(row[awbIndex]) +
          "' is duplicated in this file (first used in row " + seenAwbs[awb] + ")."
        );
      } else {
        seenAwbs[awb] = rowIndex + 2;
      }

      dateIndexes.forEach(columnIndex => {
        const value = text(row[columnIndex]);
        if (value && !isValidDisplayDate(value)) {
          errors.push(
            "Row " + (rowIndex + 2) + ": " + TEMPLATE_HEADERS[columnIndex] + " must be dd-MM-yyyy."
          );
        }
      });

      const upiPic = text(row[TEMPLATE_HEADERS.indexOf("UPI Pic")]);
      if (upiPic && !/^https:\/\/(?:drive|docs)\.google\.com\//i.test(upiPic)) {
        errors.push("Row " + (rowIndex + 2) + ": UPI Pic must be a complete Google Drive link.");
      }

      return row.map(safeCell);
    });

    if (errors.length) {
      const visible = errors.slice(0, 12);
      if (errors.length > visible.length)
        visible.push("And " + (errors.length - visible.length) + " more validation error(s).");
      throw new Error(visible.join("\n"));
    }

    return prepared;
  }

  function moneyCellCents_(value, fieldName, rowNumber) {
    if (value === null || value === undefined || text(value) === "") return 0;
    let normalized = typeof value === "number" ? value : text(value)
      .replace(/,/g, "").replace(/^₹\s*/, "").replace(/^RS\.?\s*/i, "");
    const amount = Number(normalized);
    if (!isFinite(amount) || amount < 0) {
      throw new Error("Row " + rowNumber + ": " + fieldName + " must be zero or a positive number.");
    }
    return Math.round(amount * 100);
  }

  function cdrAmountSummary_(rows) {
    const codIndex = TEMPLATE_HEADERS.indexOf("COD Value");
    const upiIndex = TEMPLATE_HEADERS.indexOf("UPI Value");
    let codCents = 0;
    let upiCents = 0;
    (rows || []).forEach((row, index) => {
      codCents += moneyCellCents_(row[codIndex], "COD Value", index + 2);
      upiCents += moneyCellCents_(row[upiIndex], "UPI Value", index + 2);
    });
    return {
      codTotal: Number((codCents / 100).toFixed(2)),
      upiTotal: Number((upiCents / 100).toFixed(2)),
      fileTotal: Number(((codCents + upiCents) / 100).toFixed(2)),
      fileTotalCents: codCents + upiCents
    };
  }

  function requireCdrAmountMatch_(ccr, rows) {
    const summary = cdrAmountSummary_(rows);
    const ccrCents = Math.round((Number(ccr["Total Collected"]) || 0) * 100);
    const differenceCents = summary.fileTotalCents - ccrCents;
    const result = {
      ccrTotal: Number((ccrCents / 100).toFixed(2)),
      codTotal: summary.codTotal,
      upiTotal: summary.upiTotal,
      fileTotal: summary.fileTotal,
      difference: Number((differenceCents / 100).toFixed(2)),
      matches: Math.abs(differenceCents) <= 100,
      tolerance: 1
    };
    if (!result.matches) {
      throw new Error(
        "CDR amount mismatch. Selected CCR 'Total Collected' is Rs " + result.ccrTotal.toFixed(2) +
        ". In the uploaded CDR file, the sum of column 'COD Value' is Rs " + result.codTotal.toFixed(2) +
        " and the sum of column 'UPI Value' is Rs " + result.upiTotal.toFixed(2) +
        ", giving COD Value + UPI Value = Rs " + result.fileTotal.toFixed(2) +
        " (difference Rs " + result.difference.toFixed(2) + "). A rounding difference up to plus or minus Rs 1.00 is accepted. Correct those two columns or edit the open CCR before uploading."
      );
    }
    return result;
  }

  function normalizedAwb(value) {
    return text(value).toUpperCase().replace(/\s+/g, " ");
  }

  function currentLocation(user) {
    return {
      zone: text(userValue(user, "ZONE")),
      warehouse: text(userValue(user, "WAREHOUSE")),
      lmHub: text(userValue(user, "LM_HUB"))
    };
  }

  function context(user) {
    requireAccess(user);
    return Utility.success(SUCCESS.FETCHED, {
      locations: locationsForUser(user),
      currentLocation: currentLocation(user),
      accessScope: text(userValue(user, "ACCESS_SCOPE")),
      canAuthorizeMail: roleOf(user) === "SUPER_ADMIN",
      registeredEmail: text(userValue(user, "REGISTERED_EMAIL")),
      maxRows: MAX_ROWS,
      headers: TEMPLATE_HEADERS.slice(),
      dateHeaders: DATE_HEADERS.slice(),
      ccrEntries: ccrList_(user, {}).slice(0, 200).map(ccrDto_),
      dashboard: dashboard_(user, {})
    });
  }

  function html(value) {
    return text(value).replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function ccrSheet_(spreadsheet) {
    spreadsheet = spreadsheet || SpreadsheetApp.openById(SPREADSHEET_ID);
    let sheet = spreadsheet.getSheetByName(CCR_SHEET_NAME);
    if (!sheet) sheet = spreadsheet.insertSheet(CCR_SHEET_NAME);
    if (sheet.getLastRow() === 0 || sheet.getLastColumn() === 0) {
      sheet.getRange(1, 1, 1, CCR_HEADERS.length).setValues([CCR_HEADERS])
        .setBackground("#0B4D87").setFontColor("#FFFFFF").setFontWeight("bold").setWrap(true);
      sheet.setFrozenRows(1);
      try { sheet.getRange(1, 1, 1, CCR_HEADERS.length).createFilter(); } catch (error) {}
    }
    const existingColumnCount = sheet.getLastColumn();
    const existing = sheet.getRange(1, 1, 1, Math.max(existingColumnCount, CCR_HEADERS.length))
      .getDisplayValues()[0];
    const existingHeaderCount = Math.min(existingColumnCount, CCR_HEADERS.length);
    if (!CCR_HEADERS.slice(0, existingHeaderCount).every((header, index) => same(header, existing[index])))
      throw new Error("The '" + CCR_SHEET_NAME + "' headers do not match this portal version.");
    if (existingColumnCount < CCR_HEADERS.length) {
      const missing = CCR_HEADERS.slice(existingColumnCount);
      sheet.getRange(1, existingColumnCount + 1, 1, missing.length).setValues([missing])
        .setBackground("#0B4D87").setFontColor("#FFFFFF").setFontWeight("bold").setWrap(true);
    }
    return sheet;
  }

  function ccrRows_(spreadsheet) {
    const sheet = ccrSheet_(spreadsheet);
    if (sheet.getLastRow() < 2) return [];
    return sheet.getRange(2, 1, sheet.getLastRow() - 1, CCR_HEADERS.length).getValues().map((values, index) => {
      const record = { __row: index + 2 };
      CCR_HEADERS.forEach((header, column) => { record[header] = values[column]; });
      return record;
    });
  }

  function ccrIso_(value) {
    if (value instanceof Date && !isNaN(value.getTime())) return Utilities.formatDate(value, timeZone(), "yyyy-MM-dd");
    const parsed = parseDisplayDate(value);
    return parsed || text(value);
  }

  function ccrDto_(record) {
    const denominations = {};
    DENOMINATIONS.forEach(item => { denominations[item[0]] = Number(record[item[1]]) || 0; });
    denominations.upiAmount = Number(record["UPI Amount"]) || 0;
    return {
      ccrId: text(record["CCR ID"]),
      collectionDate: ccrIso_(record["Cash Collection Date"]),
      collectionDateDisplay: record["Cash Collection Date"] instanceof Date ? displayDate(record["Cash Collection Date"], "dd-MM-yyyy") : text(record["Cash Collection Date"]),
      depositionDate: ccrIso_(record["Cash Deposition Date"]),
      zone: text(record.Zone), warehouse: text(record.Warehouse), lmHub: text(record["LM Hub"]),
      cashTotal: Number(record["Cash Total"]) || 0,
      upiAmount: Number(record["UPI Amount"]) || 0,
      totalCollected: Number(record["Total Collected"]) || 0,
      denominations,
      submittedBy: text(record["Submitted By"]), submittedEmail: text(record["Submitted Email"]),
      submittedAt: record["Submitted At"] instanceof Date ? displayDate(record["Submitted At"], "dd-MM-yyyy HH:mm:ss") : text(record["Submitted At"]),
      cdrBatchId: text(record["CDR Batch ID"]), status: text(record.Status),
      ccrMailSent: same(record["CCR Mail Sent"], "Yes"), cdrMailSent: same(record["CDR Mail Sent"], "Yes"),
      mailSent: text(record["CDR Batch ID"]) ? same(record["CDR Mail Sent"], "Yes") : same(record["CCR Mail Sent"], "Yes"), mailCount: Number(record["Mail Count"]) || 0,
      lastMailSentAt: record["Last Mail Sent At"] instanceof Date ? displayDate(record["Last Mail Sent At"], "dd-MM-yyyy HH:mm:ss") : text(record["Last Mail Sent At"]),
      mailThreadAvailable: !!text(record["Mail Thread ID"]),
      editable: !text(record["CDR Batch ID"]),
      editCount: Number(record["CCR Edit Count"]) || 0,
      lastUpdatedBy: text(record["Last Updated By"]),
      lastUpdatedAt: record["Last Updated At"] instanceof Date ? displayDate(record["Last Updated At"], "dd-MM-yyyy HH:mm:ss") : text(record["Last Updated At"]),
      lastChangeRemarks: text(record["Last Change Remarks"]),
      cdrRemarks: text(record["CDR Remarks"])
    };
  }

  function updateCcr_(sheet, row, fields) {
    const current = sheet.getRange(row, 1, 1, CCR_HEADERS.length).getValues()[0];
    Object.keys(fields || {}).forEach(header => {
      const index = CCR_HEADERS.indexOf(header);
      if (index >= 0) current[index] = fields[header];
    });
    sheet.getRange(row, 1, 1, CCR_HEADERS.length).setValues([current]);
  }

  function ccrList_(user, filters, spreadsheet) {
    const allowed = allowedLocationMap(user);
    filters = filters || {};
    return ccrRows_(spreadsheet).filter(record => recordAllowed(allowed, record)).filter(record => {
      const date = ccrIso_(record["Cash Collection Date"]);
      if (text(filters.ccrId) && text(record["CCR ID"]).toUpperCase().indexOf(text(filters.ccrId).toUpperCase()) === -1) return false;
      if (text(filters.startDate) && date < text(filters.startDate)) return false;
      if (text(filters.endDate) && date > text(filters.endDate)) return false;
      if (text(filters.status) && !same(record.Status, filters.status)) return false;
      if (Array.isArray(filters.zones) && filters.zones.length && !filters.zones.some(value => same(value, record.Zone))) return false;
      if (Array.isArray(filters.warehouses) && filters.warehouses.length && !filters.warehouses.some(value => same(value, record.Warehouse))) return false;
      if (Array.isArray(filters.lmHubs) && filters.lmHubs.length && !filters.lmHubs.some(value => same(value, record["LM Hub"]))) return false;
      if (text(filters.submittedBy) && text(record["Submitted By"]).toLowerCase().indexOf(text(filters.submittedBy).toLowerCase()) === -1) return false;
      return true;
    }).sort((left, right) => ccrIso_(right["Cash Collection Date"]).localeCompare(ccrIso_(left["Cash Collection Date"])) || right.__row - left.__row);
  }

  function cashQuantities_(input) {
    const quantities = {};
    let cashTotal = 0;
    DENOMINATIONS.forEach(item => {
      const quantity = Number(input && input[item[0]] || 0);
      if (!Number.isInteger(quantity) || quantity < 0 || quantity > 1000000)
        throw new Error(item[1] + " must be a whole number of pieces.");
      quantities[item[1]] = quantity;
      cashTotal += quantity * item[2];
    });
    const upiAmount = Number(input && input.upiAmount || 0);
    if (!isFinite(upiAmount) || upiAmount < 0) throw new Error("UPI Amount must be zero or a positive number.");
    if (cashTotal + upiAmount <= 0) throw new Error("Enter at least one cash denomination or a UPI amount.");
    return { quantities, cashTotal, upiAmount: Number(upiAmount.toFixed(2)), total: Number((cashTotal + upiAmount).toFixed(2)) };
  }

  function ccrSubject_(location, collectionDate) {
    return "Cash Collection / Deposition || " + location.lmHub + " || " + displayDate(collectionDate, "dd-MM-yyyy");
  }

  function sendCcrMail_(spreadsheet, user, location, collectionDate, ccrId, amounts) {
    const config = mailConfiguration(spreadsheet, location.zone);
    if (!config.to.length) throw new Error("Static To recipients are missing in the Mail ID sheet.");
    const uploaderEmail = text(userValue(user, "REGISTERED_EMAIL"));
    if (!REGEX.EMAIL.test(uploaderEmail)) throw new Error("The logged-in user does not have a valid Registered Email in User Master.");
    const lines = DENOMINATIONS.map(item => item[1].replace(" Qty", "") + ": " + amounts.quantities[item[1]]).join("\n");
    const body = ["Cash Collection Report (CCR) created.", "CCR ID: " + ccrId, "Cash Collection date: " + displayDate(collectionDate, "dd-MM-yyyy"), "Location: " + location.zone + " / " + location.warehouse + " / " + location.lmHub, lines, "Cash total: Rs " + amounts.cashTotal.toFixed(2), "UPI amount: Rs " + amounts.upiAmount.toFixed(2), "Total collected: Rs " + amounts.total.toFixed(2), "Submitted by: " + text(userValue(user, "RIDER_NAME") || userValue(user, "USERNAME"))].join("\n");
    const htmlBody = "<p><b>Cash Collection Report (CCR) created.</b></p><table cellpadding='6' cellspacing='0' border='1' style='border-collapse:collapse;border-color:#dbe5f1'><tr><td>CCR ID</td><td>" + html(ccrId) + "</td></tr><tr><td>Collection date</td><td>" + html(displayDate(collectionDate,"dd-MM-yyyy")) + "</td></tr><tr><td>Location</td><td>" + html(location.zone+" / "+location.warehouse+" / "+location.lmHub) + "</td></tr><tr><td>Cash total</td><td>Rs " + amounts.cashTotal.toFixed(2) + "</td></tr><tr><td>UPI amount</td><td>Rs " + amounts.upiAmount.toFixed(2) + "</td></tr><tr><td><b>Total collected</b></td><td><b>Rs " + amounts.total.toFixed(2) + "</b></td></tr></table><p>The Cash Deposition Report (CDR) will be added to this same conversation after deposit.</p>";
    const options = { htmlBody, name:"TrueMeds HyperLocal Logistics Portal", replyTo:uploaderEmail };
    if (config.cc.length) options.cc = config.cc.join(",");
    const message = GmailApp.createDraft(config.to.join(","), ccrSubject_(location, collectionDate), body, options).send();
    return message.getThread().getId();
  }

  function sendCurrentCcrMail_(spreadsheet, user, record, amounts, isRevision) {
    const location = { zone:text(record.Zone), warehouse:text(record.Warehouse), lmHub:text(record["LM Hub"]) };
    const collectionDate = validateCollectionDate(ccrIso_(record["Cash Collection Date"]));
    const threadId = text(record["Mail Thread ID"]);
    const thread = threadId ? GmailApp.getThreadById(threadId) : null;
    if (!thread) return sendCcrMail_(spreadsheet, user, location, collectionDate, text(record["CCR ID"]), amounts);
    const actor = text(userValue(user,"RIDER_NAME") || userValue(user,"USERNAME"));
    const changeRemarks=text(record["Last Change Remarks"]);
    const body = [isRevision ? "Cash Collection Report (CCR) updated." : "Cash Collection Report (CCR) confirmation.", "CCR ID: " + text(record["CCR ID"]), "Cash Collection date: " + displayDate(collectionDate,"dd-MM-yyyy"), "Location: " + location.zone + " / " + location.warehouse + " / " + location.lmHub, "Cash total: Rs " + amounts.cashTotal.toFixed(2), "UPI amount: Rs " + amounts.upiAmount.toFixed(2), "Revised total collected: Rs " + amounts.total.toFixed(2), "Updated by: " + actor, changeRemarks?"Change reason: "+changeRemarks:""].filter(Boolean).join("\n");
    const htmlBody = "<p><b>" + (isRevision ? "Cash Collection Report (CCR) updated." : "Cash Collection Report (CCR) confirmation.") + "</b></p><table cellpadding='6' cellspacing='0' border='1' style='border-collapse:collapse;border-color:#dbe5f1'><tr><td>CCR ID</td><td>" + html(record["CCR ID"]) + "</td></tr><tr><td>Collection date</td><td>" + html(displayDate(collectionDate,"dd-MM-yyyy")) + "</td></tr><tr><td>Location</td><td>" + html(location.zone+" / "+location.warehouse+" / "+location.lmHub) + "</td></tr><tr><td>Cash total</td><td>Rs " + amounts.cashTotal.toFixed(2) + "</td></tr><tr><td>UPI amount</td><td>Rs " + amounts.upiAmount.toFixed(2) + "</td></tr><tr><td><b>Revised total collected</b></td><td><b>Rs " + amounts.total.toFixed(2) + "</b></td></tr><tr><td>Updated by</td><td>" + html(actor) + "</td></tr>"+(changeRemarks?"<tr><td>Change reason</td><td>"+html(changeRemarks)+"</td></tr>":"")+"</table><p>The linked CDR must use this revised CCR value.</p>";
    thread.replyAll(body, { htmlBody, replyTo:text(userValue(user,"REGISTERED_EMAIL")) });
    return thread.getId();
  }

  function amountsFromCcr_(record) {
    const amounts = { quantities:{}, cashTotal:Number(record["Cash Total"])||0, upiAmount:Number(record["UPI Amount"])||0, total:Number(record["Total Collected"])||0 };
    DENOMINATIONS.forEach(item => { amounts.quantities[item[1]] = Number(record[item[1]]) || 0; });
    return amounts;
  }

  function submitCcr(user, payload) {
    requireAccess(user); payload = payload || {};
    let location, collectionDate, amounts;
    try {
      location = locationForUser(user, payload.location || {});
      if (!location) throw new Error("Choose a permitted Zone, Warehouse and LM Hub.");
      collectionDate = validateCollectionDate(payload.collectionDate);
      amounts = cashQuantities_(payload.denominations || {});
    } catch (error) { return Utility.error(error.message); }
    const lock = LockService.getScriptLock();
    if (!lock.tryLock(15000)) return Utility.error("Another CCR is being saved. Please retry shortly.");
    try {
      const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID), sheet = ccrSheet_(spreadsheet);
      const existing = ccrRows_(spreadsheet).find(record => ccrIso_(record["Cash Collection Date"]) === text(payload.collectionDate) && same(record.Zone,location.zone) && same(record.Warehouse,location.warehouse) && same(record["LM Hub"],location.lmHub));
      if (existing) return Utility.success("A CCR already exists for this LM Hub and collection date.", ccrDto_(existing));
      const ccrId = "CCR-" + Utilities.formatDate(new Date(), timeZone(), "yyyyMMdd-HHmmss") + "-" + Utilities.getUuid().slice(0,6).toUpperCase();
      const rowObject = { "CCR ID":ccrId, "Cash Collection Date":collectionDate, Zone:location.zone, Warehouse:location.warehouse, "LM Hub":location.lmHub, "Cash Total":amounts.cashTotal, "UPI Amount":amounts.upiAmount, "Total Collected":amounts.total, "Submitted By":text(userValue(user,"RIDER_NAME")||userValue(user,"USERNAME")), "Submitted Email":text(userValue(user,"REGISTERED_EMAIL")), "Submitted At":new Date(), Status:"CCR Submitted", "CCR Mail Sent":"No", "CDR Mail Sent":"No", "Mail Count":0 };
      DENOMINATIONS.forEach(item => { rowObject[item[1]] = amounts.quantities[item[1]]; });
      const values = CCR_HEADERS.map(header => rowObject[header] === undefined ? "" : rowObject[header]);
      sheet.appendRow(values); const row = sheet.getLastRow();
      sheet.getRange(row,2).setNumberFormat("dd-MM-yyyy");sheet.getRange(row,21).setNumberFormat("dd-MM-yyyy HH:mm:ss");
      const warnings=[];
      try { const threadId=sendCcrMail_(spreadsheet,user,location,collectionDate,ccrId,amounts);updateCcr_(sheet,row,{"Mail Thread ID":threadId,"CCR Mail Sent":"Yes","Mail Count":1,"Last Mail Sent At":new Date()}); }
      catch(error){warnings.push("CCR was saved, but email was not sent: "+friendlyMailError(error));}
      const saved=ccrRows_(spreadsheet).find(record=>same(record["CCR ID"],ccrId));const data=ccrDto_(saved);data.warnings=warnings;return Utility.success(warnings.length?"CCR saved; email needs attention.":"CCR saved and email sent successfully.",data);
    } finally { lock.releaseLock(); }
  }

  function updateCcr(user, payload) {
    requireAccess(user); payload = payload || {};
    const ccrId = text(payload.ccrId);
    if (!ccrId) return Utility.error("Select an open CCR to edit.");
    const changeRemarks = text(payload.remarks);
    if (changeRemarks.length < 5) return Utility.error("Enter a clear reason for changing this CCR (minimum 5 characters).");
    let amounts;
    try { amounts = cashQuantities_(payload.denominations || {}); }
    catch (error) { return Utility.error(error.message); }
    const lock = LockService.getScriptLock();
    if (!lock.tryLock(15000)) return Utility.error("Another CCR change is being saved. Please retry shortly.");
    try {
      const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID), sheet = ccrSheet_(spreadsheet), allowed = allowedLocationMap(user);
      const record = ccrRows_(spreadsheet).find(item => same(item["CCR ID"], ccrId));
      if (!record || !recordAllowed(allowed, record)) return Utility.error("CCR not found in your permitted scope.");
      if (text(record["CDR Batch ID"])) return Utility.error("CCR editing is locked because CDR batch " + text(record["CDR Batch ID"]) + " is already completed.");
      const updates = { "Cash Total":amounts.cashTotal, "UPI Amount":amounts.upiAmount, "Total Collected":amounts.total, "Status":"CCR Updated", "CCR Mail Sent":"No", "Last Updated By":text(userValue(user,"RIDER_NAME")||userValue(user,"USERNAME")), "Last Updated Email":text(userValue(user,"REGISTERED_EMAIL")), "Last Updated At":new Date(), "CCR Edit Count":Number(record["CCR Edit Count"]||0)+1, "Last Change Remarks":changeRemarks };
      DENOMINATIONS.forEach(item => { updates[item[1]] = amounts.quantities[item[1]]; });
      updateCcr_(sheet, record.__row, updates);
      let refreshed = ccrRows_(spreadsheet).find(item => same(item["CCR ID"], ccrId));
      const warnings = [];
      try {
        const threadId = sendCurrentCcrMail_(spreadsheet, user, refreshed, amounts, true);
        updateCcr_(sheet, refreshed.__row, { "Mail Thread ID":threadId, "CCR Mail Sent":"Yes", "Mail Count":Number(refreshed["Mail Count"]||0)+1, "Last Mail Sent At":new Date() });
      } catch (error) { warnings.push("CCR changes were saved, but the revised email was not sent: " + friendlyMailError(error)); }
      refreshed = ccrRows_(spreadsheet).find(item => same(item["CCR ID"], ccrId));
      const data = ccrDto_(refreshed); data.warnings = warnings;
      return Utility.success(warnings.length ? "CCR updated; email needs attention." : "CCR updated and revised email sent successfully.", data);
    } finally { lock.releaseLock(); }
  }

  function resendCcrEmail(user, ccrId) {
    requireAccess(user);const spreadsheet=SpreadsheetApp.openById(SPREADSHEET_ID),sheet=ccrSheet_(spreadsheet),allowed=allowedLocationMap(user),record=ccrRows_(spreadsheet).find(item=>same(item["CCR ID"],ccrId));
    if(!record||!recordAllowed(allowed,record))return Utility.error("CCR not found in your permitted scope.");
    const amounts=amountsFromCcr_(record);
    try{const threadId=sendCurrentCcrMail_(spreadsheet,user,record,amounts,Number(record["CCR Edit Count"]||0)>0);updateCcr_(sheet,record.__row,{"Mail Thread ID":threadId,"CCR Mail Sent":"Yes","Mail Count":Number(record["Mail Count"]||0)+1,"Last Mail Sent At":new Date()});return Utility.success("CCR email sent successfully.",ccrDto_(ccrRows_(spreadsheet).find(item=>same(item["CCR ID"],ccrId))));}catch(error){return Utility.error("Email was not sent: "+friendlyMailError(error));}
  }

  function dashboard_(user, filters, spreadsheet) {
    const rows=ccrList_(user,filters||{},spreadsheet),byHub={},trend={};
    rows.forEach(record=>{
      const hub=text(record["LM Hub"]),date=ccrIso_(record["Cash Collection Date"]),done=!!text(record["CDR Batch ID"]),total=Number(record["Total Collected"]||0);
      if(!byHub[hub])byHub[hub]={ccrId:"",lmHub:hub,zone:text(record.Zone),warehouse:text(record.Warehouse),collectionDate:"",status:"CDR Pending",totalCollected:0,totalDeposited:0,submittedBy:"",cdrBatchId:"",mailSent:false,mailCount:0,ccrCount:0,cdrCount:0};
      const aggregate=byHub[hub];
      aggregate.totalCollected+=total;aggregate.ccrCount++;
      if(done){aggregate.totalDeposited+=total;aggregate.cdrCount++;}
      if(!aggregate.collectionDate||date>aggregate.collectionDate){
        aggregate.ccrId=text(record["CCR ID"]);aggregate.zone=text(record.Zone);aggregate.warehouse=text(record.Warehouse);aggregate.collectionDate=date;aggregate.status=done?'Done':'CDR Pending';aggregate.submittedBy=text(record["Submitted By"]);aggregate.cdrBatchId=text(record["CDR Batch ID"]);aggregate.mailSent=done?same(record["CDR Mail Sent"],'Yes'):same(record["CCR Mail Sent"],'Yes');aggregate.mailCount=Number(record["Mail Count"]||0);
      }
      if(!trend[date])trend[date]={date,totalCollected:0,totalDeposited:0,ccrCount:0,cdrCount:0};
      trend[date].totalCollected+=total;trend[date].ccrCount++;
      if(done){trend[date].totalDeposited+=total;trend[date].cdrCount++;}
    });
    const completed=rows.filter(record=>text(record["CDR Batch ID"])).length,totalCollected=rows.reduce((sum,record)=>sum+(Number(record["Total Collected"])||0),0),totalDeposited=rows.filter(record=>text(record["CDR Batch ID"])).reduce((sum,record)=>sum+(Number(record["Total Collected"])||0),0);
    const hubRows=Object.keys(byHub).map(key=>{const item=byHub[key];item.totalCollected=Number(item.totalCollected.toFixed(2));item.totalDeposited=Number(item.totalDeposited.toFixed(2));return item;}).sort((a,b)=>a.lmHub.localeCompare(b.lmHub));
    return{ccrCount:rows.length,cdrCompleted:completed,cdrPending:rows.length-completed,totalCollected:Number(totalCollected.toFixed(2)),totalDeposited:Number(totalDeposited.toFixed(2)),hubRows,trend:Object.keys(trend).sort().map(date=>trend[date]).slice(-31)};
  }

  function dashboard(user,filters){requireAccess(user);return Utility.success(SUCCESS.FETCHED,dashboard_(user,filters||{}));}

  function searchCcr(user, filters) {
    requireAccess(user); filters = filters || {};
    try {
      if (text(filters.startDate)) validateCollectionDate(filters.startDate);
      if (text(filters.endDate)) validateCollectionDate(filters.endDate);
      if (text(filters.startDate) && text(filters.endDate) && text(filters.startDate) > text(filters.endDate))
        throw new Error("CCR From date cannot be later than To date.");
      const rows = ccrList_(user, {
        ccrId: text(filters.ccrId),
        startDate: text(filters.startDate),
        endDate: text(filters.endDate)
      }).slice(0, 500).map(ccrDto_);
      return Utility.success(rows.length ? rows.length + " CCR record(s) found." : "No CCR records matched this search.", rows);
    } catch (error) { return Utility.error(error.message); }
  }

  function resolveCcrForCdr_(user,ccrId,location,depositionDate,spreadsheet){const allowed=allowedLocationMap(user),record=ccrRows_(spreadsheet).find(item=>same(item["CCR ID"],ccrId));if(!record||!recordAllowed(allowed,record))throw new Error("Choose a CCR from your permitted scope before creating a CDR.");if(text(record["CDR Batch ID"]))throw new Error("This CCR is already closed by CDR batch "+text(record["CDR Batch ID"])+".");if(!same(record.Zone,location.zone)||!same(record.Warehouse,location.warehouse)||!same(record["LM Hub"],location.lmHub))throw new Error("The selected CDR location must match the CCR location.");if(text(depositionDate)<ccrIso_(record["Cash Collection Date"]))throw new Error("Cash Deposition date cannot be earlier than Cash Collection date.");return record;}

  function payloadCcrIds_(payload){const values=Array.isArray(payload&&payload.ccrIds)?payload.ccrIds:[payload&&payload.ccrId];const found={};return values.map(text).filter(id=>id&&!found[key(id)]&&(found[key(id)]=true));}
  function resolveCcrsForCdr_(user,payload,location,depositionDate,spreadsheet){const ids=payloadCcrIds_(payload);if(!ids.length)throw new Error("Select at least one open CCR before creating a CDR.");const records=ids.map(id=>resolveCcrForCdr_(user,id,location,depositionDate,spreadsheet));return records.sort((a,b)=>ccrIso_(a["Cash Collection Date"]).localeCompare(ccrIso_(b["Cash Collection Date"])));}
  function combinedCcr_(records){const first=records[0],ids=records.map(record=>text(record["CCR ID"])),dates=records.map(record=>ccrIso_(record["Cash Collection Date"]));return Object.assign({},first,{"CCR ID":ids.join(", "),"Total Collected":records.reduce((sum,record)=>sum+(Number(record["Total Collected"])||0),0),"Mail Thread ID":text((records.find(record=>text(record["Mail Thread ID"]))||first)["Mail Thread ID"]),__records:records,__ccrIds:ids,__collectionDates:dates});}

  function sendCdrMail_(spreadsheet,user,location,depositionDate,rowCount,slip,batchId,exportRows,ccr,remarks){const uploaderEmail=text(userValue(user,"REGISTERED_EMAIL")),ids=ccr.__ccrIds||[text(ccr["CCR ID"])],dates=ccr.__collectionDates||[ccrIso_(ccr["Cash Collection Date"])],csvAttachment=bankingCsvAttachment(exportRows,batchId,location,depositionDate),body=[recordsLabel_(ids.length,"Cash Deposition Report (CDR) completed.","Merged-days Cash Deposition Report (CDR) completed."),"Linked CCR IDs: "+ids.join(", "),"Cash Collection dates: "+dates.join(", "),"CDR Batch ID: "+batchId,"Cash Deposition date: "+displayDate(depositionDate,"dd-MM-yyyy"),"Line items: "+rowCount,"Remarks: "+remarks,"Bank receipt: "+slip.fileUrl,"Uploaded by: "+text(userValue(user,"RIDER_NAME")||userValue(user,"USERNAME"))].join("\n"),htmlBody="<p><b>"+html(ids.length>1?"Merged-days Cash Deposition Report (CDR) completed.":"Cash Deposition Report (CDR) completed.")+"</b></p><table cellpadding='6' cellspacing='0' border='1' style='border-collapse:collapse;border-color:#dbe5f1'><tr><td>Linked CCR IDs</td><td>"+html(ids.join(", "))+"</td></tr><tr><td>Cash Collection dates</td><td>"+html(dates.join(", "))+"</td></tr><tr><td>CDR Batch ID</td><td>"+html(batchId)+"</td></tr><tr><td>Deposition date</td><td>"+html(displayDate(depositionDate,"dd-MM-yyyy"))+"</td></tr><tr><td>Line items</td><td>"+rowCount+"</td></tr><tr><td>Remarks</td><td>"+html(remarks)+"</td></tr></table><p><a href='"+html(slip.fileUrl)+"'>Open bank receipt</a></p>";const options={htmlBody:htmlBody,attachments:[csvAttachment],replyTo:uploaderEmail};let thread=text(ccr["Mail Thread ID"])?GmailApp.getThreadById(text(ccr["Mail Thread ID"])):null;if(thread){thread.replyAll(body,options);return thread.getId();}const config=mailConfiguration(spreadsheet,location.zone);if(!config.to.length)throw new Error("Static To recipients are missing in the Mail ID sheet.");if(config.cc.length)options.cc=config.cc.join(",");const message=GmailApp.createDraft(config.to.join(","),ccrSubject_(location,validateCollectionDate(ccrIso_(ccr["Cash Collection Date"]))),body,options).send();return message.getThread().getId();}

  function recordsLabel_(count,single,multiple){return count>1?multiple:single;}

  function safeDriveName(value) {
    return text(value).replace(/[\\/:*?"<>|\x00-\x1F]/g, "_").slice(0, 120) || "Unspecified";
  }

  function childFolder(parent, name) {
    const safeName = safeDriveName(name);
    const existing = parent.getFoldersByName(safeName);
    return existing.hasNext() ? existing.next() : parent.createFolder(safeName);
  }

  function fileExtension(fileName, contentType) {
    const match = text(fileName).toLowerCase().match(/\.([a-z0-9]{2,6})$/);
    if (match) return match[1] === "jpeg" ? "jpg" : match[1];
    const map = {
      "image/jpeg": "jpg",
      "image/png": "png",
      "image/webp": "webp",
      "image/heic": "heic",
      "image/heif": "heif",
      "application/pdf": "pdf"
    };
    return map[contentType] || "bin";
  }

  function nextAvailableFileName(folder, baseName, extension) {
    let candidate = baseName + "." + extension;
    let number = 2;
    while (folder.getFilesByName(candidate).hasNext()) {
      candidate = baseName + "_" + number + "." + extension;
      number++;
    }
    return candidate;
  }

  function slipRequestKey(user, clientRequestId) {
    const requestId = text(clientRequestId);
    if (!requestId || requestId.length > 120) return "";
    const digest = Utilities.computeDigest(
      Utilities.DigestAlgorithm.SHA_256,
      text(userValue(user, "USERNAME")).toLowerCase() + "|SLIP|" + requestId
    );
    return SLIP_REQUEST_PREFIX + Utilities.base64EncodeWebSafe(digest).replace(/=+$/g, "");
  }

  function uploadSlip(user, payload) {
    requireAccess(user);
    cleanupExpiredReceipts();
    payload = payload || {};
    const location = locationForUser(user, payload.location || {});
    if (!location)
      return Utility.error("Choose a permitted Zone, Warehouse and LM Hub before uploading the banking slip.");

    let bankingDate;
    try {
      bankingDate = validateBusinessDate(payload.businessDate);
      resolveCcrsForCdr_(user, payload, location, text(payload.businessDate), SpreadsheetApp.openById(SPREADSHEET_ID));
    } catch (error) {
      return Utility.error(error.message);
    }

    const requestPropertyKey = slipRequestKey(user, payload.clientRequestId);
    if (requestPropertyKey) {
      try {
        const saved = PropertiesService.getScriptProperties().getProperty(requestPropertyKey);
        const existing = saved ? JSON.parse(saved) : null;
        if (existing && Number(existing.expiresAt || 0) >= Date.now() &&
            existing.username === text(userValue(user, "USERNAME")).toLowerCase() &&
            existing.businessDate === text(payload.businessDate) &&
            same(existing.ccrId, payloadCcrIds_(payload).join("|")) &&
            same(existing.zone, location.zone) &&
            same(existing.warehouse, location.warehouse) &&
            same(existing.lmHub, location.lmHub)) {
          return Utility.success("Banking slip already uploaded safely.", {
            receiptId: existing.receiptId,
            fileName: existing.fileName,
            fileUrl: existing.fileUrl
          });
        }
      } catch (error) {}
    }

    const match = text(payload.dataUrl).match(
      /^data:([^;,]+)(?:;[^,]*)?;base64,([A-Za-z0-9+/=\s]+)$/i
    );
    if (!match) return Utility.error("Choose a valid banking-slip image or PDF.");

    const contentType = text(match[1]).toLowerCase();
    const allowed = [
      "image/jpeg", "image/png", "image/webp", "image/heic", "image/heif", "application/pdf"
    ];
    if (allowed.indexOf(contentType) === -1)
      return Utility.error("The banking slip must be a JPG, PNG, WebP, HEIC, or PDF file.");

    try {
      const bytes = Utilities.base64Decode(match[2].replace(/\s/g, ""));
      if (bytes.length > MAX_SLIP_BYTES)
        return Utility.error("The banking slip must be 10 MB or smaller after compression.");

      let folder = DriveApp.getFolderById(SLIP_ROOT_FOLDER_ID);
      folder = childFolder(folder, location.zone);
      folder = childFolder(folder, location.warehouse);
      folder = childFolder(folder, location.lmHub);
      folder = childFolder(folder, displayDate(bankingDate, "MMMM yyyy"));

      const extension = fileExtension(payload.fileName, contentType);
      const baseName = safeDriveName(location.lmHub) + "_" + displayDate(bankingDate, "dd-MM-yyyy") + "_Banking_Slip";
      const fileName = nextAvailableFileName(folder, baseName, extension);
      const file = folder.createFile(Utilities.newBlob(bytes, contentType, fileName));
      const receiptId = Utilities.getUuid();
      const receipt = {
        receiptId,
        username: text(userValue(user, "USERNAME")).toLowerCase(),
        businessDate: text(payload.businessDate),
        ccrId: payloadCcrIds_(payload).join("|"),
        zone: location.zone,
        warehouse: location.warehouse,
        lmHub: location.lmHub,
        fileId: file.getId(),
        fileName: file.getName(),
        fileUrl: file.getUrl(),
        requestPropertyKey,
        expiresAt: Date.now() + SLIP_RECEIPT_TTL_MS
      };
      PropertiesService.getScriptProperties().setProperty(
        SLIP_RECEIPT_PREFIX + receiptId,
        JSON.stringify(receipt)
      );
      if (requestPropertyKey) {
        PropertiesService.getScriptProperties().setProperty(requestPropertyKey, JSON.stringify(receipt));
      }

      return Utility.success("Banking slip uploaded successfully.", {
        receiptId,
        fileName: receipt.fileName,
        fileUrl: receipt.fileUrl
      });
    } catch (error) {
      console.error(error && error.stack ? error.stack : error);
      return Utility.error("The banking slip could not be uploaded: " + (text(error.message) || "Drive access failed."));
    }
  }

  function slipReceipt(user, receiptId, businessDate, location, ccrId) {
    const id = text(receiptId);
    if (!id) throw new Error("Upload the mandatory banking slip before submitting banking data.");
    const property = PropertiesService.getScriptProperties().getProperty(SLIP_RECEIPT_PREFIX + id);
    if (!property) throw new Error("The banking-slip upload receipt is missing or expired. Upload the slip again.");
    let receipt;
    try { receipt = JSON.parse(property); }
    catch (error) { throw new Error("The banking-slip upload receipt is invalid. Upload the slip again."); }
    if (Number(receipt.expiresAt || 0) < Date.now())
      throw new Error("The banking-slip upload receipt expired. Upload the slip again.");
    if (receipt.username !== text(userValue(user, "USERNAME")).toLowerCase() ||
        receipt.businessDate !== text(businessDate) ||
        !same(receipt.ccrId, ccrId) ||
        !same(receipt.zone, location.zone) ||
        !same(receipt.warehouse, location.warehouse) ||
        !same(receipt.lmHub, location.lmHub))
      throw new Error("The banking slip does not match the selected user, date, and location.");
    return receipt;
  }

  function batchReceiptKey(user, clientRequestId) {
    const requestId = text(clientRequestId);
    if (!requestId || requestId.length > 120) return "";
    const digest = Utilities.computeDigest(
      Utilities.DigestAlgorithm.SHA_256,
      text(userValue(user, "USERNAME")).toLowerCase() + "|" + requestId
    );
    return BATCH_RECEIPT_PREFIX + Utilities.base64EncodeWebSafe(digest).replace(/=+$/g, "");
  }

  function readBatchReceipt(receiptKey) {
    if (!receiptKey) return null;
    try {
      const value = PropertiesService.getScriptProperties().getProperty(receiptKey);
      if (!value) return null;
      const stored = JSON.parse(value);
      if (stored && stored.result) {
        if (Number(stored.expiresAt || 0) < Date.now()) {
          PropertiesService.getScriptProperties().deleteProperty(receiptKey);
          return null;
        }
        return stored.result;
      }
      return stored;
    } catch (error) {
      return null;
    }
  }

  function storeBatchReceipt(receiptKey, result) {
    if (!receiptKey) return false;
    try {
      PropertiesService.getScriptProperties().setProperty(receiptKey, JSON.stringify({
        expiresAt: Date.now() + BATCH_RECEIPT_TTL_MS,
        result
      }));
      return true;
    } catch (error) {
      return false;
    }
  }

  function cleanupExpiredReceipts() {
    try {
      const properties = PropertiesService.getScriptProperties();
      const all = properties.getProperties();
      Object.keys(all).forEach(propertyKey => {
        if (propertyKey.indexOf(SLIP_RECEIPT_PREFIX) !== 0 &&
            propertyKey.indexOf(SLIP_REQUEST_PREFIX) !== 0 &&
            propertyKey.indexOf(BATCH_RECEIPT_PREFIX) !== 0) return;
        try {
          const value = JSON.parse(all[propertyKey]);
          if (Number(value.expiresAt || 0) < Date.now()) properties.deleteProperty(propertyKey);
        } catch (error) {
          properties.deleteProperty(propertyKey);
        }
      });
    } catch (error) {}
  }

  function styleNewSheet(sheet) {
    const header = sheet.getRange(1, 1, 1, STORAGE_HEADERS.length);
    header.setValues([STORAGE_HEADERS]);
    header.setBackground("#1267B5").setFontColor("#FFFFFF").setFontWeight("bold")
      .setHorizontalAlignment("center").setWrap(true);
    sheet.setFrozenRows(1);
    try { header.createFilter(); } catch (error) {}
    sheet.autoResizeColumns(1, STORAGE_HEADERS.length);
    sheet.setColumnWidth(STORAGE_HEADERS.indexOf("Drop Address") + 1, 360);
    sheet.setColumnWidth(STORAGE_HEADERS.indexOf("UPI Pic") + 1, 260);
    sheet.setColumnWidth(STORAGE_HEADERS.indexOf("Banking Slip") + 1, 220);
  }

  function storageHeadersForSheet(sheet) {
    if (!sheet || sheet.getLastRow() === 0 || sheet.getLastColumn() === 0) return null;
    const width = Math.min(sheet.getLastColumn(), LEGACY_STORAGE_HEADERS.length);
    const existing = sheet.getRange(1, 1, 1, width).getDisplayValues()[0];
    if (STORAGE_HEADERS.every((header, index) => same(header, existing[index]))) {
      return STORAGE_HEADERS.slice();
    }
    if (LEGACY_STORAGE_HEADERS.every((header, index) => same(header, existing[index]))) {
      return LEGACY_STORAGE_HEADERS.slice();
    }
    return null;
  }

  function monthSheet(spreadsheet, bankingDate) {
    const name = displayDate(bankingDate, "MMMM yyyy");
    let sheet = spreadsheet.getSheetByName(name);
    if (!sheet) {
      sheet = spreadsheet.insertSheet(name);
      styleNewSheet(sheet);
      return sheet;
    }

    if (sheet.getLastRow() === 0 || sheet.getLastColumn() === 0) {
      styleNewSheet(sheet);
      return sheet;
    }

    const recognizedHeaders = storageHeadersForSheet(sheet);
    if (!recognizedHeaders)
      throw new Error("The '" + name + "' banking sheet headers do not match this portal version.");
    const legacyIdColumn = recognizedHeaders.indexOf("Client Request ID");
    if (legacyIdColumn >= 0) {
      try { sheet.hideColumns(legacyIdColumn + 1); } catch (error) {}
    }
    return sheet;
  }

  function setHyperlinks(sheet, startRow, rows, storageHeaders) {
    storageHeaders = storageHeaders || STORAGE_HEADERS;
    const linkHeaders = ["UPI Pic", "Banking Slip"];
    linkHeaders.forEach(headerName => {
      const column = storageHeaders.indexOf(headerName);
      const richRows = rows.map(row => {
        const url = text(row[column]).replace(/^'/, "");
        let builder = SpreadsheetApp.newRichTextValue().setText(url);
        if (/^https:\/\//i.test(url)) builder = builder.setLinkUrl(url);
        return [builder.build()];
      });
      sheet.getRange(startRow, column + 1, rows.length, 1).setRichTextValues(richRows);
    });
  }

  function emails(value) {
    return text(value).split(/[;,\s]+/).map(text).filter(address => REGEX.EMAIL.test(address));
  }

  function mailConfiguration(spreadsheet, zone) {
    const sheet = spreadsheet.getSheetByName(MAIL_SHEET_NAME);
    if (!sheet) throw new Error("The Mail ID sheet is missing from the banking spreadsheet.");
    const values = sheet.getDataRange().getDisplayValues();
    if (!values.length) throw new Error("The Mail ID sheet is empty.");

    const rowByLabel = label => values.find(row => same(row[0], label)) || [];
    const to = emails(rowByLabel("To")[1]);
    const defaultCc = emails(rowByLabel("CC")[1]);
    const zoneColumn = values[0].findIndex(value => same(value, zone));
    const zoneCc = zoneColumn >= 0 && values[1] ? emails(values[1][zoneColumn]) : [];
    return {
      to,
      cc: zoneCc.length ? zoneCc : defaultCc
    };
  }

  function csvValue(value, header) {
    let output = value instanceof Date
      ? Utilities.formatDate(value, timeZone(), header === "Uploaded At" ? "dd-MM-yyyy HH:mm:ss" : "dd-MM-yyyy")
      : text(value);
    return '"' + output.replace(/"/g, '""') + '"';
  }

  function bankingCsvAttachment(rows, batchId, location, bankingDate) {
    const data = [BULK_EXPORT_HEADERS].concat(Array.isArray(rows) ? rows : []);
    const csv = "\uFEFF" + data.map(row => BULK_EXPORT_HEADERS.map((header, index) => csvValue(row[index], header)).join(",")).join("\r\n");
    const fileName = ["TrueMeds_Banking", safeDriveName(location.lmHub), displayDate(bankingDate, "dd-MM-yyyy"), safeDriveName(batchId)]
      .join("_") + ".csv";
    return Utilities.newBlob(csv, "text/csv", fileName);
  }

  function sendUploadMail(spreadsheet, user, location, bankingDate, rowCount, slip, batchId, exportRows) {
    const config = mailConfiguration(spreadsheet, location.zone);
    if (!config.to.length) throw new Error("Static To recipients are missing in the Mail ID sheet.");
    const uploaderEmail = text(userValue(user, "REGISTERED_EMAIL"));
    if (!REGEX.EMAIL.test(uploaderEmail))
      throw new Error("The logged-in user does not have a valid Registered Email in User Master.");

    const subject = "Hyperlocal cash collection || " + location.lmHub + " || " +
      displayDate(bankingDate, "d MMMM yyyy");
    const csvAttachment = bankingCsvAttachment(exportRows, batchId, location, bankingDate);
    const body = [
      "Banking upload completed.",
      "Batch ID: " + batchId,
      "Zone: " + location.zone,
      "Warehouse: " + location.warehouse,
      "LM Hub: " + location.lmHub,
      "Banking date: " + displayDate(bankingDate, "dd-MM-yyyy"),
      "Line items: " + rowCount,
      "Uploaded by: " + text(userValue(user, "RIDER_NAME") || userValue(user, "USERNAME")),
      "Registered email: " + uploaderEmail,
      "Banking slip: " + slip.fileUrl,
      "Banking data: attached CSV file for this upload"
    ].join("\n");

    const htmlBody = "<p>Banking upload completed successfully.</p>" +
      "<table cellpadding='6' cellspacing='0' border='1' style='border-collapse:collapse;border-color:#dbe5f1'>" +
      "<tr><td><b>Batch ID</b></td><td>" + batchId + "</td></tr>" +
      "<tr><td><b>Location</b></td><td>" + location.zone + " / " + location.warehouse + " / " + location.lmHub + "</td></tr>" +
      "<tr><td><b>Banking date</b></td><td>" + displayDate(bankingDate, "dd-MM-yyyy") + "</td></tr>" +
      "<tr><td><b>Line items</b></td><td>" + rowCount + "</td></tr>" +
      "<tr><td><b>Uploaded by</b></td><td>" + text(userValue(user, "RIDER_NAME") || userValue(user, "USERNAME")) +
      " (" + uploaderEmail + ")</td></tr></table>" +
      "<p><a href='" + slip.fileUrl + "'>Open banking slip</a></p>" +
      "<p>The CSV file attached to this email contains only the data from this Banking upload.</p>";

    const mailOptions = {
      to: config.to.join(","),
      subject,
      body,
      htmlBody,
      attachments: [csvAttachment],
      name: "TrueMeds HyperLocal Logistics Portal",
      replyTo: uploaderEmail
    };
    if (config.cc.length) mailOptions.cc = config.cc.join(",");
    MailApp.sendEmail(mailOptions);
  }

  function friendlyMailError(error) {
    const message = text(error && error.message);
    if (/not authorized|autorisé|autorizad|script\.send_mail|permission/i.test(message)) {
      return "Email permission is not authorized. A Super Admin must open Banking, use Authorize email service while signed in as the Apps Script deployment owner, and then retry this batch email.";
    }
    return message || "mail service failed.";
  }

  function submit(user, payload) {
    requireAccess(user);
    cleanupExpiredReceipts();
    payload = payload || {};
    const receiptKey = batchReceiptKey(user, payload.clientRequestId);
    const duplicate = readBatchReceipt(receiptKey);
    if (duplicate) return duplicate;

    let location;
    let bankingDate;
    let rows;
    let slip;
    let ccr;
    let ccrs;
    let cdrRemarks;
    let amountMatch;
    let duplicateMode;
    try {
      location = locationForUser(user, payload.location || {});
      if (!location) throw new Error("Choose a permitted Zone, Warehouse and LM Hub.");
      bankingDate = validateBusinessDate(payload.businessDate);
      if (!REGEX.EMAIL.test(text(userValue(user, "REGISTERED_EMAIL"))))
        throw new Error("Add a valid Registered Email for this user in User Master before banking upload.");
      validateHeaders(payload.headers);
      rows = validateRows(payload.rows);
      cdrRemarks = text(payload.remarks);
      if (cdrRemarks.length < 5) throw new Error("Enter a clear CDR remark of at least 5 characters before uploading.");
      const spreadsheetForCcr = SpreadsheetApp.openById(SPREADSHEET_ID);
      ccrs = resolveCcrsForCdr_(user, payload, location, text(payload.businessDate), spreadsheetForCcr);
      ccr = combinedCcr_(ccrs);
      amountMatch = requireCdrAmountMatch_(ccr, rows);
      slip = slipReceipt(user, payload.slipReceiptId, payload.businessDate, location, payloadCcrIds_(payload).join("|"));
      duplicateMode = key(payload.duplicateMode);
      if (["ADD_NEW", "OVERWRITE_IN_SCOPE"].indexOf(duplicateMode) === -1)
        throw new Error("Run the AWB duplicate check and choose Add new entry or Overwrite permitted entry before uploading.");
    } catch (error) {
      return Utility.error(error.message);
    }

    const lock = LockService.getScriptLock();
    if (!lock.tryLock(30000)) return Utility.error("Another banking upload is being saved. Please retry shortly.");

    try {
      const duplicateInsideLock = readBatchReceipt(receiptKey);
      if (duplicateInsideLock) return duplicateInsideLock;

      const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
      ccrs = resolveCcrsForCdr_(user, payload, location, text(payload.businessDate), spreadsheet);
      ccr = combinedCcr_(ccrs);
      amountMatch = requireCdrAmountMatch_(ccr, rows);
      const sheetDuplicate = existingBatchByClientRequest(spreadsheet, user, payload.clientRequestId, rows.length);
      if (sheetDuplicate) {
        if (receiptKey) storeBatchReceipt(receiptKey, sheetDuplicate);
        return sheetDuplicate;
      }
      const sheet = monthSheet(spreadsheet, bankingDate);
      const batchId = "BANK-" + Utilities.formatDate(new Date(), timeZone(), "yyyyMMdd-HHmmss") + "-" +
        Utilities.getUuid().slice(0, 8).toUpperCase();
      const bankingDateText = displayDate(bankingDate, "dd-MM-yyyy");
      const uploadedAt = new Date();
      const uploadedBy = text(userValue(user, "RIDER_NAME") || userValue(user, "USERNAME"));
      const uploadedEmail = text(userValue(user, "REGISTERED_EMAIL"));
      const destinationHeaders = storageHeadersForSheet(sheet) || STORAGE_HEADERS.slice();
      const storedRows = rows.map(row => destinationHeaders.map(header => {
        if (header === "Upload Batch ID") return batchId;
        if (header === "Client Request ID") return text(payload.clientRequestId);
        if (header === "Banking Date") return bankingDateText;
        if (header === "Zone") return location.zone;
        if (header === "Warehouse") return location.warehouse;
        if (header === "LM Hub") return location.lmHub;
        if (header === "Banking Slip") return slip.fileUrl;
        if (header === "Uploaded By") return uploadedBy;
        if (header === "Uploaded Email") return uploadedEmail;
        if (header === "Uploaded At") return uploadedAt;
        const templateIndex = TEMPLATE_HEADERS.indexOf(header);
        return templateIndex >= 0 ? row[templateIndex] : "";
      }));
      const allowed = allowedLocationMap(user);
      const awbIndex = TEMPLATE_HEADERS.indexOf("AWB");
      const storageAwbIndex = destinationHeaders.indexOf("AWB");
      const awbs = rows.map(row => normalizedAwb(row[awbIndex]));
      const matchesByAwb = repositoryAwbMatches(spreadsheet, awbs);
      const appendStartRow = sheet.getLastRow() + 1;
      const appendRows = [];
      const updates = [];
      const deletions = [];
      const audits = [];
      let overwrittenCount = 0;

      storedRows.forEach((storedRow, index) => {
        const awb = normalizedAwb(storedRow[storageAwbIndex]);
        const allMatches = matchesByAwb[awb] || [];
        const candidate = latestAllowedMatch(allMatches, allowed);
        const replacement = rowObject(destinationHeaders, storedRow, null);

        if (duplicateMode === "OVERWRITE_IN_SCOPE" && candidate) {
          overwrittenCount++;
          if (candidate.sheetName === sheet.getName()) {
            updates.push({ sheet, rowNumber: candidate.rowNumber, storedRow });
            audits.push(auditRow(
              user, location, "OVERWRITE", candidate.record, replacement,
              { sheetName: candidate.sheetName, rowNumber: candidate.rowNumber },
              { sheetName: sheet.getName(), rowNumber: candidate.rowNumber }, batchId
            ));
          } else {
            const destinationRow = appendStartRow + appendRows.length;
            appendRows.push(storedRow);
            deletions.push(candidate);
            audits.push(auditRow(
              user, location, "OVERWRITE_MOVE_MONTH", candidate.record, replacement,
              { sheetName: candidate.sheetName, rowNumber: candidate.rowNumber },
              { sheetName: sheet.getName(), rowNumber: destinationRow }, batchId
            ));
          }
        } else {
          const destinationRow = appendStartRow + appendRows.length;
          appendRows.push(storedRow);
          if (duplicateMode === "ADD_NEW" && candidate) {
            audits.push(auditRow(
              user, location, "ADD_NEW_DUPLICATE", candidate.record, replacement,
              { sheetName: candidate.sheetName, rowNumber: candidate.rowNumber },
              { sheetName: sheet.getName(), rowNumber: destinationRow }, batchId
            ));
          }
        }
      });

      let audit = null;
      let auditStartRow = 0;
      if (audits.length) {
        audit = auditSheet(spreadsheet);
        auditStartRow = audit.getLastRow() + 1;
        audit.getRange(auditStartRow, 1, audits.length, AUDIT_HEADERS.length).setValues(audits);
        audit.getRange(auditStartRow, AUDIT_HEADERS.indexOf("Timestamp") + 1, audits.length, 1)
          .setNumberFormat("dd-MM-yyyy HH:mm:ss");
      }

      const warnings = [];
      if (appendRows.length) {
        sheet.getRange(appendStartRow, 1, appendRows.length, destinationHeaders.length).setValues(appendRows);
        try { setHyperlinks(sheet, appendStartRow, appendRows, destinationHeaders); }
        catch (error) { warnings.push("Links were stored but hyperlink styling could not be applied to added rows."); }
        try { formatStoredRows(sheet, appendStartRow, appendRows.length, destinationHeaders); } catch (error) {}
      }

      updates.forEach(update => {
        update.sheet.getRange(update.rowNumber, 1, 1, destinationHeaders.length).setValues([update.storedRow]);
        try { setHyperlinks(update.sheet, update.rowNumber, [update.storedRow], destinationHeaders); }
        catch (error) { warnings.push("One overwritten row was saved without hyperlink styling."); }
        try { formatStoredRows(update.sheet, update.rowNumber, 1, destinationHeaders); } catch (error) {}
      });

      const deletionsBySheet = {};
      deletions.forEach(match => {
        if (!deletionsBySheet[match.sheetName]) deletionsBySheet[match.sheetName] = { sheet: match.sheet, rows: [] };
        deletionsBySheet[match.sheetName].rows.push(match.rowNumber);
      });
      Object.keys(deletionsBySheet).forEach(sheetName => {
        const group = deletionsBySheet[sheetName];
        group.rows.sort((left, right) => right - left).forEach(rowNumber => group.sheet.deleteRow(rowNumber));
      });

      if (audit && audits.length) {
        try {
          audit.getRange(auditStartRow, AUDIT_HEADERS.indexOf("Outcome") + 1, audits.length, 1)
            .setValues(audits.map(() => ["COMMITTED"]));
        } catch (error) {
          warnings.push("Banking data was saved, but the audit outcome marker remains PENDING. Ask a Super Admin to review the Banking Audit Log.");
        }
      }

      const addedCount = storedRows.length - overwrittenCount;
      const operationMessage = storedRows.length + " banking line item(s) processed successfully: " +
        addedCount + " added, " + overwrittenCount + " overwritten.";

      const baseResult = Utility.success(
        operationMessage,
        {
          batchId,
          rowCount: storedRows.length,
          sheetName: sheet.getName(),
          bankingDate: bankingDateText,
          slipUrl: slip.fileUrl,
          addedCount,
          overwrittenCount,
          auditLogCount: audits.length,
          duplicateMode,
          amountMatch,
          ccrIds: ccr.__ccrIds,
          collectionDates: ccr.__collectionDates,
          warnings
        }
      );
      if (receiptKey && !storeBatchReceipt(receiptKey, baseResult)) {
        baseResult.data.warnings.push("The duplicate-protection cache was unavailable. Verify the Batch ID before retrying this upload.");
      }
      PropertiesService.getScriptProperties().deleteProperty(SLIP_RECEIPT_PREFIX + slip.receiptId);
      if (slip.requestPropertyKey) {
        PropertiesService.getScriptProperties().deleteProperty(slip.requestPropertyKey);
      }

      try {
        const exportRows = storedRows.map(row => BULK_EXPORT_HEADERS.map(header => row[destinationHeaders.indexOf(header)]));
        const threadId=sendCdrMail_(spreadsheet, user, location, bankingDate, storedRows.length, slip, batchId, exportRows, ccr, cdrRemarks);
        const ccrSheet=ccrSheet_(spreadsheet);
        ccrs.forEach(record=>updateCcr_(ccrSheet,record.__row,{"CDR Batch ID":batchId,"Cash Deposition Date":bankingDate,"Status":"CDR Completed","Mail Thread ID":threadId,"CDR Mail Sent":"Yes","CDR Remarks":cdrRemarks,"Mail Count":Number(record["Mail Count"]||0)+1,"Last Mail Sent At":new Date()}));
        baseResult.data.emailSent = true;
        baseResult.data.emailCount = Math.max.apply(null,ccrs.map(record=>Number(record["Mail Count"]||0)+1));
        baseResult.data.ccrId = ccr.__ccrIds.join(", ");
      } catch (error) {
        const ccrSheet=ccrSheet_(spreadsheet);
        ccrs.forEach(record=>updateCcr_(ccrSheet,record.__row,{"CDR Batch ID":batchId,"Cash Deposition Date":bankingDate,"Status":"CDR Completed - Email Pending","CDR Mail Sent":"No","CDR Remarks":cdrRemarks}));
        baseResult.data.emailSent = false;
        baseResult.data.ccrId = ccr.__ccrIds.join(", ");
        baseResult.data.warnings.push(
          "Data was saved, but email was not sent: " + friendlyMailError(error)
        );
      }
      if (receiptKey) storeBatchReceipt(receiptKey, baseResult);
      return baseResult;
    } catch (error) {
      console.error(error && error.stack ? error.stack : error);
      return Utility.error("Banking upload failed: " + (text(error.message) || "Unable to save the monthly sheet."));
    } finally {
      lock.releaseLock();
    }
  }

  function rowObject(headers, values, richValues) {
    const output = {};
    headers.forEach((header, index) => {
      let value = values[index];
      const rich = richValues && richValues[index];
      if (rich && rich.getLinkUrl()) value = rich.getLinkUrl();
      output[header] = value instanceof Date
        ? Utilities.formatDate(value, timeZone(), header === "Uploaded At" ? "dd-MM-yyyy HH:mm:ss" : "dd-MM-yyyy")
        : (value === null || value === undefined ? "" : value);
    });
    return output;
  }

  function sheetMonthRange(name) {
    const match = text(name).toUpperCase().match(/^([A-Z]+)\s+(\d{4})$/);
    const month = match ? MONTH_NAMES.indexOf(match[1]) : -1;
    if (month < 0) return null;
    const year = Number(match[2]);
    const start = year + "-" + String(month + 1).padStart(2, "0") + "-01";
    const lastDay = new Date(year, month + 1, 0).getDate();
    const end = year + "-" + String(month + 1).padStart(2, "0") + "-" + String(lastDay).padStart(2, "0");
    return { start, end };
  }

  function monthlySheets(spreadsheet, filters) {
    filters = filters || {};
    return spreadsheet.getSheets().filter(sheet => {
      const range = sheetMonthRange(sheet.getName());
      if (!range) return false;
      if (text(filters.startDate) && range.end < text(filters.startDate)) return false;
      if (text(filters.endDate) && range.start > text(filters.endDate)) return false;
      return true;
    });
  }

  function parseDisplayDate(value) {
    const match = text(value).match(/^(\d{2})-(\d{2})-(\d{4})$/);
    return match ? match[3] + "-" + match[2] + "-" + match[1] : "";
  }

  function allowedLocationMap(user) {
    const map = {};
    locationsForUser(user).forEach(location => {
      map[[key(location.zone), key(location.warehouse), key(location.lmHub)].join("|")] = true;
    });
    return map;
  }

  function recordAllowed(map, record) {
    return !!map[[key(record.Zone), key(record.Warehouse), key(record["LM Hub"])].join("|")];
  }

  function repositoryAwbMatches(spreadsheet, awbs) {
    const wanted = {};
    (awbs || []).forEach(awb => { if (normalizedAwb(awb)) wanted[normalizedAwb(awb)] = true; });
    const matches = {};
    Object.keys(wanted).forEach(awb => { matches[awb] = []; });

    monthlySheets(spreadsheet).forEach(sheet => {
      if (sheet.getLastRow() < 2) return;
      const headers = storageHeadersForSheet(sheet);
      if (!headers) return;
      const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, headers.length).getValues();
      values.forEach((row, index) => {
        const awb = normalizedAwb(row[headers.indexOf("AWB")]);
        if (!wanted[awb]) return;
        const record = rowObject(headers, row, null);
        const uploadedAt = row[headers.indexOf("Uploaded At")];
        const uploadedSort = uploadedAt instanceof Date && !isNaN(uploadedAt)
          ? uploadedAt.getTime()
          : Date.parse(text(uploadedAt)) || 0;
        matches[awb].push({
          awb,
          sheet,
          sheetName: sheet.getName(),
          rowNumber: index + 2,
          values: row.slice(),
          record,
          sortKey: uploadedSort || (Date.parse(parseDisplayDate(record["Banking Date"])) || 0),
          orderKey: index + 2
        });
      });
    });
    return matches;
  }

  function latestAllowedMatch(matches, allowed) {
    return (matches || []).filter(match => recordAllowed(allowed, match.record)).sort((left, right) =>
      (right.sortKey - left.sortKey) || right.sheetName.localeCompare(left.sheetName) ||
      (right.orderKey - left.orderKey)
    )[0] || null;
  }

  function duplicateSummary(awb, matches, allowed) {
    const inScope = (matches || []).filter(match => recordAllowed(allowed, match.record));
    const candidate = latestAllowedMatch(matches, allowed);
    return {
      awb,
      totalMatches: (matches || []).length,
      inScopeMatches: inScope.length,
      outsideScopeMatches: Math.max(0, (matches || []).length - inScope.length),
      overwriteCandidate: candidate ? {
        batchId: text(candidate.record["Upload Batch ID"]),
        bankingDate: text(candidate.record["Banking Date"]),
        zone: text(candidate.record.Zone),
        warehouse: text(candidate.record.Warehouse),
        lmHub: text(candidate.record["LM Hub"]),
        uploadedAt: text(candidate.record["Uploaded At"])
      } : null
    };
  }

  function preflight(user, payload) {
    requireAccess(user);
    payload = payload || {};
    try {
      const location = locationForUser(user, payload.location || {});
      if (!location) throw new Error("Choose a permitted Zone, Warehouse and LM Hub.");
      validateBusinessDate(payload.businessDate);
      validateHeaders(payload.headers);
      const rows = validateRows(payload.rows);
      const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
      const ccrs = resolveCcrsForCdr_(user, payload, location, text(payload.businessDate), spreadsheet);
      const ccr = combinedCcr_(ccrs);
      const amountMatch = requireCdrAmountMatch_(ccr, rows);
      const awbIndex = TEMPLATE_HEADERS.indexOf("AWB");
      const awbs = rows.map(row => normalizedAwb(row[awbIndex]));
      const allowed = allowedLocationMap(user);
      const matches = repositoryAwbMatches(spreadsheet, awbs);
      const duplicates = awbs.map(awb => duplicateSummary(awb, matches[awb], allowed))
        .filter(summary => summary.totalMatches > 0);
      return Utility.success(
        duplicates.length
          ? duplicates.length + " AWB(s) already exist in the Banking repository."
          : "No existing AWBs were found. The upload can continue.",
        {
          hasDuplicates: duplicates.length > 0,
          duplicates,
          inScopeDuplicateAwbs: duplicates.filter(item => item.inScopeMatches > 0).length,
          outsideScopeMatchCount: duplicates.reduce((sum, item) => sum + item.outsideScopeMatches, 0),
          checkedAwbs: awbs.length,
          ccr: ccrDto_(ccr),
          ccrs: ccrs.map(ccrDto_),
          ccrIds: ccr.__ccrIds,
          collectionDates: ccr.__collectionDates,
          amountMatch
        }
      );
    } catch (error) {
      return Utility.error(error.message);
    }
  }

  function auditSheet(spreadsheet) {
    let sheet = spreadsheet.getSheetByName(AUDIT_SHEET_NAME);
    if (!sheet) sheet = spreadsheet.insertSheet(AUDIT_SHEET_NAME);

    if (sheet.getLastRow() === 0 || sheet.getLastColumn() === 0) {
      const header = sheet.getRange(1, 1, 1, AUDIT_HEADERS.length);
      header.setValues([AUDIT_HEADERS]).setBackground("#102A56").setFontColor("#FFFFFF")
        .setFontWeight("bold").setHorizontalAlignment("center").setWrap(true);
      sheet.setFrozenRows(1);
      try { header.createFilter(); } catch (error) {}
      sheet.setColumnWidth(AUDIT_HEADERS.indexOf("Previous Record JSON") + 1, 420);
      sheet.setColumnWidth(AUDIT_HEADERS.indexOf("Replacement Record JSON") + 1, 420);
      return sheet;
    }

    const existing = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), AUDIT_HEADERS.length))
      .getDisplayValues()[0].slice(0, AUDIT_HEADERS.length);
    if (!AUDIT_HEADERS.every((header, index) => same(header, existing[index]))) {
      throw new Error(
        "The '" + AUDIT_SHEET_NAME + "' sheet does not have the required audit headers. " +
        "Keep that named sheet blank for automatic setup or use the supplied audit template."
      );
    }
    return sheet;
  }

  function auditRow(user, location, action, previous, replacement, source, destination, batchId) {
    return [
      "BAUD-" + Utilities.formatDate(new Date(), timeZone(), "yyyyMMdd-HHmmss") + "-" +
        Utilities.getUuid().slice(0, 8).toUpperCase(),
      new Date(),
      "PENDING",
      action,
      text(replacement.AWB || previous.AWB),
      text(previous["Upload Batch ID"]),
      batchId,
      text(userValue(user, "USERNAME")),
      text(userValue(user, "RIDER_NAME") || userValue(user, "USERNAME")),
      text(userValue(user, "REGISTERED_EMAIL")),
      roleOf(user),
      scopeOf(user),
      location.zone,
      location.warehouse,
      location.lmHub,
      source.sheetName || "",
      source.rowNumber || "",
      destination.sheetName || "",
      destination.rowNumber || "",
      JSON.stringify(previous),
      JSON.stringify(replacement)
    ];
  }

  function formatStoredRows(sheet, startRow, rowCount, storageHeaders) {
    if (!rowCount) return;
    storageHeaders = storageHeaders || STORAGE_HEADERS;
    sheet.getRange(startRow, storageHeaders.indexOf("Banking Date") + 1, rowCount, 1)
      .setNumberFormat("dd-MM-yyyy");
    sheet.getRange(startRow, storageHeaders.indexOf("Uploaded At") + 1, rowCount, 1)
      .setNumberFormat("dd-MM-yyyy HH:mm:ss");
  }

  function filterRecord(record, filters) {
    filters = filters || {};
    const isoDate = parseDisplayDate(record["Banking Date"]);
    if (text(filters.startDate) && isoDate < text(filters.startDate)) return false;
    if (text(filters.endDate) && isoDate > text(filters.endDate)) return false;
    const zones = Array.isArray(filters.zones) ? filters.zones.map(text).filter(Boolean) : [text(filters.zone)].filter(Boolean);
    const warehouses = Array.isArray(filters.warehouses) ? filters.warehouses.map(text).filter(Boolean) : [text(filters.warehouse)].filter(Boolean);
    const hubs = Array.isArray(filters.lmHubs) ? filters.lmHubs.map(text).filter(Boolean) : [text(filters.lmHub)].filter(Boolean);
    if (zones.length && !zones.some(value => same(record.Zone, value))) return false;
    if (warehouses.length && !warehouses.some(value => same(record.Warehouse, value))) return false;
    if (hubs.length && !hubs.some(value => same(record["LM Hub"], value))) return false;
    return true;
  }

  function readSheetRecords(sheet) {
    if (sheet.getLastRow() < 2) return [];
    const headers = storageHeadersForSheet(sheet);
    if (!headers) return [];
    const range = sheet.getRange(2, 1, sheet.getLastRow() - 1, headers.length);
    const values = range.getValues();
    return values.map(row => rowObject(headers, row, null));
  }

  function existingBatchByClientRequest(spreadsheet, user, clientRequestId, expectedRowCount) {
    const wanted = text(clientRequestId);
    if (!wanted) return null;
    const userEmail = text(userValue(user, "REGISTERED_EMAIL")).toLowerCase();
    let found = null;
    monthlySheets(spreadsheet).some(sheet => {
      const record = readSheetRecords(sheet).find(item =>
        text(item["Client Request ID"]) === wanted &&
        text(item["Uploaded Email"]).toLowerCase() === userEmail
      );
      if (!record) return false;
      const matchingRows = readSheetRecords(sheet).filter(item =>
        text(item["Client Request ID"]) === wanted &&
        text(item["Uploaded Email"]).toLowerCase() === userEmail
      );
      if (Number(expectedRowCount || 0) && matchingRows.length !== Number(expectedRowCount)) {
        found = Utility.error(
          "A partial Banking save was detected for this request (" + matchingRows.length + " of " +
          Number(expectedRowCount) + " rows). Do not upload again. Ask a Super Admin to inspect PENDING rows in Banking Audit Log."
        );
        return true;
      }
      found = Utility.success("This banking upload was already saved safely.", {
        batchId: text(record["Upload Batch ID"]),
        rowCount: matchingRows.length,
        sheetName: sheet.getName(),
        bankingDate: text(record["Banking Date"]),
        slipUrl: text(record["Banking Slip"]),
        emailSent: true,
        warnings: []
      });
      return true;
    });
    return found;
  }

  function validateRepositoryFilters(filters) {
    filters = filters || {};
    if (text(filters.startDate) && text(filters.endDate) && text(filters.startDate) > text(filters.endDate))
      throw new Error("The repository end date must not be earlier than the start date.");
    return filters;
  }

  function matchingRecords(user, filters, spreadsheet) {
    filters = validateRepositoryFilters(filters);
    const allowed = allowedLocationMap(user);
    const records = [];
    monthlySheets(spreadsheet, filters).forEach(sheet => {
      readSheetRecords(sheet).forEach(record => {
        if (recordAllowed(allowed, record) && filterRecord(record, filters)) {
          record.__sheetName = sheet.getName();
          records.push(record);
        }
      });
    });
    return records;
  }

  function search(user, filters) {
    requireAccess(user);
    const groups = {};
    const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
    let records;
    try { records = matchingRecords(user, filters || {}, spreadsheet); }
    catch (error) { return Utility.error(error.message); }

    const ccrByBatch = {};
    ccrRows_(spreadsheet).forEach(record => { const batch=text(record["CDR Batch ID"]);if(batch){if(!ccrByBatch[batch])ccrByBatch[batch]=[];ccrByBatch[batch].push(record);} });
    records.forEach(record => {
      const batchId = text(record["Upload Batch ID"]);
      if (!batchId) return;
      if (!groups[batchId]) {
        const linked=ccrByBatch[batchId]||[],ccr=linked.length?combinedCcr_(linked):null;
        groups[batchId] = {
          batchId,
          bankingDate: text(record["Banking Date"]),
          depositionDate: text(record["Banking Date"]),
          collectionDate: ccr?ccr.__collectionDates.join(", "):"",
          ccrId: ccr?ccr.__ccrIds.join(", "):"",
          zone: text(record.Zone),
          warehouse: text(record.Warehouse),
          lmHub: text(record["LM Hub"]),
          slipUrl: text(record["Banking Slip"]),
          uploadedBy: text(record["Uploaded By"]),
          uploadedEmail: text(record["Uploaded Email"]),
          uploadedAt: text(record["Uploaded At"]),
          sheetName: text(record.__sheetName),
          status: ccr?text(ccr.Status):"Legacy CDR",
          emailSent: ccr?same(ccr["CDR Mail Sent"],"Yes"):false,
          emailCount: ccr?Number(ccr["Mail Count"]||0):0,
          lastEmailSentAt: ccr?ccrDto_(ccr).lastMailSentAt:"",
          lineCount: 0
        };
      }
      groups[batchId].lineCount++;
    });

    const batches = Object.keys(groups).map(id => groups[id]).sort((left, right) =>
      (right.batchId || "").localeCompare(left.batchId || "")
    ).slice(0, 500);
    return Utility.success(SUCCESS.FETCHED, batches);
  }

  function bulk(user, filters) {
    requireAccess(user);
    const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
    let records;
    try { records = matchingRecords(user, filters || {}, spreadsheet); }
    catch (error) { return Utility.error(error.message); }
    if (!records.length) return Utility.error("No banking line items matched these filters.");
    if (records.length > MAX_BULK_EXPORT_ROWS) {
      return Utility.error(
        "This search contains " + records.length + " line items. Narrow the date or location filters to " +
        MAX_BULK_EXPORT_ROWS + " rows or fewer per download."
      );
    }
    return Utility.success(SUCCESS.FETCHED, {
      headers: BULK_EXPORT_HEADERS.slice(),
      rows: records.map(record => BULK_EXPORT_HEADERS.map(header => record[header])),
      rowCount: records.length
    });
  }

  function resendEmail(user, batchId) {
    requireAccess(user);
    const wanted = text(batchId);
    if (!wanted) return Utility.error("Banking batch ID is required.");
    const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
    const records = matchingRecords(user, {}, spreadsheet).filter(record => text(record["Upload Batch ID"]) === wanted);
    if (!records.length) return Utility.error("Banking batch not found in your permitted scope.");
    const first = records[0];
    try {
      const ccrs=ccrRows_(spreadsheet).filter(record=>same(record["CDR Batch ID"],wanted));
      if(!ccrs.length)return Utility.error("This is a legacy banking batch without a linked CCR. Same-thread resend is unavailable.");
      const ccr=combinedCcr_(ccrs);
      const exportRows = records.map(record => BULK_EXPORT_HEADERS.map(header => record[header]));
      const remarks=text(ccr["CDR Remarks"]||"CDR confirmation email resent.");
      const threadId=sendCdrMail_(spreadsheet,{REGISTERED_EMAIL:text(first["Uploaded Email"]),RIDER_NAME:text(first["Uploaded By"]),USERNAME:text(first["Uploaded By"])},{zone:text(first.Zone),warehouse:text(first.Warehouse),lmHub:text(first["LM Hub"])},parseIsoDate(parseDisplayDate(first["Banking Date"]),"Cash Deposition date"),records.length,{fileUrl:text(first["Banking Slip"])},wanted,exportRows,ccr,remarks);
      const sheet=ccrSheet_(spreadsheet),counts=ccrs.map(record=>Number(record["Mail Count"]||0)+1);ccrs.forEach((record,index)=>updateCcr_(sheet,record.__row,{"Mail Thread ID":threadId,"CDR Mail Sent":"Yes","Mail Count":counts[index],"Last Mail Sent At":new Date(),"Status":"CDR Completed"}));
      return Utility.success("CDR confirmation email sent successfully on the CCR thread.", { batchId: wanted,ccrId:ccr.__ccrIds.join(", "),emailSent:true,emailCount:Math.max.apply(null,counts) });
    } catch (error) {
      return Utility.error("Email was not sent: " + friendlyMailError(error));
    }
  }

  function mailAuthorization(user) {
    requireAccess(user);
    if (roleOf(user) !== "SUPER_ADMIN") {
      return Utility.error("Only a Super Admin can open the email-service authorization control.");
    }
    try {
      const info = ScriptApp.getAuthorizationInfo(ScriptApp.AuthMode.FULL, [MAIL_SCOPE]);
      const authorizedScopes = info.getAuthorizedScopes() || [];
      const required = info.getAuthorizationStatus() === ScriptApp.AuthorizationStatus.REQUIRED || authorizedScopes.indexOf(MAIL_SCOPE) === -1;
      return Utility.success(required ? "Email service authorization is required." : "Email service is authorized.", {
        required,
        authorizationUrl: required ? text(info.getAuthorizationUrl()) : "",
        deploymentOwnerEmail: text(Session.getEffectiveUser().getEmail()),
        authorizedScopes,
        googleConsentRequired: true
      });
    } catch (error) {
      return Utility.error("Unable to check email authorization: " + (text(error.message) || "authorization service failed."));
    }
  }

  function hideTechnicalColumns() {
    const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
    let hidden = 0;
    monthlySheets(spreadsheet).forEach(sheet => {
      const headers = storageHeadersForSheet(sheet);
      if (!headers) return;
      const clientIdColumn = headers.indexOf("Client Request ID");
      if (clientIdColumn < 0) return;
      try {
        sheet.hideColumns(clientIdColumn + 1);
        hidden++;
      } catch (error) {}
    });
    return hidden;
  }

  function batch(user, batchId) {
    requireAccess(user);
    const wanted = text(batchId);
    if (!wanted) return Utility.error("Banking batch ID is required.");
    const allowed = allowedLocationMap(user);
    const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
    let matches = [];
    let meta = null;

    monthlySheets(spreadsheet).some(sheet => {
      const records = readSheetRecords(sheet).filter(record => text(record["Upload Batch ID"]) === wanted);
      if (!records.length) return false;
      if (!recordAllowed(allowed, records[0])) throw new Error(ERROR.ACCESS_DENIED);
      matches = records;
      meta = {
        batchId: wanted,
        bankingDate: text(records[0]["Banking Date"]),
        zone: text(records[0].Zone),
        warehouse: text(records[0].Warehouse),
        lmHub: text(records[0]["LM Hub"]),
        slipUrl: text(records[0]["Banking Slip"]),
        uploadedBy: text(records[0]["Uploaded By"]),
        uploadedEmail: text(records[0]["Uploaded Email"]),
        uploadedAt: text(records[0]["Uploaded At"])
      };
      return true;
    });

    if (!matches.length) return Utility.error("Banking batch not found in your permitted scope.");
    const linkedCcrs=ccrRows_(spreadsheet).filter(record=>same(record["CDR Batch ID"],wanted));
    if(linkedCcrs.length){const linkedCcr=combinedCcr_(linkedCcrs);meta=Object.assign(meta,{ccrId:linkedCcr.__ccrIds.join(", "),ccrIds:linkedCcr.__ccrIds,collectionDate:linkedCcr.__collectionDates.join(", "),collectionDates:linkedCcr.__collectionDates,depositionDate:ccrIso_(linkedCcr["Cash Deposition Date"]),status:text(linkedCcr.Status),emailSent:linkedCcrs.every(record=>same(record["CDR Mail Sent"],"Yes")),emailCount:Math.max.apply(null,linkedCcrs.map(record=>Number(record["Mail Count"]||0))),lastEmailSentAt:ccrDto_(linkedCcr).lastMailSentAt,cdrRemarks:text(linkedCcr["CDR Remarks"])});}
    const rows = matches.map(record => TEMPLATE_HEADERS.map(header => record[header]));
    return Utility.success(SUCCESS.FETCHED, {
      headers: TEMPLATE_HEADERS.slice(),
      rows,
      meta
    });
  }

  return {
    context,
    uploadSlip,
    preflight,
    submit,
    search,
    bulk,
    submitCcr,
    updateCcr,
    resendCcrEmail,
    dashboard,
    searchCcr,
    resendEmail,
    mailAuthorization,
    batch,
    hideTechnicalColumns,
    canUse
  };

})();

/**
 * Run this once from the Apps Script editor as the web-app deployment owner.
 * It triggers the Mail authorization prompt and hides the technical idempotency
 * column in existing monthly Banking sheets without deleting the stored IDs.
 */
function authorizeBankingServices() {
  ScriptApp.requireScopes(ScriptApp.AuthMode.FULL, ["https://mail.google.com/"]);
  const authorizationInfo = ScriptApp.getAuthorizationInfo(ScriptApp.AuthMode.FULL, ["https://mail.google.com/"]);
  if (authorizationInfo.getAuthorizationStatus() === ScriptApp.AuthorizationStatus.REQUIRED) {
    throw new Error("Full Gmail permission is still required. Run this function again and approve the Gmail permission in Google's consent screen.");
  }
  GmailApp.getInboxThreads(0, 1);
  const remainingRecipients = MailApp.getRemainingDailyQuota();
  const hiddenSheets = Banking.hideTechnicalColumns();
  const result = {
    success: true,
    remainingRecipients,
    hiddenTechnicalColumnInSheets: hiddenSheets,
    fullGmailAuthorized: true
  };
  console.log(JSON.stringify(result));
  return result;
}
