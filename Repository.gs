/**
 * Repository search across active archive spreadsheets.
 */
const Repository = (() => {

  const SUBMISSIONS_SHEET = "Submissions";

  function repositories() {
    return Database.links.list().filter(item => {

      const purpose = Utility.safeString(item.data.PURPOSE).toUpperCase();
      const url = Utility.safeString(item.data.URL).toLowerCase();

      // Repository search is intentionally combined: the active/live
      // Submissions workbook plus every archived Repository workbook.
      // Drive proof folders are excluded before any spreadsheet is opened.
      return Utility.safeString(item.data.STATUS).toUpperCase() ===
          STATUS.ACTIVE.toUpperCase() &&
        ["LIVE", "REPOSITORY"].indexOf(purpose) !== -1 &&
        url.indexOf("docs.google.com/spreadsheets/") !== -1;

    });
  }

  function openRepository(url) {
    try {
      return url ? SpreadsheetApp.openByUrl(url) : null;
    } catch (error) {
      return null;
    }
  }

  function normalise(value, mode) {
    const text = Utility.safeString(value);

    if (mode === "username" || mode === "insensitive") return text.toLowerCase();
    if (mode === "upper") return text.toUpperCase();
    return text;
  }

  function dateKey(value) {

    if (!value) return "";

    if (value instanceof Date && !isNaN(value.getTime())) {
      return Utilities.formatDate(
        value,
        Session.getScriptTimeZone(),
        "yyyy-MM-dd"
      );
    }

    const parsed = Utility.parseDateTime(value);

    if (parsed && !isNaN(parsed.getTime())) {
      return Utilities.formatDate(
        parsed,
        Session.getScriptTimeZone(),
        "yyyy-MM-dd"
      );
    }

    const text = Utility.safeString(value);

    return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : "";

  }

  function applyDateRange(records, dateRange, timestampField) {

    const range = dateRange || {};
    const start = Utility.safeString(range.start);
    const end = Utility.safeString(range.end);

    if (!start && !end) return records;

    return records.filter(record => {
      const value = record[timestampField || "Timestamp"];
      const key = dateKey(value);

      if (!key) return false;
      if (start && key < start) return false;
      if (end && key > end) return false;

      return true;
    });

  }

  function search(columnName, searchValue, mode, dateRange) {
    const expected = new Set(
      Utility.safeString(searchValue)
        .split(",")
        .map(value => normalise(value, mode))
        .filter(Boolean)
    );

    if (!expected.size) return [];

    const results = [];

    repositories().forEach(repository => {
      const spreadsheet = openRepository(repository.data.URL);
      const sheet = spreadsheet && spreadsheet.getSheetByName(SUBMISSIONS_SHEET);

      if (!sheet || sheet.getLastRow() < 2) return;

      const values = sheet.getDataRange().getValues();
      const headers = values.shift();
      const columnIndex = headers.indexOf(columnName);

      if (columnIndex < 0) return;

      values.forEach(row => {
        if (!expected.has(normalise(row[columnIndex], mode))) return;

        const record = {};
        headers.forEach((header, index) => { record[header] = row[index]; });
        record.Repository = repository.data.SHEET_DRIVE_NAME;
        results.push(record);
      });
    });

    return applyDateRange(results, dateRange, "Timestamp");
  }

  function searchOrder(orderNumber, dateRange) {
    return search("Order Number", orderNumber, "upper", dateRange);
  }

  function searchSubmission(submissionId, dateRange) {
    return search("Submission ID", submissionId, "upper", dateRange);
  }

  function searchUsername(username, dateRange) {
    return search("Username", username, "username", dateRange);
  }

  function searchEmployee(employeeId, dateRange) {
    return search("Employee ID", employeeId, "exact", dateRange);
  }

  function searchZone(zone, dateRange) {
    return search("Zone", zone, "insensitive", dateRange);
  }

  function searchWarehouse(warehouse, dateRange) {
    return search("Warehouse", warehouse, "insensitive", dateRange);
  }

  function searchHub(lmHub, dateRange) {
    return search("LM Hub", lmHub, "insensitive", dateRange);
  }

  /**
   * Audit history belongs to the live portal database.  Older audit rows that
   * predate the Order Number column are joined to their live submission by ID.
   */
  function searchOrderHistory(orderNumber, dateRange) {

    const expected = new Set(
      Utility.safeString(orderNumber)
        .split(",")
        .map(value => normalise(value, "upper"))
        .filter(Boolean)
    );

    if (!expected.size) return [];

    const submissionsById = {};

    Database.submissions.list().forEach(submission => {
      submissionsById[normalise(submission.data.SUBMISSION_ID, "upper")] =
        Utility.safeString(submission.data.ORDER_NUMBER);
    });

    const results = Database.audit.list().map(audit => {

      const submissionId = Utility.safeString(audit.data.SUBMISSION_ID);
      const resolvedOrderNumber = Utility.safeString(audit.data.ORDER_NUMBER) ||
        submissionsById[normalise(submissionId, "upper")] || "";

      return {
        timestamp: audit.data.TIMESTAMP,
        submissionId: submissionId,
        orderNumber: resolvedOrderNumber,
        action: audit.data.ACTION,
        module: audit.data.MODULE,
        oldStatus: audit.data.OLD_STATUS,
        newStatus: audit.data.NEW_STATUS,
        performedBy: audit.data.PERFORMED_BY,
        role: audit.data.ROLE,
        remarks: audit.data.REMARKS
      };

    }).filter(audit =>
      expected.has(normalise(audit.orderNumber, "upper"))
    );

    return applyDateRange(results, dateRange, "timestamp").sort((left, right) => {
      const leftTime = Utility.parseDateTime(left.timestamp);
      const rightTime = Utility.parseDateTime(right.timestamp);
      return (rightTime ? rightTime.getTime() : 0) -
        (leftTime ? leftTime.getTime() : 0);
    });

  }

  function statistics() {
    return {
      repositories: repositories().length,
      enabledSearch: Utility.safeString(Config.get("REPOSITORY_SEARCH")).toUpperCase() === "YES"
    };
  }

  return {
    repositories,
    searchOrder,
    searchSubmission,
    searchUsername,
    searchEmployee,
    searchZone,
    searchWarehouse,
    searchHub,
    searchOrderHistory,
    statistics
  };
})();

