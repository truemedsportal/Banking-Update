/**
 * ============================================================
 * TRUE MEDS - RTO & REATTEMPT PORTAL
 * File      : Database.gs
 * Purpose   : Central Database Layer
 * Version   : 2.0.0
 * ============================================================
 */

const Database = (() => {

  const SS = SpreadsheetApp.getActiveSpreadsheet();

  const SHEETS = Object.freeze({

    USERS: "User Master",
    SUBMISSIONS: "Submissions",
    REASONS: "Reasons",
    NOTIFICATIONS: "Notification",
    AUDIT: "AuditLogs",
    CALLING: "Calling Sheet",
    CSR_AUDIT: "CSR Audit Logs",
    CONFIG: "Configuration",
    LINKS: "G-sheet/Drive Links"

  });

  const CACHE = {

    sheets: {},
    headers: {},
    columns: {},
    objects: {}

  };

  /**
   * ============================================================
   * CORE
   * ============================================================
   */

  function sheet(name) {

    if (!CACHE.sheets[name]) {

      const sh = SS.getSheetByName(name);

      if (!sh)
        throw new Error("Sheet not found : " + name);

      CACHE.sheets[name] = sh;

    }

    return CACHE.sheets[name];

  }

  function refresh(name) {

    delete CACHE.headers[name];
    delete CACHE.columns[name];
    delete CACHE.objects[name];

  }

  function headers(name) {

    if (!CACHE.headers[name]) {

      CACHE.headers[name] = sheet(name)
        .getRange(1, 1, 1, sheet(name).getLastColumn())
        .getValues()[0];

    }

    return CACHE.headers[name];

  }

  function columns(name) {

    if (!CACHE.columns[name]) {

      const map = {};

      headers(name).forEach((h, i) => {

        map[
          Utility.safeString(h)
            .toUpperCase()
            .replace(/[^A-Z0-9]+/g, "_")
        ] = i;

      });

      CACHE.columns[name] = map;

    }

    return CACHE.columns[name];

  }

  function columnKey(header) {

    return Utility.safeString(header)
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, "_");

  }

function objects(name) {

  if (!CACHE.objects[name]) {

    const sh = sheet(name);
    const lastRow = sh.getLastRow();

    if (lastRow < 2) {

      CACHE.objects[name] = [];

    } else {

      const range = sh.getRange(
        2,
        1,
        lastRow - 1,
        sh.getLastColumn()
      );

      const data = range.getValues();

      // Read RichText only once
      const richData =
        (name === SHEETS.SUBMISSIONS || name === SHEETS.CALLING)
          ? range.getRichTextValues()
          : null;

      const COL = columns(name);

      CACHE.objects[name] = data.map((row, index) => {

        const obj = {};

        Object.keys(COL).forEach(key => {

          let value = row[COL[key]];

          // Only for the Submissions sheet, replace proof text
          // with the actual hyperlink URL.
          if (
            richData &&
            (key === "MANDATORY_PROOF" ||
             key === "OPTIONAL_PROOF")
          ) {

            const rich =
              richData[index][COL[key]];

            if (rich) {

              const url = rich.getLinkUrl();

              if (url) {
                value = url;
              }

            }

          }

          obj[key] = value;

        });

        return {

          row: index + 2,

          data: obj

        };

      });

    }

  }

  return CACHE.objects[name];

}

  function find(name, field, value) {

    value = Utility.safeString(value).toLowerCase();

    return objects(name).find(r =>
      Utility.safeString(r.data[field]).toLowerCase() === value
    ) || null;

  }

  function findAll(name, field, value) {

    value = Utility.safeString(value).toLowerCase();

    return objects(name).filter(r =>
      Utility.safeString(r.data[field]).toLowerCase() === value
    );

  }

  function all(name) {

    return objects(name);

  }

  function insert(name, values) {

    const row = Array.isArray(values)
      ? values
      : headers(name).map(header => {

          const key = columnKey(header);
          const value = values[key];

          return value === undefined || value === null ? "" : value;

        });

    sheet(name).appendRow(row);

    refresh(name);

  }

  function updateRow(name, row, values) {

    sheet(name)
      .getRange(row, 1, 1, values.length)
      .setValues([values]);

    refresh(name);

  }

  function updateCell(name, row, columnName, value) {

    const col = columns(name)[columnName];

    if (col === undefined)
      throw new Error("Column not found : " + columnName);

    sheet(name)
      .getRange(row, col + 1)
      .setValue(value);

    refresh(name);

  }

  /** Update only supplied named fields and preserve all other sheet values. */
  function updateFields(name, row, fieldValues) {

    const COL = columns(name);
    const entries = Object.keys(fieldValues || {})
      .filter(key => COL[key] !== undefined);

    if (!entries.length) return;

    // A status update commonly changes several adjacent columns. Writing each
    // field separately creates one Sheets network call per value. Read the row
    // once, merge the requested fields in memory, and write it back once.
    const sh = sheet(name);
    const width = sh.getLastColumn();
    const values = sh.getRange(row, 1, 1, width).getValues()[0];

    entries.forEach(key => {
      values[COL[key]] = fieldValues[key];
    });

    sh.getRange(row, 1, 1, width).setValues([values]);

    refresh(name);

  }

  function remove(name, row) {

    sheet(name).deleteRow(row);

    refresh(name);

  }

  const core = {

    sheet,
    headers,
    columns,
    objects,
    all,
    find,
    findAll,
    insert,
    updateRow,
    updateCell,
    updateFields,
    remove,
    refresh

  };

  /**
   * ============================================================
   * USERS MODULE
   * ============================================================
   */
    const users = (() => {

    const NAME = SHEETS.USERS;

    function list() {

      return core.all(NAME);

    }

    function find(field, value) {

      return core.find(NAME, field, value);

    }

    function findAll(field, value) {

      return core.findAll(NAME, field, value);

    }

    function findByUsername(username) {

      return find(
        "USERNAME",
        username
      );

    }

    function findByEmployeeId(employeeId) {

      return find("EMPLOYEE_ID", employeeId);

    }

    function findBySession(sessionId) {

      return find("SESSION_ID", sessionId);

    }

    function insert(values) {

      core.insert(NAME, values);

    }

    function update(row, values) {

      core.updateRow(NAME, row, values);

    }

    function remove(row) {

      core.remove(NAME, row);

    }

    function updateCell(row, column, value) {

      core.updateCell(NAME, row, column, value);

    }

    function updateLastLogin(row) {

      updateCell(
        row,
        "LAST_LOGIN",
        Utility.formatDateTime()
      );

    }

    function saveSession(row, sessionId) {

      updateCell(
        row,
        "SESSION_ID",
        sessionId
      );

      updateLastLogin(row);

    }

    function clearSession(row) {

      updateCell(
        row,
        "SESSION_ID",
        ""
      );

    }

    function setFailedAttempts(row, attempts) {

      updateCell(
        row,
        "FAILED_ATTEMPTS",
        attempts
      );

    }

    function incrementFailedAttempts(user) {

      const attempts =
        Number(user.data.FAILED_ATTEMPTS || 0) + 1;

      setFailedAttempts(
        user.row,
        attempts
      );

      return attempts;

    }

    function resetFailedAttempts(row) {

      setFailedAttempts(
        row,
        0
      );

    }

    function lock(row) {

      updateCell(
        row,
        "LOCKED",
        "YES"
      );

    }

    function unlock(row) {

      updateCell(
        row,
        "LOCKED",
        "NO"
      );

      resetFailedAttempts(row);

    }

    function activate(row) {

      updateCell(
        row,
        "STATUS",
        STATUS.ACTIVE
      );

    }

    function deactivate(row) {

      updateCell(
        row,
        "STATUS",
        STATUS.INACTIVE
      );

    }

    function active() {

      return findAll(
        "STATUS",
        STATUS.ACTIVE
      );

    }

    function inactive() {

      return findAll(
        "STATUS",
        STATUS.INACTIVE
      );

    }

    function byRole(role) {

      return findAll(
        "ROLE",
        role
      );

    }

    function byWarehouse(warehouse) {

      return findAll(
        "WAREHOUSE",
        warehouse
      );

    }

    function byZone(zone) {

      return findAll(
        "ZONE",
        zone
      );

    }

    function byHub(hub) {

      return findAll(
        "LM_HUB",
        hub
      );

    }

    return {

      list,

      // Backward-compatible alias used by the attendance and roster modules.
      // Keep this while those modules are deployed so legacy calls do not fail.
      all: list,

      find,

      findAll,

      findByUsername,

      findByEmployeeId,

      findBySession,

      insert,

      update,

      remove,

      updateCell,

      updateLastLogin,

      saveSession,

      clearSession,

      setFailedAttempts,

      incrementFailedAttempts,

      resetFailedAttempts,

      lock,

      unlock,

      activate,

      deactivate,

      active,

      inactive,

      byRole,

      byWarehouse,

      byZone,

      byHub

    };

  })();

  /**
   * ============================================================
   * SUBMISSIONS MODULE
   * ============================================================
   */
    const submissions = (() => {

    const NAME = SHEETS.SUBMISSIONS;

    function list() {

      return core.all(NAME);

    }

    function find(field, value) {

      return core.find(NAME, field, value);

    }

    function findAll(field, value) {

      return core.findAll(NAME, field, value);

    }

    function findBySubmissionId(submissionId) {

      return find(
        "SUBMISSION_ID",
        submissionId
      );

    }

    function findByOrderNumber(orderNumber) {

      return findAll(
        "ORDER_NUMBER",
        orderNumber
      );

    }

    function findByUsername(username) {

      return findAll(
        "USERNAME",
        username
      ).sort((a, b) => {

        return b.row - a.row;

      });

    }

    function findByEmployeeId(employeeId) {

      return findAll(
        "EMPLOYEE_ID",
        employeeId
      );

    }

    function insert(values) {

  // Insert row using existing core logic
  core.insert(NAME, values);

  // Get sheet and newly inserted row
  const sh = sheet(NAME);
  const lastRow = sh.getLastRow();

  // Copy formatting & data validation from previous row
  if (lastRow > 2) {

    sh.getRange(lastRow - 1, 1, 1, sh.getLastColumn())
      .copyTo(
        sh.getRange(lastRow, 1, 1, sh.getLastColumn()),
        SpreadsheetApp.CopyPasteType.PASTE_FORMAT,
        false
      );

    sh.getRange(lastRow - 1, 1, 1, sh.getLastColumn())
      .copyTo(
        sh.getRange(lastRow, 1, 1, sh.getLastColumn()),
        SpreadsheetApp.CopyPasteType.PASTE_DATA_VALIDATION,
        false
      );
  }

  // Read headers
  const headerRow = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];

  const mandatoryCol = headerRow.indexOf("Mandatory Proof") + 1;
  const optionalCol  = headerRow.indexOf("Optional Proof") + 1;
  const statusCol    = headerRow.indexOf("Status") + 1;

  // Mandatory Proof hyperlink
  if (mandatoryCol > 0) {

    const cell = sh.getRange(lastRow, mandatoryCol);
    const link = cell.getValue();

    if (link) {

       cell.setRichTextValue(
       SpreadsheetApp
        .newRichTextValue()
        .setText("👁 View Mandatory Proof")
        .setLinkUrl(link)
        .build()
         );

    }

  }

  // Optional Proof hyperlink
  if (optionalCol > 0) {

    const cell = sh.getRange(lastRow, optionalCol);
    const link = cell.getValue();

    if (link) {

         cell.setRichTextValue(
         SpreadsheetApp
          .newRichTextValue()
          .setText("👁 View Optional Proof")
          .setLinkUrl(link)
          .build()
          );

    }

  }

  // Reapply status value so the dropdown chip is preserved
  if (statusCol > 0) {

    const statusCell = sh.getRange(lastRow, statusCol);
    const value = statusCell.getValue();

    statusCell.setValue(value);

  }

  SpreadsheetApp.flush();

}

    /**
     * Inserts a validated batch in one sheet write.  The caller holds a
     * Script Lock, so a bulk upload cannot interleave rows with another
     * submission request.
     */
    function insertMany(valuesList) {

      const entries = Array.isArray(valuesList) ? valuesList : [];

      if (!entries.length) return 0;

      const sh = sheet(NAME);
      const headerRow = headers(NAME);
      const startRow = sh.getLastRow() + 1;
      const values = entries.map(entry =>
        headerRow.map(header => {
          const value = entry[columnKey(header)];
          return value === undefined || value === null ? "" : value;
        })
      );

      sh.getRange(startRow, 1, values.length, headerRow.length)
        .setValues(values);

      // Match the established sheet formatting and validation chips.
      if (startRow > 2) {
        const source = sh.getRange(startRow - 1, 1, 1, sh.getLastColumn());
        const target = sh.getRange(startRow, 1, values.length, sh.getLastColumn());

        source.copyTo(
          target,
          SpreadsheetApp.CopyPasteType.PASTE_FORMAT,
          false
        );
        source.copyTo(
          target,
          SpreadsheetApp.CopyPasteType.PASTE_DATA_VALIDATION,
          false
        );
      }

      SpreadsheetApp.flush();
      refresh(NAME);

      return entries.length;

    }
    function update(row, values) {

      core.updateRow(
        NAME,
        row,
        values
      );

    }

    function remove(row) {

      core.remove(
        NAME,
        row
      );

    }

    function updateCell(row, column, value) {

      core.updateCell(
        NAME,
        row,
        column,
        value
      );

    }

      function review(row, reviewedBy, status, remarks) {

        updateCell(row, "STATUS", status);

        updateCell(row, "ASSIGNED_TO", reviewedBy);

        updateCell(row, "REVIEWED_BY", reviewedBy);

        updateCell(row, "REVIEWED_ON", Utility.formatDateTime());

        updateCell(row, "LAST_UPDATED", Utility.formatDateTime());

        updateCell(row, "MANAGER_REMARKS", remarks);

      }

    function assign(row, username) {

      updateCell(
        row,
        "ASSIGNED_TO",
        username
      );

      updateCell(
        row,
        "LAST_UPDATED",
        Utility.formatDateTime()
      );

    }

    function byStatus(status) {

      return findAll(
        "STATUS",
        status
      );

    }

    function byAssignee(username) {

      return findAll(
        "ASSIGNED_TO",
        username
      );

    }

function pending() {

      return list().filter(item => {

        const status = Utility.safeString(item.data.STATUS).toUpperCase();

        return status === Utility.safeString(SUBMISSION_STATUS.SUBMITTED).toUpperCase();

      });

    }

    function byScope(user) {

      if (!user) return list();

      const scope = Utility.safeString(user.ACCESS_SCOPE).toUpperCase();

      const records = list();

      if (scope === "PAN INDIA") {
        return records;
      }

      if (scope === "ZONE") {
        return records.filter(r =>
          Utility.safeString(r.data.ZONE).toUpperCase() ===
          Utility.safeString(user.ZONE).toUpperCase()
        );
      }

      if (scope === "WAREHOUSE") {
        return records.filter(r =>
          Utility.safeString(r.data.WAREHOUSE).toUpperCase() ===
          Utility.safeString(user.WAREHOUSE).toUpperCase()
        );
      }

      if (scope === "LM HUB" || scope === "LM_HUB" || scope === "HUB") {
        return records.filter(r =>
          Utility.safeString(r.data.LM_HUB).toUpperCase() ===
          Utility.safeString(user.LM_HUB).toUpperCase()
        );
      }

      return [];

    }

    function pendingByScope(user) {

      return byScope(user).filter(item => {

        const status = Utility.safeString(item.data.STATUS).toUpperCase();

        return status === Utility.safeString(SUBMISSION_STATUS.SUBMITTED).toUpperCase();

      });

    }

    function approved() {

      return byStatus(
        SUBMISSION_STATUS.APPROVED
      );

    }

    function rejected() {

      return byStatus(
        SUBMISSION_STATUS.REJECTED
      );

    }

    function count() {

      return list().length;

    }

    function countByStatus(status) {

      return byStatus(status).length;

    }

return {

      list,

      find,

      findAll,

      findBySubmissionId,

      findByOrderNumber,

      findByUsername,

      findByEmployeeId,

      insert,

      insertMany,

      update,

      remove,

      updateCell,

      assign,

      review,

      byStatus,

      byAssignee,

      pending,

      byScope,

      pendingByScope,

      approved,

      rejected,

      count,

      countByStatus

    };

  })();

      /**
       * ============================================================
       * REASONS MODULE
       * ============================================================
       */

      const reasons = (() => {

        const NAME = SHEETS.REASONS;

        function list() {

          return core.all(NAME);

        }

        function active() {

          return core.findAll(
            NAME,
            "STATUS",
            STATUS.ACTIVE
          );

        }

        function byRole(role) {

          const column =
            Utility.safeString(role)
              .toUpperCase()
              .replace(/\s+/g, "_");

          return list().filter(item =>

            Utility.safeString(item.data.STATUS)
              .toUpperCase() ===
            STATUS.ACTIVE.toUpperCase()

            &&

            Utility.safeString(item.data[column])
              .toUpperCase() === "YES"

          );

        }

        /** Reasons visible in CSR calling forms: CSR = Yes and Status = Active. */
        function csrActive() {

          return list().filter(item =>
            Utility.safeString(item.data.STATUS).toUpperCase() === STATUS.ACTIVE.toUpperCase() &&
            ["YES", "TRUE"].indexOf(
              Utility.safeString(item.data.CSR).toUpperCase()
            ) !== -1
          );

        }

        /**
         * ============================================================
         * FIND BY REASON
         * ============================================================
         */

        function findByReason(reason) {

          return list().find(item =>

            Utility.safeString(item.data.REASON)
              .toLowerCase() ===

            Utility.safeString(reason)
              .toLowerCase()

          ) || null;

        }

        function insert(values) {

          core.insert(NAME, values);

        }

        function update(row, values) {

          core.updateRow(NAME, row, values);

        }

        function remove(row) {

          core.remove(NAME, row);

        }

        return {

          list,

          active,

          byRole,

          csrActive,

          findByReason,

          insert,

          update,

          remove

        };

      })();

  /**
   * ============================================================
   * NOTIFICATIONS MODULE
   * ============================================================
   */

  const notifications = (() => {

    const NAME = SHEETS.NOTIFICATIONS;

    function list() {

      return core.all(NAME);

    }

    function find(field, value) {

      return core.find(NAME, field, value);

    }

    function findAll(field, value) {

      return core.findAll(NAME, field, value);

    }

    function insert(values) {

      core.insert(NAME, values);

    }

    function update(row, values) {

      core.updateRow(NAME, row, values);

    }

    function remove(row) {

      core.remove(NAME, row);

    }

    function unread(username) {

      return list().filter(item =>
        Utility.safeString(item.data.USERNAME).toLowerCase() === Utility.safeString(username).toLowerCase() &&
        Utility.safeString(item.data.READ_STATUS).toUpperCase() !== "YES"
      );

    }

    function markRead(row) {

      core.updateCell(
        NAME,
        row,
        "READ_STATUS",
        "YES"
      );

      core.updateCell(
        NAME,
        row,
        "READ_ON",
        Utility.formatDateTime()
      );

    }

    return {

      list,

      find,

      findAll,

      insert,

      update,

      remove,

      unread,

      markRead

    };

  })();

  /**
   * ============================================================
   * AUDIT MODULE
   * ============================================================
   */

  const audit = (() => {

    const NAME = SHEETS.AUDIT;

    /**
     * AuditLogs now has an Order Number column.  Resolve it centrally so every
     * future audit event is searchable without duplicating this logic in each
     * submission action.
     */
    function withOrderNumber(values) {

      if (Array.isArray(values)) return values;

      const entry = Object.assign({}, values || {});

      if (Utility.safeString(entry.ORDER_NUMBER))
        return entry;

      const submissionId = Utility.safeString(entry.SUBMISSION_ID);

      if (!submissionId)
        return entry;

      const submission = submissions.findBySubmissionId(submissionId);

      entry.ORDER_NUMBER = submission
        ? Utility.safeString(submission.data.ORDER_NUMBER)
        : "";

      return entry;

    }

    function list() {

      return core.all(NAME);

    }

    function insert(values) {

      core.insert(NAME, withOrderNumber(values));

    }

    function insertMany(valuesList) {

      const entries = (Array.isArray(valuesList) ? valuesList : [])
        .map(withOrderNumber);

      if (!entries.length) return 0;

      const sh = sheet(NAME);
      const headerRow = headers(NAME);
      const startRow = sh.getLastRow() + 1;
      const values = entries.map(entry =>
        headerRow.map(header => {
          const value = entry[columnKey(header)];
          return value === undefined || value === null ? "" : value;
        })
      );

      sh.getRange(startRow, 1, values.length, headerRow.length)
        .setValues(values);

      SpreadsheetApp.flush();
      refresh(NAME);

      return entries.length;

    }

    return {

      list,

      insert,

      insertMany

    };

  })();

  /**
   * CSR calling tickets. Header names are the contract, so column positions
   * can remain exactly as the Calling Sheet designed by operations.
   */
  const calling = (() => {

    const NAME = SHEETS.CALLING;

    function list() { return core.all(NAME); }

    function findByTicketId(ticketId) {
      return core.find(NAME, "CSR_TICKET_ID", ticketId);
    }

    function findBySubmissionId(submissionId) {
      return core.find(NAME, "SUBMISSION_ID", submissionId);
    }

    function insert(values) { core.insert(NAME, values); }

    function updateFields(row, values) { core.updateFields(NAME, row, values); }

    return { list, findByTicketId, findBySubmissionId, insert, updateFields };

  })();

  /** Independent audit trail for every CSR workflow transition. */
  const csrAudit = (() => {

    const NAME = SHEETS.CSR_AUDIT;

    function list() { return core.all(NAME); }

    function insert(values) { core.insert(NAME, values); }

    return { list, insert };

  })();

  /**
   * ============================================================
   * CONFIG MODULE
   * ============================================================
   */

  const config = (() => {

    const NAME = SHEETS.CONFIG;

    function get(setting) {

      const result = core.find(
        NAME,
        "SETTING_NAME",
        setting
      );

      return result ? result.data.VALUE : "";

    }

    function list() {

      return core.all(NAME);

    }

    return {

      get,

      list

    };

  })();

  /**
 * ============================================================
 * LINKS MODULE
 * ============================================================
 */

