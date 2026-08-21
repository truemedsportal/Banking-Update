/**
 * ============================================================
 * OWN FLEET DELIVERY EXCEPTION PORTAL
 * File    : Calling.gs
 * Purpose : CSR / NDR calling-ticket workflow
 * ============================================================
 *
 * A ticket is created automatically only when an RTO reviewer approves a
 * submission with the configured CSR push remark. Calling Sheet remains the
 * operational source of truth; CSR Audit Logs is append-only.
 */

const Calling = (() => {

  const LOCK_PREFIX = "csr.review-lock.";
  const CALLING_SHEET = "Calling Sheet";
  const CSR_AUDIT_SHEET = "CSR Audit Logs";

  /*
   * These are the immutable sheet contracts used by the CSR workflow. Keeping
   * the check here means a missing/renamed header produces an actionable
   * message instead of silently writing an unusable ticket.
   */
  const REQUIRED_CALLING_COLUMNS = [
    "CSR_TICKET_ID", "SUBMISSION_ID", "ORDER_NUMBER", "RIDER_NAME",
    "EMPLOYEE_ID", "ZONE", "WAREHOUSE", "LM_HUB", "REASON",
    "MANDATORY_PROOF_LINK", "OPTIONAL_PROOF_LINK",
    "FIRST_ATTEMPT_DELIVERY_DATE_TIME", "LAST_ATTEMPT_DELIVERY_DATE_TIME",
    "PRIOR_SUBMISSION_COUNT", "NDR_PUSHED_BY", "NDR_PUSHED_BY_ROLE",
    "NDR_PUSHED_DATE_TIME", "RTO_REVIEWED_BY", "RTO_APPROVED_ON",
    "RTO_MANAGER_REMARKS", "CSR_TICKET_CREATED_AT",
    "CSR_TICKET_CREATED_BY", "CALLING_FINAL_STATUS", "CURRENT_STATUS",
    "CURRENT_ASSIGNED_AGENT", "LAST_CSR_ACTIVITY_AT",
    "CSR_REVIEW_OPENED_BY", "CSR_REVIEW_OPENED_AT",
    "CSR_REVIEW_LOCK_EXPIRES_AT", "CSR_ASSIGNMENT_COMPLETED_AT",
    "CSR_ASSIGNMENT_REVIEW_TIME", "ASSIGNED_BY_1",
    "CALL_1_ASSIGNED_DATE_TIME", "CALLING_AGENT_1_NAME",
    "CALL_1_REVIEW_OPENED_AT", "CALLING_1_REMARK",
    "CALLING_1_COMPLETED_DATE_TIME", "CALL_1_ASSIGNMENT_TO_COMPLETION_TIME",
    "ASSIGNED_BY_2", "CALL_2_ASSIGNED_DATE_TIME", "CALLING_AGENT_2_NAME",
    "CALL_2_REVIEW_OPENED_AT", "CALLING_2_REMARK",
    "CALLING_2_COMPLETED_DATE_TIME", "CALL_2_ASSIGNMENT_TO_COMPLETION_TIME",
    "ASSIGNED_BY_3", "CALL_3_ASSIGNED_DATE_TIME", "CALLING_AGENT_3_NAME",
    "CALL_3_REVIEW_OPENED_AT", "CALLING_3_REMARK",
    "CALLING_3_COMPLETED_DATE_TIME", "CALL_3_ASSIGNMENT_TO_COMPLETION_TIME",
    "FINAL_OUTCOME", "CSR_CLOSED_AT", "TOTAL_TIME_TAKEN_FOR_REVIEW"
  ];

  const REQUIRED_CSR_AUDIT_COLUMNS = [
    "TIMESTAMP", "CSR_TICKET_ID", "SUBMISSION_ID", "ORDER_NUMBER",
    "ACTION", "OLD_VALUE", "NEW_VALUE", "ASSIGNED_AGENT",
    "PERFORMED_BY", "ROLE", "REMARKS"
  ];

  function text(value) {
    return Utility.safeString(value);
  }

  function normalise(value) {
    return text(value).toUpperCase().replace(/\s+/g, "_");
  }

  /**
   * API authentication returns a plain user object, while Database methods
   * return { row, data } records. Workflow permissions must support both.
   */
  function userData(user) {
    return user && user.data ? user.data : (user || {});
  }

  function yes(value) {
    return ["YES", "TRUE", "1"].indexOf(text(value).toUpperCase()) !== -1;
  }

  function setting(name) {
    const value = text(Config.get(name));
    if (!value)
      throw new Error("Configuration setting '" + name + "' is required.");
    return value;
  }

  function reviewLockMinutes() {
    const value = Number(setting("CSR_REVIEW_LOCK_MINUTES"));
    if (!isFinite(value) || value < 1)
      throw new Error("CSR_REVIEW_LOCK_MINUTES must be a positive number.");
    return value;
  }

  function callerRole() {
    return normalise(setting("CSR_CALLING_AGENT_ROLE"));
  }

  function csrScope() {
    return normalise(setting("CSR_ACCESS_SCOPE"));
  }

  function closingOutcomes() {
    return setting("CSR_CLOSE_OUTCOMES")
      .split(",")
      .map(item => text(item))
      .filter(Boolean);
  }

  function configuredPushRemark() {
    return text(setting("CSR_PUSH_REMARK"));
  }

  function same(left, right) {
    return text(left).toLowerCase() === text(right).toLowerCase();
  }

  /**
   * Normalise only for workflow matching. The original manager remark remains
   * untouched in Sheets/audit logs, while harmless case, spacing and punctuation
   * differences cannot prevent a required CSR ticket from being created.
   */
  function normaliseRemark(value) {
    return text(value).toLowerCase().replace(/[^a-z0-9]+/g, "");
  }

  function isCsrPushRemark(remark) {
    const requested = normaliseRemark(remark);
    const configured = normaliseRemark(configuredPushRemark());

    return !!requested && !!configured && requested === configured;
  }

  /** Recognise a manually typed NDR-push phrase so it can be rejected. */
  function isCsrPushAttempt(remark) {
    const requested = normaliseRemark(remark);

    if (!requested) return false;

    return requested === normaliseRemark(configuredPushRemark()) ||
      (requested.indexOf("push") !== -1 &&
       requested.indexOf("ndr") !== -1 &&
       requested.indexOf("call") !== -1);
  }

  function displayName(user) {
    const data = userData(user);
    return text(data.RIDER_NAME) || text(data.USERNAME);
  }

  function isCsrUser(user) {
    return !!user && normalise(userData(user).ACCESS_SCOPE) === csrScope();
  }

  function isCsrAdmin(user) {
    const role = normalise(userData(user).ROLE);
    return isCsrUser(user) && (role === "ADMIN" || role === "SUPER_ADMIN");
  }

  function isCallingAgent(user) {
    return isCsrUser(user) &&
      normalise(userData(user).ROLE) === callerRole();
  }

  function lockKey(ticketId) {
    return LOCK_PREFIX + encodeURIComponent(text(ticketId));
  }

  function getLock(ticketId) {
    const properties = PropertiesService.getScriptProperties();
    const raw = properties.getProperty(lockKey(ticketId));
    if (!raw) return null;

    try {
      const parsed = JSON.parse(raw);
      if (!text(parsed.username) || !Number(parsed.expiresAt)) {
        properties.deleteProperty(lockKey(ticketId));
        return null;
      }
      return { username: text(parsed.username), expiresAt: Number(parsed.expiresAt) };
    } catch (error) {
      properties.deleteProperty(lockKey(ticketId));
      return null;
    }
  }

  function saveLock(ticketId, username) {
    const expiresAt = Date.now() + reviewLockMinutes() * 60 * 1000;
    PropertiesService.getScriptProperties().setProperty(
      lockKey(ticketId),
      JSON.stringify({ username: text(username), expiresAt })
    );
    return expiresAt;
  }

  function clearLock(ticketId) {
    PropertiesService.getScriptProperties().deleteProperty(lockKey(ticketId));
  }

  function formatDuration(milliseconds) {
    const totalSeconds = Math.max(0, Math.floor(Number(milliseconds || 0) / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return [hours, minutes, seconds]
      .map(value => String(value).padStart(2, "0"))
      .join(":");
  }

  function durationSeconds(value) {
    const match = text(value).match(/^(\d+):(\d{2}):(\d{2})$/);
    if (!match) return 0;
    return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
  }

  function averageDuration(records, field) {
    const seconds = (records || [])
      .map(record => durationSeconds(record.data[field]))
      .filter(value => value > 0);
    if (!seconds.length) return "-";
    return formatDuration((seconds.reduce((sum, value) => sum + value, 0) / seconds.length) * 1000);
  }

  function durationBetween(startValue, endValue) {
    const start = Utility.parseDateTime(startValue);
    const end = endValue instanceof Date ? endValue : Utility.parseDateTime(endValue);
    if (!start || !end) return "";
    return formatDuration(end.getTime() - start.getTime());
  }

  function audit(ticket, action, oldValue, newValue, assignedAgent, actor, remarks) {
    Database.csrAudit.insert({
      TIMESTAMP: Utility.formatDateTime(),
      CSR_TICKET_ID: text(ticket && ticket.data && ticket.data.CSR_TICKET_ID),
      SUBMISSION_ID: text(ticket && ticket.data && ticket.data.SUBMISSION_ID),
      ORDER_NUMBER: text(ticket && ticket.data && ticket.data.ORDER_NUMBER),
      ACTION: action,
      OLD_VALUE: text(oldValue),
      NEW_VALUE: text(newValue),
      ASSIGNED_AGENT: text(assignedAgent),
      PERFORMED_BY: actor ? displayName(actor) : "System",
      ROLE: text(actor && actor.data && actor.data.ROLE),
      REMARKS: text(remarks)
    });
  }

  function slotFields(slot) {
    const mapping = {
      1: {
        assignedBy: "ASSIGNED_BY_1",
        assignedAt: "CALL_1_ASSIGNED_DATE_TIME",
        agent: "CALLING_AGENT_1_NAME",
        openedAt: "CALL_1_REVIEW_OPENED_AT",
        remark: "CALLING_1_REMARK",
        completedAt: "CALLING_1_COMPLETED_DATE_TIME",
        duration: "CALL_1_ASSIGNMENT_TO_COMPLETION_TIME"
      },
      2: {
        assignedBy: "ASSIGNED_BY_2",
        assignedAt: "CALL_2_ASSIGNED_DATE_TIME",
        agent: "CALLING_AGENT_2_NAME",
        openedAt: "CALL_2_REVIEW_OPENED_AT",
        remark: "CALLING_2_REMARK",
        completedAt: "CALLING_2_COMPLETED_DATE_TIME",
        duration: "CALL_2_ASSIGNMENT_TO_COMPLETION_TIME"
      },
      3: {
        assignedBy: "ASSIGNED_BY_3",
        assignedAt: "CALL_3_ASSIGNED_DATE_TIME",
        agent: "CALLING_AGENT_3_NAME",
        openedAt: "CALL_3_REVIEW_OPENED_AT",
        remark: "CALLING_3_REMARK",
        completedAt: "CALLING_3_COMPLETED_DATE_TIME",
        duration: "CALL_3_ASSIGNMENT_TO_COMPLETION_TIME"
      }
    };
    return mapping[Number(slot)] || null;
  }

  function nextAssignedSlot(ticket) {
    for (let slot = 1; slot <= 3; slot++) {
      const fields = slotFields(slot);
      if (text(ticket.data[fields.agent]) && !text(ticket.data[fields.remark]))
        return slot;
    }
    return 0;
  }

  function latestCompletedSlot(ticket) {
    for (let slot = 3; slot >= 1; slot--) {
      const fields = slotFields(slot);
      if (text(ticket.data[fields.remark])) return slot;
    }
    return 0;
  }

  function ticketCurrentStatus(ticket) {
    if (text(ticket.data.CALLING_FINAL_STATUS).toUpperCase() === CSR_TICKET_STATUS.CLOSED)
      return "Closed — " + (text(ticket.data.FINAL_OUTCOME) || "Completed");

    const pendingSlot = nextAssignedSlot(ticket);
    if (pendingSlot) {
      const fields = slotFields(pendingSlot);
      return "Assigned — Call " + pendingSlot + " to " + text(ticket.data[fields.agent]);
    }

    const completedSlot = latestCompletedSlot(ticket);
    if (completedSlot) {
      const fields = slotFields(completedSlot);
      return completedSlot + " Call Done — " + text(ticket.data[fields.remark]);
    }

    return "Calling Pending";
  }

  function isClosingOutcome(remark) {
    return closingOutcomes().some(outcome => same(outcome, remark));
  }

  function validateCsrReason(reason) {
    const selected = text(reason);
    if (!selected) return false;
    return Database.reasons.csrActive().some(record => same(record.data.REASON, selected));
  }

  function priorSubmissionStats(orderNumber, fallbackTimestamp) {
    const records = Database.submissions.findByOrderNumber(orderNumber);
    const dates = records
      .map(record => Utility.parseDateTime(record.data.TIMESTAMP))
      .filter(Boolean)
      .sort((left, right) => left.getTime() - right.getTime());

    const fallback = Utility.parseDateTime(fallbackTimestamp) || new Date();
    return {
      first: Utility.formatDateTime(dates[0] || fallback),
      last: Utility.formatDateTime(dates[dates.length - 1] || fallback),
      count: records.length || 1
    };
  }

  function schemaIssue(sheetName, requiredColumns) {
    const columns = Database.core.columns(sheetName);
    const missing = requiredColumns.filter(column => columns[column] === undefined);

    return missing.length
      ? sheetName + " is missing required header(s): " + missing.join(", ") + "."
      : "";
  }

  /**
   * Calling Sheet and CSR Audit Logs are configured by the user, but their
   * column headings are a strict application contract. Validate them before
   * writing anything so that an operational issue can be fixed safely.
   */
  function validateCsrInfrastructure() {

    // Validate the configuration values which control CSR ticket creation too.
    // This makes a missing/renamed setting visible before a ticket write starts.
    try {
      configuredPushRemark();
      reviewLockMinutes();
      callerRole();
      csrScope();
      closingOutcomes();
    } catch (error) {
      return Utility.error("CSR configuration check failed: " + error.message);
    }

    const issues = [
      schemaIssue(CALLING_SHEET, REQUIRED_CALLING_COLUMNS),
      schemaIssue(CSR_AUDIT_SHEET, REQUIRED_CSR_AUDIT_COLUMNS)
    ].filter(Boolean);

    return issues.length
      ? Utility.error("CSR ticket setup check failed. " + issues.join(" "))
      : Utility.success("CSR ticket setup is ready.");
  }

  function sourceActor(record, actor) {
    const actorName = displayName(actor);
    const actorRole = text(userData(actor).ROLE);

    if (actorName) {
      return { name: actorName, role: actorRole || "System" };
    }

    const reviewerName = text(record && record.REVIEWED_BY) ||
      text(record && record.ASSIGNED_TO);
    const reviewer = reviewerName
      ? Database.users.findByUsername(reviewerName)
      : null;

    return {
      name: reviewerName || displayName(reviewer) || "System",
      role: text(reviewer && reviewer.data && reviewer.data.ROLE) || "System"
    };
  }

  /** Create once, on the same RTO approval transaction that pushed the NDR remark. */

  function createFromSubmission(submission, pushedBy, pushedByRole, options) {
    const record = submission && submission.data ? submission.data : submission;
    const source = text(options && options.source);

    if (!record) return Utility.error(ERROR.SUBMISSION_NOT_FOUND);

    if (source !== "RTO_QUICK_ACTION" && source !== "HISTORICAL_SYNC") {
      return Utility.error(
        "CSR tickets can only be created by the Push For NDR Calling quick action."
      );
    }

    /*
     * The RTO quick action is a server-side, validated action.  Do not depend
     * on a stale submission object after the approval write: use the configured
     * push remark for the ticket and preserve that same value in Calling Sheet.
     * Historical sync continues to validate the value stored on the submission.
     */
    const managerRemarks = source === "RTO_QUICK_ACTION"
      ? configuredPushRemark()
      : text(record.MANAGER_REMARKS);

    if (!isCsrPushRemark(managerRemarks)) {
      return Utility.error(
        "CSR ticket creation requires the configured Push For NDR Calling remark."
      );
    }

    const infrastructure = validateCsrInfrastructure();
    if (!infrastructure.success) return infrastructure;

    const existing = Database.calling.findBySubmissionId(record.SUBMISSION_ID);
    if (existing) {
      return Utility.success("CSR ticket already exists.", {
        ticketId: existing.data.CSR_TICKET_ID
      });
    }

    try {
      const createdAt = Utility.formatDateTime();
      const stats = priorSubmissionStats(record.ORDER_NUMBER, record.TIMESTAMP);
      const ticketId = Utility.generateCsrTicketId();

      Database.calling.insert({
        CSR_TICKET_ID: ticketId,
        SUBMISSION_ID: record.SUBMISSION_ID,
        ORDER_NUMBER: record.ORDER_NUMBER,
        RIDER_NAME: record.RIDER_NAME,
        EMPLOYEE_ID: record.EMPLOYEE_ID,
        ZONE: record.ZONE,
        WAREHOUSE: record.WAREHOUSE,
        LM_HUB: record.LM_HUB,
        REASON: record.REASON,
        MANDATORY_PROOF_LINK: record.MANDATORY_PROOF,
        OPTIONAL_PROOF_LINK: record.OPTIONAL_PROOF,
        FIRST_ATTEMPT_DELIVERY_DATE_TIME: stats.first,
        LAST_ATTEMPT_DELIVERY_DATE_TIME: stats.last,
        PRIOR_SUBMISSION_COUNT: stats.count,
        NDR_PUSHED_BY: text(pushedBy),
        NDR_PUSHED_BY_ROLE: text(pushedByRole),
        NDR_PUSHED_DATE_TIME: createdAt,
        RTO_REVIEWED_BY: record.REVIEWED_BY || pushedBy,
        RTO_APPROVED_ON: record.REVIEWED_ON || createdAt,
        RTO_MANAGER_REMARKS: managerRemarks,
        CSR_TICKET_CREATED_AT: createdAt,
        CSR_TICKET_CREATED_BY: "System",
        CALLING_FINAL_STATUS: CSR_TICKET_STATUS.OPEN,
        CURRENT_STATUS: "Calling Pending",
        CURRENT_ASSIGNED_AGENT: "",
        LAST_CSR_ACTIVITY_AT: createdAt
      });

      const ticket = Database.calling.findByTicketId(ticketId);

      if (!ticket) {
        return Utility.error(
          "CSR ticket insert could not be verified for " + text(record.SUBMISSION_ID) + "."
        );
      }

      try {
        audit(
          ticket,
          "CSR Ticket Created",
          "",
          CSR_TICKET_STATUS.OPEN,
          "",
          null,
          source === "HISTORICAL_SYNC"
            ? "Recovered from an approved legacy RTO submission."
            : "Created from the RTO Push For NDR Calling quick action."
        );
      } catch (auditError) {
        Logger.log(
          "CSR ticket " + ticketId + " was created but CSR audit logging failed: " +
          (auditError && auditError.message ? auditError.message : auditError)
        );
      }

      return Utility.success("CSR ticket created.", { ticketId });
    } catch (error) {
      return Utility.error(
        "CSR ticket could not be created for " + text(record.SUBMISSION_ID) + ": " +
        (error && error.message ? error.message : error)
      );
    }
  }

  /**
   * Recovers tickets for approved RTO submissions that were already marked for
   * NDR calling before CSR automation was deployed. Existing tickets are always
   * preserved, making this operation safe to run repeatedly.
   */
  function syncMissingTickets(actor) {

    // createFromSubmission() generates a CSR ID under the ScriptLock. A user
    // lock here avoids re-entering that same lock during ticket synchronisation.
    const lock = LockService.getUserLock();
    let created = 0;
    let existing = 0;
    let failed = 0;
    let eligible = 0;
    const failures = [];

    try {
      lock.waitLock(20000);

      const infrastructure = validateCsrInfrastructure();
      if (!infrastructure.success) return infrastructure;

      Database.submissions.list().forEach(submission => {
        const record = submission.data || {};

        if (text(record.STATUS).toUpperCase() !== SUBMISSION_STATUS.APPROVED ||
            !isCsrPushRemark(record.MANAGER_REMARKS))
          return;

        eligible++;

        if (Database.calling.findBySubmissionId(record.SUBMISSION_ID)) {
          existing++;
          return;
        }

        try {
          const source = sourceActor(record, actor);
          const result = createFromSubmission(
            submission,
            source.name,
            source.role,
            { source: "HISTORICAL_SYNC" }
          );

          if (result.success && result.data && result.data.ticketId) {
            created++;
          } else {
            failed++;
            failures.push(
              text(record.SUBMISSION_ID) + ": " +
              text(result && result.message || "No CSR ticket was returned.")
            );
          }
        } catch (error) {
          failed++;
          failures.push(
            text(record.SUBMISSION_ID) + ": " +
            (error && error.message ? error.message : error)
          );
        }
      });

      return Utility.success(
        eligible + " approved NDR submission(s) found; " +
        created + " missing CSR ticket(s) created" +
          (existing ? "; " + existing + " already existed." : ".") +
          (failed
            ? " " + failed + " ticket(s) could not be created. " +
              failures.slice(0, 3).join(" | ")
            : ""),
        { eligible, created, existing, failed, failures }
      );
    } finally {
      lock.releaseLock();
    }

  }

  function releaseExpiredLock(ticket) {
    if (!ticket || text(ticket.data.CALLING_FINAL_STATUS).toUpperCase() === CSR_TICKET_STATUS.CLOSED)
      return false;

    const lock = getLock(ticket.data.CSR_TICKET_ID);
    if (!lock || lock.expiresAt > Date.now()) return false;

    const now = Utility.formatDateTime();
    const releasedStatus = ticketCurrentStatus(ticket);
    Database.calling.updateFields(ticket.row, {
      CURRENT_STATUS: releasedStatus,
      CURRENT_ASSIGNED_AGENT: nextAssignedSlot(ticket)
        ? text(ticket.data[slotFields(nextAssignedSlot(ticket)).agent]) : "",
      CSR_REVIEW_OPENED_BY: "",
      CSR_REVIEW_OPENED_AT: "",
      CSR_REVIEW_LOCK_EXPIRES_AT: "",
      LAST_CSR_ACTIVITY_AT: now
    });
    clearLock(ticket.data.CSR_TICKET_ID);
    const refreshed = Database.calling.findByTicketId(ticket.data.CSR_TICKET_ID);
    audit(refreshed, "CSR Review Lock Expired", "Under Review", releasedStatus, "", null,
      "The configured CSR review lock expired and the ticket was released.");
    return true;
  }

  function releaseExpiredReviewLocks(records) {
    const lock = LockService.getScriptLock();
    if (!lock.tryLock(10000)) return 0;
    try {
      let released = 0;
      (records || Database.calling.list()).forEach(record => {
        const current = Database.calling.findByTicketId(record.data.CSR_TICKET_ID);
        if (releaseExpiredLock(current)) released++;
      });
      return released;
    } finally {
      lock.releaseLock();
    }
  }

  function claimAdminReview(ticketId, user) {
    if (!isCsrAdmin(user)) return Utility.error(ERROR.ACCESS_DENIED);

    const lock = LockService.getScriptLock();
    if (!lock.tryLock(10000)) return Utility.error("Another CSR review is being opened. Please try again.");

    try {
      let ticket = Database.calling.findByTicketId(ticketId);
      if (!ticket) return Utility.error("CSR ticket not found.");
      if (text(ticket.data.CALLING_FINAL_STATUS).toUpperCase() === CSR_TICKET_STATUS.CLOSED)
        return Utility.error("This CSR ticket is already closed.");

      releaseExpiredLock(ticket);
      ticket = Database.calling.findByTicketId(ticketId);
      const existing = getLock(ticketId);

      if (existing && existing.expiresAt > Date.now() && !same(existing.username, userData(user).USERNAME))
        return Utility.error("This CSR ticket is already being reviewed by another CSR administrator.");

      const now = Utility.formatDateTime();
      const expiresAt = saveLock(ticketId, userData(user).USERNAME);
      Database.calling.updateFields(ticket.row, {
        CURRENT_STATUS: "Under Review",
        CURRENT_ASSIGNED_AGENT: displayName(user),
        CSR_REVIEW_OPENED_BY: displayName(user),
        CSR_REVIEW_OPENED_AT: now,
        CSR_REVIEW_LOCK_EXPIRES_AT: Utility.formatDateTime(new Date(expiresAt)),
        LAST_CSR_ACTIVITY_AT: now
      });
      const refreshed = Database.calling.findByTicketId(ticketId);
      audit(refreshed, "CSR Review Claimed", "", "Under Review", "", user,
        "Exclusive CSR review lock started.");
      return Utility.success(SUCCESS.UPDATED, { ticketId, expiresAt });
    } finally {
      lock.releaseLock();
    }
  }

  function callingAgents() {
    return Database.users.active().filter(user =>
      normalise(user.data.ACCESS_SCOPE) === csrScope() &&
      normalise(user.data.ROLE) === callerRole()
    );
  }

  function assignTickets(ticketIds, agentUsername, slot, user) {
    if (!isCsrAdmin(user)) return Utility.error(ERROR.ACCESS_DENIED);
    const fields = slotFields(slot);
    if (!fields) return Utility.error("Choose Call 1, Call 2, or Call 3.");

    const agent = Database.users.findByUsername(agentUsername);
    if (!agent || !isCallingAgent(agent))
      return Utility.error("Choose an active CSR Calling Agent.");

    const ids = Array.from(new Set((Array.isArray(ticketIds) ? ticketIds : [])
      .map(text).filter(Boolean)));
    if (!ids.length) return Utility.error("Select at least one CSR ticket.");

    const lock = LockService.getScriptLock();
    if (!lock.tryLock(10000)) return Utility.error("Another assignment is in progress. Please try again.");

    try {
      const rejected = [];
      let assigned = 0;
      const now = Utility.formatDateTime();

      ids.forEach(ticketId => {
        let ticket = Database.calling.findByTicketId(ticketId);
        if (!ticket || text(ticket.data.CALLING_FINAL_STATUS).toUpperCase() === CSR_TICKET_STATUS.CLOSED) {
          rejected.push(ticketId);
          return;
        }

        releaseExpiredLock(ticket);
        ticket = Database.calling.findByTicketId(ticketId);
        const existingLock = getLock(ticketId);
        if (existingLock && existingLock.expiresAt > Date.now() && !same(existingLock.username, userData(user).USERNAME)) {
          rejected.push(ticketId);
          return;
        }

        if (slot > 1 && !text(ticket.data[slotFields(slot - 1).remark])) {
          rejected.push(ticketId);
          return;
        }
        if (text(ticket.data[fields.remark]) || text(ticket.data[fields.completedAt])) {
          rejected.push(ticketId);
          return;
        }

        const values = {};
        values[fields.assignedBy] = displayName(user);
        values[fields.assignedAt] = now;
        values[fields.agent] = displayName(agent);
        values.CURRENT_ASSIGNED_AGENT = displayName(agent);
        values.CURRENT_STATUS = "Assigned — Call " + slot + " to " + displayName(agent);
        values.LAST_CSR_ACTIVITY_AT = now;
        if (!text(ticket.data.CSR_ASSIGNMENT_COMPLETED_AT)) {
          values.CSR_ASSIGNMENT_COMPLETED_AT = now;
          values.CSR_ASSIGNMENT_REVIEW_TIME = durationBetween(ticket.data.CSR_REVIEW_OPENED_AT, now);
        }

        Database.calling.updateFields(ticket.row, values);
        clearLock(ticketId);
        ticket = Database.calling.findByTicketId(ticketId);
        audit(ticket, "Call " + slot + " Assigned", "", displayName(agent), displayName(agent), user,
          "CSR ticket assigned for call " + slot + ".");
        assigned++;
      });

      return Utility.success(
        assigned + " CSR ticket(s) assigned." + (rejected.length ? " " + rejected.length + " ticket(s) were skipped." : ""),
        { assigned, rejected }
      );
    } finally {
      lock.releaseLock();
    }
  }

  function agentOwnsSlot(ticket, user, slot) {
    const fields = slotFields(slot);
    if (!fields) return false;
    const assigned = text(ticket.data[fields.agent]);
    return same(assigned, displayName(user)) || same(assigned, userData(user).USERNAME);
  }

  function claimCallReview(ticketId, user) {
    if (!isCallingAgent(user)) return Utility.error(ERROR.ACCESS_DENIED);

    const lock = LockService.getScriptLock();
    if (!lock.tryLock(10000)) return Utility.error("Another calling review is being opened. Please try again.");

    try {
      let ticket = Database.calling.findByTicketId(ticketId);
      if (!ticket) return Utility.error("CSR ticket not found.");
      if (text(ticket.data.CALLING_FINAL_STATUS).toUpperCase() === CSR_TICKET_STATUS.CLOSED)
        return Utility.error("This CSR ticket is already closed.");

      releaseExpiredLock(ticket);
      ticket = Database.calling.findByTicketId(ticketId);
      const slot = nextAssignedSlot(ticket);
      if (!slot || !agentOwnsSlot(ticket, user, slot))
        return Utility.error("This CSR ticket is not assigned to you for the next call.");

      const existing = getLock(ticketId);
      if (existing && existing.expiresAt > Date.now() && !same(existing.username, userData(user).USERNAME))
        return Utility.error("This CSR ticket is currently open with another calling agent.");

      const now = Utility.formatDateTime();
      const expiresAt = saveLock(ticketId, userData(user).USERNAME);
      const fields = slotFields(slot);
      const values = {
        CURRENT_STATUS: "Under Review — Call " + slot,
        CURRENT_ASSIGNED_AGENT: displayName(user),
        LAST_CSR_ACTIVITY_AT: now
      };
      values[fields.openedAt] = now;
      Database.calling.updateFields(ticket.row, values);
      const refreshed = Database.calling.findByTicketId(ticketId);
      audit(refreshed, "Call " + slot + " Review Opened", "", "Under Review", displayName(user), user,
        "Exclusive calling review lock started.");
      return Utility.success(SUCCESS.UPDATED, { ticketId, slot, expiresAt });
    } finally {
      lock.releaseLock();
    }
  }

  function completeCall(ticketId, quickReason, freeText, user) {
    if (!isCallingAgent(user)) return Utility.error(ERROR.ACCESS_DENIED);

    const lock = LockService.getScriptLock();
    if (!lock.tryLock(10000)) return Utility.error("Another calling update is in progress. Please try again.");

    try {
      let ticket = Database.calling.findByTicketId(ticketId);
      if (!ticket) return Utility.error("CSR ticket not found.");
      if (text(ticket.data.CALLING_FINAL_STATUS).toUpperCase() === CSR_TICKET_STATUS.CLOSED)
        return Utility.error("This CSR ticket is already closed.");

      releaseExpiredLock(ticket);
      ticket = Database.calling.findByTicketId(ticketId);
      const slot = nextAssignedSlot(ticket);
      const fields = slotFields(slot);
      const activeLock = getLock(ticketId);
      if (!slot || !fields || !agentOwnsSlot(ticket, user, slot) || !activeLock ||
          activeLock.expiresAt <= Date.now() || !same(activeLock.username, userData(user).USERNAME))
        return Utility.error("Open your assigned CSR review before saving a calling remark.");

      const selected = text(quickReason);
      const notes = text(freeText);
      // Agents may choose a configured final outcome or type that exact
      // outcome as their note. Either path must close the ticket.
      const finalOutcome = isClosingOutcome(selected)
        ? selected
        : (isClosingOutcome(notes) ? notes : "");
      const terminal = !!finalOutcome;
      let remark = "";

      if (slot === 3) {
        if (!terminal)
          return Utility.error("The third calling remark must be one of the configured closure outcomes.");
        remark = selected;
      } else {
        if (selected && !terminal && !validateCsrReason(selected))
          return Utility.error("Choose a currently active CSR reason or enter a free-text remark.");
        if (!selected && !notes)
          return Utility.error("Choose a calling reason or enter a calling remark.");
        remark = [selected, notes].filter(Boolean).join(selected && notes ? " — " : "");
      }

      const now = Utility.formatDateTime();
      const values = {
        CURRENT_ASSIGNED_AGENT: "",
        LAST_CSR_ACTIVITY_AT: now
      };
      values[fields.remark] = remark;
      values[fields.completedAt] = now;
      values[fields.duration] = durationBetween(ticket.data[fields.assignedAt], now);

      if (terminal) {
        values.CALLING_FINAL_STATUS = CSR_TICKET_STATUS.CLOSED;
        values.FINAL_OUTCOME = finalOutcome;
        values.CSR_CLOSED_AT = now;
        values.TOTAL_TIME_TAKEN_FOR_REVIEW = durationBetween(ticket.data.CSR_TICKET_CREATED_AT, now);
        values.CURRENT_STATUS = "Closed — " + selected;
      } else {
        values.CURRENT_STATUS = slot + " Call Done — " + remark;
      }

      if (terminal)
        values.CURRENT_STATUS = "Closed - " + finalOutcome;

      Database.calling.updateFields(ticket.row, values);
      clearLock(ticketId);
      const refreshed = Database.calling.findByTicketId(ticketId);
      audit(refreshed, terminal ? "CSR Ticket Closed" : "Call " + slot + " Completed",
        "Under Review", terminal ? CSR_TICKET_STATUS.CLOSED : remark, displayName(user), user, remark);
      return Utility.success(terminal ? "CSR ticket closed." : "Calling remark saved.", {
        ticketId,
        closed: terminal,
        slot
      });
    } finally {
      lock.releaseLock();
    }
  }

  function matchesFilters(ticket, filters) {
    const source = filters || {};
    const query = text(source.search).toLowerCase();
    const fields = ["CSR_TICKET_ID", "SUBMISSION_ID", "ORDER_NUMBER", "RIDER_NAME", "CURRENT_ASSIGNED_AGENT"];
    if (query && !fields.some(field => text(ticket.data[field]).toLowerCase().indexOf(query) !== -1))
      return false;

    const matches = (field, filter) => !text(filter) || same(ticket.data[field], filter);
    if (!matches("ZONE", source.zone) || !matches("WAREHOUSE", source.warehouse) || !matches("LM_HUB", source.lmHub))
      return false;
    if (text(source.status) && !same(ticket.data.CALLING_FINAL_STATUS, source.status)) return false;

    const created = Utility.parseDateTime(ticket.data.CSR_TICKET_CREATED_AT);
    const start = Utility.parseDateTime(source.startDate);
    const end = Utility.parseDateTime(source.endDate);
    if (start && created && created.getTime() < start.getTime()) return false;
    if (end && created) {
      end.setHours(23, 59, 59, 999);
      if (created.getTime() > end.getTime()) return false;
    }
    return true;
  }

  function listForAdmin(user, filters) {
    if (!isCsrAdmin(user)) return [];
    releaseExpiredReviewLocks();
    return Database.calling.list()
      .filter(ticket => matchesFilters(ticket, filters))
      .sort((left, right) => right.row - left.row);
  }

  function listForAgent(user, filters) {
    if (!isCallingAgent(user)) return [];
    releaseExpiredReviewLocks();
    return Database.calling.list()
      .filter(ticket => text(ticket.data.CALLING_FINAL_STATUS).toUpperCase() === CSR_TICKET_STATUS.OPEN)
      .filter(ticket => {
        const slot = nextAssignedSlot(ticket);
        return slot && agentOwnsSlot(ticket, user, slot);
      })
      .filter(ticket => matchesFilters(ticket, filters))
      .sort((left, right) => right.row - left.row);
  }

  function canAccessTicket(user, ticket) {
    if (!ticket || !isCsrUser(user)) return false;
    if (isCsrAdmin(user)) return true;
    for (let slot = 1; slot <= 3; slot++) {
      if (agentOwnsSlot(ticket, user, slot)) return true;
    }
    return false;
  }

  function dashboard(user) {
    // A calling agent's queue intentionally shows only the next OPEN ticket,
    // but their dashboard must also count their completed calls and closures.
    // Use the complete history for metrics, while recent work remains open-only.
    releaseExpiredReviewLocks();
    const records = isCsrAdmin(user)
      ? listForAdmin(user, {})
      : Database.calling.list()
        .filter(ticket => canAccessTicket(user, ticket))
        .sort((left, right) => right.row - left.row);
    const open = records.filter(ticket => text(ticket.data.CALLING_FINAL_STATUS).toUpperCase() === CSR_TICKET_STATUS.OPEN);
    const closed = records.filter(ticket => text(ticket.data.CALLING_FINAL_STATUS).toUpperCase() === CSR_TICKET_STATUS.CLOSED);
    const unassigned = open.filter(ticket => !nextAssignedSlot(ticket) && !latestCompletedSlot(ticket)).length;
    const assigned = open.filter(ticket => nextAssignedSlot(ticket)).length;
    const inReview = open.filter(ticket => text(ticket.data.CURRENT_STATUS).toUpperCase().indexOf("UNDER REVIEW") === 0).length;
    const callsDone = records.reduce((total, ticket) => total + [1, 2, 3]
      .filter(slot => text(ticket.data[slotFields(slot).remark])).length, 0);
    const averageResolutionTime = averageDuration(closed, "TOTAL_TIME_TAKEN_FOR_REVIEW");

    const allAgentRows = callingAgents().map(agent => {
      const name = displayName(agent);
      const personal = Database.calling.list().filter(ticket => [1, 2, 3]
        .some(slot => same(ticket.data[slotFields(slot).agent], name)));
      const completedCalls = personal.reduce((sum, ticket) => sum + [1, 2, 3]
        .filter(slot => same(ticket.data[slotFields(slot).agent], name) && text(ticket.data[slotFields(slot).remark])).length, 0);
      const openWork = personal.filter(ticket => text(ticket.data.CALLING_FINAL_STATUS).toUpperCase() === CSR_TICKET_STATUS.OPEN &&
        nextAssignedSlot(ticket) && same(ticket.data[slotFields(nextAssignedSlot(ticket)).agent], name)).length;
      const agentCallDurations = [];
      personal.forEach(ticket => [1, 2, 3].forEach(slot => {
        const fields = slotFields(slot);
        if (same(ticket.data[fields.agent], name) && text(ticket.data[fields.remark]))
          agentCallDurations.push({ data: { DURATION: ticket.data[fields.duration] } });
      }));
      return {
        name,
        username: text(agent.data.USERNAME),
        completedCalls,
        openWork,
        averageCallTime: averageDuration(agentCallDurations, "DURATION")
      };
    });

    const myName = displayName(user);
    const ranking = allAgentRows.slice().sort((left, right) => {
      if (right.completedCalls !== left.completedCalls)
        return right.completedCalls - left.completedCalls;
      return durationSeconds(left.averageCallTime) - durationSeconds(right.averageCallTime);
    });
    const myRank = isCallingAgent(user)
      ? ranking.findIndex(row => same(row.name, myName)) + 1
      : 0;

    return {
      total: records.length,
      open: open.length,
      closed: closed.length,
      unassigned,
      assigned,
      inReview,
      callsDone,
      averageResolutionTime,
      recent: (isCsrAdmin(user) ? records : open).slice(0, 10),
      agentRows: isCsrAdmin(user) ? allAgentRows : [],
      myRank
    };
  }

  return {
    isCsrUser,
    isCsrAdmin,
    isCallingAgent,
    configuredPushRemark,
    isCsrPushRemark,
    isCsrPushAttempt,
    createFromSubmission,
    syncMissingTickets,
    validateCsrInfrastructure,
    releaseExpiredReviewLocks,
    claimAdminReview,
    callingAgents,
    assignTickets,
    claimCallReview,
    completeCall,
    listForAdmin,
    listForAgent,
    canAccessTicket,
    dashboard,
    nextAssignedSlot,
    closingOutcomes,
    csrReasons: () => Database.reasons.csrActive(),
    ticketCurrentStatus
  };

})();

/**
 * One-time/manual recovery option for legacy approved NDR submissions.
 * It is safe to run more than once because duplicate submission IDs are skipped.
 */
function syncMissingCsrTickets() {

  const result = Calling.syncMissingTickets(null);
  Logger.log(result.message);
  return result.message;

}

/**
 * Read-only prerequisite check. Run this before Sync Missing CSR Tickets when
 * diagnosing a blank Calling Sheet; it verifies exact headers and CSR config.
 */
function checkCsrTicketSetup() {

  const result = Calling.validateCsrInfrastructure();
  const message = result.success
    ? "CSR ticket setup check passed. Calling Sheet and CSR Audit Logs headers and CSR configuration are ready."
    : result.message;

  Logger.log(message);
  return message;

}
