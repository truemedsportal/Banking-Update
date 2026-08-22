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
  const MAX_ROWS = 1000;
  const MAX_BULK_EXPORT_ROWS = 10000;
  const MAX_SLIP_BYTES = 10 * 1024 * 1024;
  const SLIP_RECEIPT_PREFIX = "BANKING_SLIP_RECEIPT_";
  const SLIP_REQUEST_PREFIX = "BANKING_SLIP_REQUEST_";
  const BATCH_RECEIPT_PREFIX = "BANKING_BATCH_RECEIPT_";
  const SLIP_RECEIPT_TTL_MS = 2 * 60 * 60 * 1000;
  const BATCH_RECEIPT_TTL_MS = 30 * 24 * 60 * 60 * 1000;
  const MAIL_SCOPE = "https://www.googleapis.com/auth/script.send_mail";
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
    const parsed = parseIsoDate(raw, "Banking date");
    const today = Utilities.formatDate(new Date(), timeZone(), "yyyy-MM-dd");
    if (raw >= today)
      throw new Error("Select yesterday or an earlier business date. Today's banking date is not allowed.");
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
      dateHeaders: DATE_HEADERS.slice()
    });
  }

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

  function slipReceipt(user, receiptId, businessDate, location) {
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
    let duplicateMode;
    try {
      location = locationForUser(user, payload.location || {});
      if (!location) throw new Error("Choose a permitted Zone, Warehouse and LM Hub.");
      bankingDate = validateBusinessDate(payload.businessDate);
      if (!REGEX.EMAIL.test(text(userValue(user, "REGISTERED_EMAIL"))))
        throw new Error("Add a valid Registered Email for this user in User Master before banking upload.");
      validateHeaders(payload.headers);
      rows = validateRows(payload.rows);
      slip = slipReceipt(user, payload.slipReceiptId, payload.businessDate, location);
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
        sendUploadMail(spreadsheet, user, location, bankingDate, storedRows.length, slip, batchId, exportRows);
        baseResult.data.emailSent = true;
      } catch (error) {
        baseResult.data.emailSent = false;
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
      const awbIndex = TEMPLATE_HEADERS.indexOf("AWB");
      const awbs = rows.map(row => normalizedAwb(row[awbIndex]));
      const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
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
          checkedAwbs: awbs.length
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

    records.forEach(record => {
      const batchId = text(record["Upload Batch ID"]);
      if (!batchId) return;
      if (!groups[batchId]) {
        groups[batchId] = {
          batchId,
          bankingDate: text(record["Banking Date"]),
          zone: text(record.Zone),
          warehouse: text(record.Warehouse),
          lmHub: text(record["LM Hub"]),
          slipUrl: text(record["Banking Slip"]),
          uploadedBy: text(record["Uploaded By"]),
          uploadedEmail: text(record["Uploaded Email"]),
          uploadedAt: text(record["Uploaded At"]),
          sheetName: text(record.__sheetName),
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
      const exportRows = records.map(record => BULK_EXPORT_HEADERS.map(header => record[header]));
      sendUploadMail(
        spreadsheet,
        {
          REGISTERED_EMAIL: text(first["Uploaded Email"]),
          RIDER_NAME: text(first["Uploaded By"]),
          USERNAME: text(first["Uploaded By"])
        },
        { zone: text(first.Zone), warehouse: text(first.Warehouse), lmHub: text(first["LM Hub"]) },
        parseIsoDate(parseDisplayDate(first["Banking Date"]), "Banking date"),
        records.length,
        { fileUrl: text(first["Banking Slip"]) },
        wanted,
        exportRows
      );
      return Utility.success("Banking confirmation email sent successfully.", { batchId: wanted });
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
      const required = info.getAuthorizationStatus() === ScriptApp.AuthorizationStatus.REQUIRED;
      return Utility.success(required ? "Email service authorization is required." : "Email service is authorized.", {
        required,
        authorizationUrl: required ? text(info.getAuthorizationUrl()) : "",
        deploymentOwnerEmail: text(Session.getEffectiveUser().getEmail()),
        authorizedScopes: info.getAuthorizedScopes() || []
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
  const remainingRecipients = MailApp.getRemainingDailyQuota();
  const hiddenSheets = Banking.hideTechnicalColumns();
  const result = {
    success: true,
    remainingRecipients,
    hiddenTechnicalColumnInSheets: hiddenSheets
  };
  console.log(JSON.stringify(result));
  return result;
}
