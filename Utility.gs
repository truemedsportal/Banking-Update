/**
 * ============================================================
 * TRUE MEDS - RTO & REATTEMPT PORTAL
 * File      : Utility.gs
 * Purpose   : Common Utility Functions
 * Version   : 2.0
 * ============================================================
 */

const Utility = (() => {

  /**
   * ------------------------------------------------------------
   * SAFE STRING
   * ------------------------------------------------------------
   */

  function safeString(value) {

    return value === null || value === undefined
      ? ""
      : String(value).trim();

  }

  /**
   * ------------------------------------------------------------
   * SUCCESS RESPONSE
   * ------------------------------------------------------------
   */

  function success(message, data) {

    return {

      success: true,

      message: message || "Success.",

      data: data === undefined
        ? null
        : data

    };

  }

  /**
   * ------------------------------------------------------------
   * ERROR RESPONSE
   * ------------------------------------------------------------
   */

  function error(message, data) {

    return {

      success: false,

      message: message || ERROR.UNKNOWN,

      data: data === undefined
        ? null
        : data

    };

  }

  /**
   * ------------------------------------------------------------
   * UUID
   * ------------------------------------------------------------
   */

  function uuid() {

    return Utilities.getUuid();

  }

  /**
   * ------------------------------------------------------------
   * UNIVERSAL DATE & TIME
   * Format : DD/MM/YYYY HH:MM:SS
   * ------------------------------------------------------------
   */

  function formatDateTime(date) {

    const value =
      date instanceof Date
        ? date
        : new Date();

    return Utilities.formatDate(

      value,

      Session.getScriptTimeZone(),

      "dd/MM/yyyy HH:mm:ss"

    );

  }

  /**
   * ------------------------------------------------------------
   * DATE ONLY
   * Format : DD/MM/YYYY
   * ------------------------------------------------------------
   */

  function formatDate(date) {

    const value =
      date instanceof Date
        ? date
        : new Date();

    return Utilities.formatDate(

      value,

      Session.getScriptTimeZone(),

      "dd/MM/yyyy"

    );

  }

  /**
   * ------------------------------------------------------------
   * TIME ONLY
   * Format : HH:MM:SS
   * ------------------------------------------------------------
   */

  function formatTime(date) {

    const value =
      date instanceof Date
        ? date
        : new Date();

    return Utilities.formatDate(

      value,

      Session.getScriptTimeZone(),

      "HH:mm:ss"

    );

  }

  /**
   * Parses both a native Sheet date and the portal's DD/MM/YYYY HH:mm:ss text.
   * Native Date parsing is locale-dependent, so do not use new Date(text) for
   * values stored by formatDateTime().
   */
  function parseDateTime(value) {

    if (value instanceof Date)
      return new Date(value.getTime());

    const text = safeString(value);
    let match;
    let year;
    let month;
    let day;
    let hour = 0;
    let minute = 0;
    let second = 0;

    // HTML date inputs use YYYY-MM-DD; the portal stores DD/MM/YYYY HH:mm:ss.
    // Parse both explicitly so the result is independent of browser/server
    // locale (which was the source of incorrect, very large review times).
    if ((match = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/))) {
      year = Number(match[1]);
      month = Number(match[2]);
      day = Number(match[3]);
      hour = Number(match[4] || 0);
      minute = Number(match[5] || 0);
      second = Number(match[6] || 0);
    } else if ((match = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/))) {
      day = Number(match[1]);
      month = Number(match[2]);
      year = Number(match[3]);
      hour = Number(match[4] || 0);
      minute = Number(match[5] || 0);
      second = Number(match[6] || 0);
    } else {
      return null;
    }

    const parsed = new Date(year, month - 1, day, hour, minute, second);

    return parsed.getFullYear() === year &&
      parsed.getMonth() === month - 1 &&
      parsed.getDate() === day &&
      parsed.getHours() === hour &&
      parsed.getMinutes() === minute &&
      parsed.getSeconds() === second
      ? parsed
      : null;

  }

  /** Formats elapsed milliseconds for operational review-time reporting. */
  function formatElapsedMilliseconds(milliseconds) {

    let minutes = Math.max(0, Math.floor(Number(milliseconds) / 60000));

    if (!isFinite(minutes))
      return "";

    const units = [
      { size: 525600, singular: "Year", plural: "Years" },
      { size: 43200, singular: "Month", plural: "Months" },
      { size: 10080, singular: "Week", plural: "Weeks" },
      { size: 1440, singular: "Day", plural: "Days" },
      { size: 60, singular: "Hour", plural: "Hours" },
      { size: 1, singular: "Minute", plural: "Minutes" }
    ];

    const parts = [];

    units.forEach(unit => {
      const amount = Math.floor(minutes / unit.size);
      minutes %= unit.size;

      if (amount)
        parts.push(amount + " " + (amount === 1 ? unit.singular : unit.plural));
    });

    return parts.length ? parts.join(" ") : "0 Minutes";

  }

  /**
   * ------------------------------------------------------------
   * SUBMISSION ID
   * ------------------------------------------------------------
   */

  /**
   * Returns the local operational date used in readable daily IDs.
   * Example: 10-08-2026
   */
  function dailyIdDate_() {

    return Utilities.formatDate(
      new Date(),
      Session.getScriptTimeZone() || "Asia/Kolkata",
      "dd-MM-yyyy"
    );

  }

  /**
   * Converts a zero-based counter to letters: 0 = AAA, 1 = AAB, 25 = AAZ.
   */
  function sequenceToLetters_(value) {

    let number = Math.max(0, Math.floor(Number(value) || 0));
    let letters = "";

    do {
      letters = String.fromCharCode(65 + (number % 26)) + letters;
      number = Math.floor(number / 26);
    } while (number > 0);

    while (letters.length < 3)
      letters = "A" + letters;

    return letters;

  }

  /** Converts an alphabetic daily-ID suffix back to its zero-based counter. */
  function lettersToSequence_(value) {

    const letters = safeString(value).toUpperCase().replace(/[^A-Z]/g, "");

    if (!letters)
      return -1;

    let sequence = 0;

    for (let index = 0; index < letters.length; index++)
      sequence = (sequence * 26) + (letters.charCodeAt(index) - 65);

    return sequence;

  }

  /**
   * Finds the next sequence from existing records. This lets the portal
   * continue safely from IDs already written before the counter property
   * existed (for example, existing SUB_10-08-2026_AAA rows).
   */
  function nextSequenceFromSheet_(prefix, datePart, sheetName, headerNames) {

    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);

    if (!sheet || sheet.getLastRow() < 2)
      return 0;

    const width = sheet.getLastColumn();
    const headers = sheet.getRange(1, 1, 1, width).getDisplayValues()[0]
      .map(value => safeString(value).toUpperCase());

    const candidates = headerNames.map(name => safeString(name).toUpperCase());
    const idColumn = headers.findIndex(header => candidates.indexOf(header) !== -1);

    if (idColumn < 0)
      return 0;

    const values = sheet.getRange(2, idColumn + 1, sheet.getLastRow() - 1, 1)
      .getDisplayValues();
    const expression = new RegExp(
      "^" + prefix + "_" + datePart.replace(/-/g, "\\-") + "_([A-Z]+)$",
      "i"
    );
    let nextSequence = 0;

    values.forEach(row => {
      const match = safeString(row[0]).match(expression);

      if (!match)
        return;

      nextSequence = Math.max(nextSequence, lettersToSequence_(match[1]) + 1);
    });

    return nextSequence;

  }

  /**
   * Creates a unique, daily-readable ID. The script lock and Script Properties
   * counter ensure that two submissions created at the same time cannot get
   * the same suffix.
   */
  function generateDailySequentialId_(prefix, sheetName, headerNames) {

    const datePart = dailyIdDate_();
    const propertyKey = "DAILY_ID_SEQUENCE_" + prefix + "_" + datePart;
    const lock = LockService.getScriptLock();

    lock.waitLock(30000);

    try {
      const properties = PropertiesService.getScriptProperties();
      const storedValue = properties.getProperty(propertyKey);
      let storedSequence = Number(storedValue);

      if (storedValue === null || !isFinite(storedSequence) || storedSequence < 0)
        storedSequence = 0;

      /*
       * Never rely only on Script Properties. A previous deployment, a manual
       * sheet edit, or an interrupted request can leave that counter behind the
       * IDs already stored in the sheet. Use the greater value so that an ID is
       * never repeated. The ScriptLock protects two simultaneous requests.
       */
      const sheetSequence = nextSequenceFromSheet_(prefix, datePart, sheetName, headerNames);
      const sequence = Math.max(Math.floor(storedSequence), sheetSequence);
      properties.setProperty(propertyKey, String(sequence + 1));

      return prefix + "_" + datePart + "_" + sequenceToLetters_(sequence);

    } finally {
      lock.releaseLock();
    }

  }

  function generateSubmissionId() {

    return generateDailySequentialId_(
      "SUB",
      "Submissions",
      ["Submission ID", "SUBMISSION_ID"]
    );

  }

  /**
   * ------------------------------------------------------------
   * NOTIFICATION ID
   * ------------------------------------------------------------
   */

  function generateNotificationId() {

    return "NOT-" +

      Utilities.formatDate(

        new Date(),

        Session.getScriptTimeZone(),

        "yyyyMMddHHmmss"

      )

      +

      "-"

      +

      uuid()
        .slice(0, 8)
        .toUpperCase();

  }

  /** Creates the next unique CSR_DD-MM-YYYY_AAA ticket ID. */
  function generateCsrTicketId() {

    return generateDailySequentialId_(
      "CSR",
      "Calling Sheet",
      ["CSR Ticket ID", "CSR_TICKET_ID", "Ticket ID"]
    );

  }

  return {

    safeString,

    success,

    error,

    uuid,

    formatDate,

    formatTime,

    parseDateTime,

    formatElapsedMilliseconds,

    formatDateTime,

    generateSubmissionId,

    generateNotificationId,

    generateCsrTicketId

  };

})();