const links = (() => {

  const NAME = SHEETS.LINKS;

  const CACHE_PREFIX = "DRIVE_LINK_";

  /**
   * ------------------------------------------------------------
   * LIST
   * ------------------------------------------------------------
   */

  function list() {

    return core.all(NAME);

  }

  /**
   * ------------------------------------------------------------
   * GET
   * ------------------------------------------------------------
   */

  function get(sheetDriveName) {

    const result = core.find(
      NAME,
      "SHEET_DRIVE_NAME",
      sheetDriveName
    );

    return result
      ? result.data
      : null;

  }

  /**
   * ------------------------------------------------------------
   * GET ACTIVE
   * Reads only ACTIVE rows
   * Uses CacheService
   * ------------------------------------------------------------
   */

function getActive(sheetDriveName, purpose) {

  const record = list().find(item => {

    return (

      Utility.safeString(item.data.SHEET_DRIVE_NAME).toUpperCase() ===
      Utility.safeString(sheetDriveName).toUpperCase()

      &&

      Utility.safeString(item.data.PURPOSE).toUpperCase() ===
      Utility.safeString(purpose).toUpperCase()

      &&

      Utility.safeString(item.data.STATUS).toUpperCase() ===
      Utility.safeString(STATUS.ACTIVE).toUpperCase()

    );

  });

  Logger.log("Record Found : " + JSON.stringify(record));

  if (!record)
    return null;

  return record.data;

}

  /**
   * ------------------------------------------------------------
   * CLEAR CACHE
   * ------------------------------------------------------------
   */

  function clearCache(sheetDriveName, purpose) {

    const cacheKey =
      CACHE_PREFIX +
      Utility.safeString(sheetDriveName)
        .toUpperCase()
        .replace(/\s+/g, "_") +
      "_" +
      Utility.safeString(purpose)
        .toUpperCase();

    CacheService
      .getScriptCache()
      .remove(cacheKey);

  }

  return {

    list,

    get,

    getActive,

    clearCache

  };

})();

  /**
   * ============================================================
   * PUBLIC API
   * ============================================================
   */

  return {

    core,

    users,

    submissions,

    reasons,

    notifications,

    audit,

    calling,

    csrAudit,

    config,

    links

  };

})();
function clearDriveLinkCache() {

  CacheService
    .getScriptCache()
    .removeAll([
      "DRIVE_LINK_MANDATORY_PROOFS_LIVE",
      "DRIVE_LINK_OPTIONAL_PROOFS_LIVE",
      "DRIVE_LINK_SUBMISSIONS_LIVE"
    ]);

}
