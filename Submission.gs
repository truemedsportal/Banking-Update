/**
 * ============================================================
 * TRUE MEDS - RTO & REATTEMPT PORTAL
 * File      : Submission.gs
 * Purpose   : Submission Management
 * Version   : 1.0
 * ============================================================
 */

 const Submission = (() => {

  function normalise(value) {

    return Utility.safeString(value).toUpperCase();

  }

  function isAdminUser(user) {

    const role = normalise(user && user.data && user.data.ROLE)
      .replace(/\s+/g, "_");

    return role === "ADMIN" || role === "SUPER_ADMIN";

  }

  function idempotencyKey(username, clientRequestId) {
    const requestId = Utility.safeString(clientRequestId).trim();
    if (!requestId || requestId.length > 120) return "";
    const digest = Utilities.computeDigest(
      Utilities.DigestAlgorithm.SHA_256,
      Utility.safeString(username).toLowerCase() + "|" + requestId
    );
    return "OFFLINE_SUBMISSION_" + Utilities.base64EncodeWebSafe(digest).replace(/=+$/g, "");
  }

  function readIdempotentSubmission(key) {
    if (!key) return null;
    try {
      const stored = PropertiesService.getScriptProperties().getProperty(key);
      return stored ? JSON.parse(stored) : null;
    } catch (error) {
      return null;
    }
  }

  function storeIdempotentSubmission(key, result) {
    if (!key) return;
    try {
      PropertiesService.getScriptProperties().setProperty(key, JSON.stringify(result));
    } catch (error) {
      console.warn("The offline submission idempotency receipt could not be stored.");
    }
  }

  /**
   * ============================================================
   * CREATE SUBMISSION
   * ============================================================
   */

            function create(data) {

          /* ---------- Mandatory Validation ---------- */

          let result;

          result = Validation.orderNumber(
            data.orderNumber
          );

          if (!result.success)
            return result;

          result = Validation.required(
            data.reason,
            "Reason"
          );

          if (!result.success)
            return result;

    /* ---------- Logged-in User ---------- */

    const user = Database.users.findByUsername(
      data.username
    );

    if (!user)
      return Utility.error(ERROR.USER_NOT_FOUND);

    if (
      Utility.safeString(user.data.STATUS) !== STATUS.ACTIVE
    ) {

      return Utility.error(
        ERROR.ACCOUNT_INACTIVE
      );

    }

    const directApproval = isAdminUser(user);
    const requestId = Utility.safeString(data.clientRequestId).trim();
    const receiptKey = idempotencyKey(user.data.USERNAME, requestId);

    if (directApproval && Calling.isCsrPushAttempt(data.managerRemarks)) {
      return Utility.error(
        'To push call to NDR please click on quick action button "Push For NDR Calling".'
      );
    }

          /* ---------- Check Reason Configuration ---------- */

          const reasonConfig =
            Database.reasons.findByReason(
              data.reason
            );

          if (reasonConfig) {

            const mandatoryProofRequired =

              reasonConfig.data.MANDATORY_PROOF === true ||

              Utility.safeString(
                reasonConfig.data.MANDATORY_PROOF
              ).toUpperCase() === "TRUE" ||

              Utility.safeString(
                reasonConfig.data.MANDATORY_PROOF
              ).toUpperCase() === "YES";

            if (mandatoryProofRequired && !directApproval) {

              result = Validation.required(

                data.mandatoryProof,

                "Mandatory Proof"

              );

              if (!result.success)
                return result;

            }

          }

    /* ---------- Submission ---------- */

    const submissionId =
      Utility.generateSubmissionId();

    const timestamp =
      Utility.formatDateTime();

    // The same lock is used by bulkCreate(), keeping row inserts ordered.
    const submissionLock = LockService.getScriptLock();

    if (!submissionLock.tryLock(30000))
      return Utility.error(
        "Another submission is being processed. Please try again shortly."
      );

    try {

    const priorReceipt = readIdempotentSubmission(receiptKey);
    if (priorReceipt && priorReceipt.submissionId) {
      return Utility.success(
        "This offline submission was already received.",
        priorReceipt
      );
    }

    // If administrators add a "Client Request ID" column, the sheet itself is
    // also an idempotency source. The Script Property receipt remains the
    // backwards-compatible safeguard for existing sheets without that column.
    if (requestId) {
      const priorRow = Database.submissions.find("CLIENT_REQUEST_ID", requestId);
      if (priorRow && normalise(priorRow.data.USERNAME) === normalise(user.data.USERNAME)) {
        const priorResult = {
          submissionId: Utility.safeString(priorRow.data.SUBMISSION_ID),
          status: Utility.safeString(priorRow.data.STATUS)
        };
        storeIdempotentSubmission(receiptKey, priorResult);
        return Utility.success("This offline submission was already received.", priorResult);
      }
    }

    Database.submissions.insert({

      SUBMISSION_ID: submissionId,

      CLIENT_REQUEST_ID: requestId,

      TIMESTAMP: timestamp,

      USERNAME: user.data.USERNAME,

      RIDER_NAME: user.data.RIDER_NAME,

      EMPLOYEE_ID: user.data.EMPLOYEE_ID,

      ZONE: user.data.ZONE,

      WAREHOUSE: user.data.WAREHOUSE,

      LM_HUB: user.data.LM_HUB,

      ORDER_NUMBER: Utility.safeString(
        data.orderNumber
      ).toUpperCase(),

      MANDATORY_PROOF:
        data.mandatoryProof,

      OPTIONAL_PROOF:
        data.optionalProof || "",

      REASON:
        data.reason,

      STATUS:
        directApproval
          ? SUBMISSION_STATUS.APPROVED
          : SUBMISSION_STATUS.SUBMITTED,

      ASSIGNED_TO:
        directApproval ? user.data.USERNAME : "",

      REVIEWED_BY:
        directApproval ? user.data.USERNAME : "",

      REVIEWED_ON:
        directApproval ? timestamp : "",

      LAST_UPDATED: timestamp,

      REVIEW_TIME:
        directApproval ? "0 Minutes" : "",

      MANAGER_REMARKS:
        directApproval
          ? Utility.safeString(data.managerRemarks)
          : ""

    });

    if (directApproval) {

      Database.audit.insert({
        TIMESTAMP: timestamp,
        SUBMISSION_ID: submissionId,
        ACTION: "Admin Direct Approval",
        MODULE: "Submission",
        OLD_STATUS: "",
        NEW_STATUS: SUBMISSION_STATUS.APPROVED,
        PERFORMED_BY: user.data.USERNAME,
        ROLE: user.data.ROLE,
        REMARKS: "Admin submission was approved automatically.",
        VERSION: Config.get("APP_VERSION")
      });

    }

    const createdResult =
      {
        submissionId: submissionId,
        status: directApproval
          ? SUBMISSION_STATUS.APPROVED
          : SUBMISSION_STATUS.SUBMITTED
      };

    storeIdempotentSubmission(receiptKey, createdResult);

    return Utility.success(
      SUCCESS.SUBMISSION_CREATED,
      createdResult
    );

    } finally {

      submissionLock.releaseLock();

    }

  }

  /**
   * ============================================================
   * ADMIN BULK UPLOAD
   * The spreadsheet contains only business data.  Its target location is
   * selected from Configuration!H:J, never typed freely in a file.
   * ============================================================
   */

  function sameText(left, right) {

    return normalise(left) === normalise(right);

  }

  function locationScope(user) {

    return normalise(user && user.data && user.data.ACCESS_SCOPE)
      .replace(/\s+/g, "_");

  }

  function locationsForUser(user) {

    const scope = locationScope(user);

    return Config.locations().filter(location => {

      if (!location.zone || !location.warehouse || !location.lmHub)
        return false;

      if (scope === "PAN_INDIA")
        return true;

      if (scope === "ZONE")
        return sameText(location.zone, user.data.ZONE);

      if (scope === "WAREHOUSE")
        return sameText(location.zone, user.data.ZONE) &&
          sameText(location.warehouse, user.data.WAREHOUSE);

      if (scope === "LM_HUB" || scope === "HUB")
        return sameText(location.zone, user.data.ZONE) &&
          sameText(location.warehouse, user.data.WAREHOUSE) &&
          sameText(location.lmHub, user.data.LM_HUB);

      return false;

    });

  }

  function bulkUploadContext(username) {

    const user = Database.users.findByUsername(username);

    if (!user)
      return Utility.error(ERROR.USER_NOT_FOUND);

    return Utility.success(SUCCESS.FETCHED, {
      accessScope: Utility.safeString(user.data.ACCESS_SCOPE),
      locations: locationsForUser(user),
      currentLocation: {
        zone: Utility.safeString(user.data.ZONE),
        warehouse: Utility.safeString(user.data.WAREHOUSE),
        lmHub: Utility.safeString(user.data.LM_HUB)
      }
    });

  }

  function validBulkLocation(user, requestedLocation) {

    const requested = requestedLocation || {};
    const zone = Utility.safeString(requested.zone);
    const warehouse = Utility.safeString(requested.warehouse);
    const lmHub = Utility.safeString(requested.lmHub);

    if (!zone || !warehouse || !lmHub)
      return null;

    return locationsForUser(user).find(location =>
      sameText(location.zone, zone) &&
      sameText(location.warehouse, warehouse) &&
      sameText(location.lmHub, lmHub)
    ) || null;

  }

  function bulkCreate(username, rows, requestedLocation) {

    const user = Database.users.findByUsername(username);

    if (!user)
      return Utility.error(ERROR.USER_NOT_FOUND);

    if (!isAdminUser(user))
      return Utility.error(ERROR.ACCESS_DENIED);

    const location = validBulkLocation(user, requestedLocation);

    if (!location)
      return Utility.error(
        "Choose a valid Zone, Warehouse and LM Hub from your permitted location mapping."
      );

    const sourceRows = Array.isArray(rows) ? rows : [];

    if (!sourceRows.length)
      return Utility.error("The bulk-upload file does not contain any data rows.");

    if (sourceRows.length > 200)
      return Utility.error("Upload a maximum of 200 rows at one time.");

    const prepared = [];
    const validationErrors = [];

    sourceRows.forEach((source, index) => {

      const rowNumber = index + 2;
      const orderNumber = Utility.safeString(source && source.orderNumber);
      const reason = Utility.safeString(source && source.reason);
      const remarks = Utility.safeString(source && source.hubManagerRemarks);
      const orderValidation = Validation.orderNumber(orderNumber);

      if (!orderValidation.success) {
        validationErrors.push("Row " + rowNumber + ": " + orderValidation.message);
        return;
      }

      if (!reason) {
        validationErrors.push("Row " + rowNumber + ": Reason is required.");
        return;
      }

      if (Calling.isCsrPushAttempt(remarks)) {
        validationErrors.push(
          'Row ' + rowNumber +
          ': To push call to NDR please click on quick action button "Push For NDR Calling".'
        );
        return;
      }

      prepared.push({
        orderNumber: orderNumber.toUpperCase(),
        // Bulk Admin uploads intentionally accept any non-empty operational
        // reason.  They are direct approvals, not rider review requests.
        reason: reason,
        hubManagerRemarks: remarks
      });

    });

    if (validationErrors.length) {
      const preview = validationErrors.slice(0, 8).join(" ");
      const more = validationErrors.length > 8
        ? " " + (validationErrors.length - 8) + " more row(s) need attention."
        : "";
      return Utility.error("Bulk upload was not saved. " + preview + more);
    }

    // ID generation uses a ScriptLock. Use a user lock here so a bulk upload
    // can safely request one unique ID per row without trying to re-enter the
    // same script lock and leaving the browser on a blank/loading page.
    const lock = LockService.getUserLock();

    if (!lock.tryLock(30000))
      return Utility.error(
        "Another submission batch is being processed. Your file remains unchanged; please try again shortly."
      );

    try {

      const timestamp = Utility.formatDateTime();
      const submissions = prepared.map(row => {

        const submissionId = Utility.generateSubmissionId();

        return {
          SUBMISSION_ID: submissionId,
          TIMESTAMP: timestamp,
          USERNAME: user.data.USERNAME,
          RIDER_NAME: user.data.RIDER_NAME,
          EMPLOYEE_ID: user.data.EMPLOYEE_ID,
          ZONE: location.zone,
          WAREHOUSE: location.warehouse,
          LM_HUB: location.lmHub,
          ORDER_NUMBER: row.orderNumber,
          MANDATORY_PROOF: "",
          OPTIONAL_PROOF: "",
          REASON: row.reason,
          STATUS: SUBMISSION_STATUS.APPROVED,
          ASSIGNED_TO: user.data.USERNAME,
          REVIEWED_BY: user.data.USERNAME,
          REVIEWED_ON: timestamp,
          LAST_UPDATED: timestamp,
          REVIEW_TIME: "0 Minutes",
          MANAGER_REMARKS: row.hubManagerRemarks
        };

      });

      Database.submissions.insertMany(submissions);

      Database.audit.insertMany(submissions.map(submission => ({
        TIMESTAMP: timestamp,
        SUBMISSION_ID: submission.SUBMISSION_ID,
        ACTION: "Admin Bulk Direct Approval",
        MODULE: "Submission",
        OLD_STATUS: "",
        NEW_STATUS: SUBMISSION_STATUS.APPROVED,
        PERFORMED_BY: user.data.USERNAME,
        ROLE: user.data.ROLE,
        REMARKS: submission.MANAGER_REMARKS ||
          "Bulk admin submission was approved automatically.",
        VERSION: Config.get("APP_VERSION")
      })));

      return Utility.success(
        prepared.length + " bulk submission(s) were uploaded and approved.",
        {
          created: prepared.length,
          status: SUBMISSION_STATUS.APPROVED
        }
      );

    } finally {

      lock.releaseLock();

    }

  }

  /**
   * ============================================================
   * GET SUBMISSION
   * ============================================================
   */

  function get(submissionId) {

    return Database.submissions.findBySubmissionId(
      submissionId
    );

  }

  /**
   * ============================================================
   * LIST SUBMISSIONS
   * ============================================================
   */

  function list() {

    return Database.submissions.list();

  }

  /**
   * ============================================================
   * MY SUBMISSIONS
   * ============================================================
   */

  function mySubmissions(username) {

    return Database.submissions.findByUsername(
      username
    );

  }

  /**
   * ============================================================
   * PART 2 CONTINUES...
   * ============================================================
   */
    /**
   * ============================================================
   * ASSIGN SUBMISSION
   * ============================================================
   */

  function reviewLockMinutes() {

    const configured = Number(Config.get("RTO_REVIEW_LOCK_MINUTES"));

    if (!isFinite(configured) || configured < 1)
      throw new Error("Configuration setting 'RTO_REVIEW_LOCK_MINUTES' must be a positive number.");

    return configured;

  }

  function reviewLockMs() {

    return reviewLockMinutes() * 60 * 1000;

  }

  function reviewLockLabel() {

    return reviewLockMinutes() + "-minute";

  }
  const REVIEW_LOCK_PROPERTY_PREFIX = "rto.review-lock.";

  /**
   * Review ownership is deliberately stored in Script Properties rather than
   * calculated from a formatted spreadsheet value.  That makes the lock
   * atomic and time-zone independent for every reviewer.
   */
  function reviewLockKey(submissionId) {

    return REVIEW_LOCK_PROPERTY_PREFIX +
      encodeURIComponent(Utility.safeString(submissionId));

  }

  function readStoredReviewLock(submissionId) {

    const properties = PropertiesService.getScriptProperties();
    const key = reviewLockKey(submissionId);
    const raw = properties.getProperty(key);

    if (!raw) return null;

    try {

      const value = JSON.parse(raw);
      const username = Utility.safeString(value.username);
      const expiresAt = Number(value.expiresAt);

      if (!username || !isFinite(expiresAt)) {
        properties.deleteProperty(key);
        return null;
      }

      return {
        username,
        expiresAt,
        claimedAt: Number(value.claimedAt) || null
      };

    } catch (error) {

      properties.deleteProperty(key);
      return null;

    }

  }

  function writeReviewLock(submissionId, username, expiresAt, claimedAt) {

    PropertiesService.getScriptProperties().setProperty(
      reviewLockKey(submissionId),
      JSON.stringify({
        username: Utility.safeString(username),
        expiresAt: Number(expiresAt),
        claimedAt: Number(claimedAt) || null
      })
    );

  }

  function clearReviewLock(submissionId) {

    PropertiesService.getScriptProperties().deleteProperty(
      reviewLockKey(submissionId)
    );

  }

  /**
   * Allows a lock created by the previous version to finish or expire once.
   * All new claims use the Script Properties lock above.
   */
  function legacyReviewLock(submission) {

    if (!submission ||
        Utility.safeString(submission.data.STATUS) !== SUBMISSION_STATUS.UNDER_REVIEW) {
      return null;
    }

    const username = Utility.safeString(submission.data.ASSIGNED_TO);
    const lockedSince = Utility.parseDateTime(submission.data.LAST_UPDATED);

    if (!username || !lockedSince) return null;

    return {
      username,
      expiresAt: lockedSince.getTime() + reviewLockMs(),
      claimedAt: lockedSince.getTime(),
      legacy: true
    };

  }

  function reviewLockFor(submission) {

    if (!submission) return null;

    return readStoredReviewLock(submission.data.SUBMISSION_ID) ||
      legacyReviewLock(submission);

  }

  function isReviewLockActive(submission) {

    if (!submission ||
        Utility.safeString(submission.data.STATUS) !== SUBMISSION_STATUS.UNDER_REVIEW) {
      return false;
    }

    const reviewLock = reviewLockFor(submission);

    return !!reviewLock && reviewLock.expiresAt > Date.now();

  }

  function isReviewOwner(submission, username) {

    return Utility.safeString(submission && submission.data.ASSIGNED_TO)
      .toLowerCase() === Utility.safeString(username).toLowerCase();

  }

  function releaseExpiredReviewLock(submission) {

    if (!submission ||
        Utility.safeString(submission.data.STATUS) !== SUBMISSION_STATUS.UNDER_REVIEW) {
      return false;
    }

    const reviewLock = reviewLockFor(submission);

    if (reviewLock && reviewLock.expiresAt > Date.now()) {
      if (reviewLock.legacy) {
        writeReviewLock(
          submission.data.SUBMISSION_ID,
          reviewLock.username,
          reviewLock.expiresAt,
          reviewLock.claimedAt
        );
      }
      return false;
    }

    const timestamp = Utility.formatDateTime();
    const previousOwner = Utility.safeString(
      reviewLock && reviewLock.username || submission.data.ASSIGNED_TO
    );

    Database.submissions.updateCell(
      submission.row,
      "STATUS",
      SUBMISSION_STATUS.SUBMITTED
    );
    Database.submissions.updateCell(submission.row, "ASSIGNED_TO", "");
    Database.submissions.updateCell(submission.row, "LAST_UPDATED", timestamp);
    clearReviewLock(submission.data.SUBMISSION_ID);

    Database.audit.insert({
      TIMESTAMP: timestamp,
      SUBMISSION_ID: submission.data.SUBMISSION_ID,
      ACTION: "Review Lock Expired",
      MODULE: "Submission",
      OLD_STATUS: SUBMISSION_STATUS.UNDER_REVIEW,
      NEW_STATUS: SUBMISSION_STATUS.SUBMITTED,
      PERFORMED_BY: "System",
      ROLE: "",
      REMARKS: reviewLockLabel() + " review lock for " +
        (previousOwner || "the reviewer") + " expired; submission released.",
      VERSION: Config.get("APP_VERSION")
    });

    return true;

  }

  /**
   * A web app cannot execute exactly at the expiry instant without a separate
   * time trigger, so every pending/dashboard refresh reconciles expired locks.
   */
  function releaseExpiredReviewLocks(records) {

    const candidates = (records || Database.submissions.list()).filter(record =>
      Utility.safeString(record.data.STATUS) === SUBMISSION_STATUS.UNDER_REVIEW
    );

    if (!candidates.length) return 0;

    const lock = LockService.getScriptLock();

    if (!lock.tryLock(10000)) return 0;

    try {

      let released = 0;

      candidates.forEach(candidate => {
        const current = Database.submissions.findBySubmissionId(
          candidate.data.SUBMISSION_ID
        );

        if (releaseExpiredReviewLock(current)) released++;
      });

      return released;

    } finally {

      lock.releaseLock();

    }

  }

  function claimForReview(submissionId, username) {

    const lock = LockService.getScriptLock();

    if (!lock.tryLock(10000))
      return Utility.error("Another review is being started. Please try again.");

    try {

      let submission =
        Database.submissions.findBySubmissionId(submissionId);

      if (!submission)
        return Utility.error(ERROR.SUBMISSION_NOT_FOUND);

      if (releaseExpiredReviewLock(submission)) {
        submission = Database.submissions.findBySubmissionId(submissionId);
      }

      const status = Utility.safeString(submission.data.STATUS);

      if (status === SUBMISSION_STATUS.APPROVED || status === SUBMISSION_STATUS.REJECTED)
        return Utility.error("This submission has already been reviewed.");

      const existingLock = reviewLockFor(submission);

      if (status === SUBMISSION_STATUS.UNDER_REVIEW &&
          existingLock && existingLock.expiresAt > Date.now()) {

        if (existingLock.legacy) {
          writeReviewLock(
            submissionId,
            existingLock.username,
            existingLock.expiresAt,
            existingLock.claimedAt
          );
        }

        if (Utility.safeString(existingLock.username).toLowerCase() ===
            Utility.safeString(username).toLowerCase()) {
          return Utility.success(SUCCESS.UPDATED, { alreadyClaimed: true });
        }

        return Utility.error(
          "This submission is already under review by another user. It will become available when the " +
          reviewLockLabel() + " review window expires."
        );

      }

      if (status !== SUBMISSION_STATUS.SUBMITTED &&
          status !== SUBMISSION_STATUS.UNDER_REVIEW) {
        return Utility.error("This submission is not available for review.");
      }

      const claimedAt = Date.now();
      const timestamp = Utility.formatDateTime(new Date(claimedAt));

      Database.submissions.updateCell(
        submission.row,
        "STATUS",
        SUBMISSION_STATUS.UNDER_REVIEW
      );
      Database.submissions.updateCell(submission.row, "ASSIGNED_TO", username);
      Database.submissions.updateCell(submission.row, "LAST_UPDATED", timestamp);
      writeReviewLock(
        submissionId,
        username,
        claimedAt + reviewLockMs(),
        claimedAt
      );

      Database.audit.insert({
        TIMESTAMP: timestamp,
        SUBMISSION_ID: submissionId,
        ACTION: "Review Claimed",
        MODULE: "Submission",
        OLD_STATUS: status,
        NEW_STATUS: SUBMISSION_STATUS.UNDER_REVIEW,
        PERFORMED_BY: username,
        ROLE: "",
        REMARKS: reviewLockLabel() + " exclusive review lock started.",
        VERSION: Config.get("APP_VERSION")
      });

      return Utility.success(SUCCESS.UPDATED, { alreadyClaimed: false });

    } finally {

      lock.releaseLock();

    }

  }

  function assignSubmission(submissionId, assignedTo) {

    const submission =
      Database.submissions.findBySubmissionId(submissionId);

    if (!submission)
      return Utility.error(ERROR.SUBMISSION_NOT_FOUND);

    Database.submissions.assign(
      submission.row,
      assignedTo
    );

    Database.audit.insert({

      TIMESTAMP: Utility.formatDateTime(),

      SUBMISSION_ID: submissionId,

      ACTION: "Assigned",

      MODULE: "Submission",

      OLD_STATUS: submission.data.STATUS,

      NEW_STATUS: submission.data.STATUS,

      PERFORMED_BY: assignedTo,

      ROLE: "",

      REMARKS: "",

      VERSION: Config.get("APP_VERSION")

    });

    return Utility.success(SUCCESS.UPDATED);

  }

  /**
   * ============================================================
   * UPDATE STATUS
   * ============================================================
   */

  function updateStatus(
    submissionId,
    status,
    reviewedBy,
    remarks,
    options
  ) {

    const lock = LockService.getScriptLock();

    if (!lock.tryLock(10000))
      return Utility.error("Another review update is in progress. Please try again.");

    try {

      let submission =
        Database.submissions.findBySubmissionId(submissionId);

      if (!submission)
        return Utility.error(ERROR.SUBMISSION_NOT_FOUND);

      if (releaseExpiredReviewLock(submission))
        return Utility.error(
          "The " + reviewLockLabel() + " review window expired. The submission was released as Submitted; claim it again before completing the review."
        );

      submission = Database.submissions.findBySubmissionId(submissionId);

      if (Utility.safeString(submission.data.STATUS) !== SUBMISSION_STATUS.UNDER_REVIEW)
        return Utility.error("This submission is not currently under review.");

      const reviewLock = reviewLockFor(submission);

      if (!reviewLock || reviewLock.expiresAt <= Date.now()) {
        releaseExpiredReviewLock(submission);
        return Utility.error(
          "The " + reviewLockLabel() + " review window expired. The submission was released as Submitted; claim it again before completing the review."
        );
      }

      if (Utility.safeString(reviewLock.username).toLowerCase() !==
          Utility.safeString(reviewedBy).toLowerCase() ||
          !isReviewOwner(submission, reviewedBy))
        return Utility.error("Only the reviewer who claimed this submission can approve or reject it.");

      const requestedQuickAction = Utility.safeString(
        options && options.quickAction
      ).toUpperCase();

      const ndrRequested = requestedQuickAction === "PUSH_NDR_CALLING";

      if (Calling.isCsrPushAttempt(remarks) && !ndrRequested)
        return Utility.error(
          'To push call to NDR please click on quick action button "Push For NDR Calling".'
        );

      if (ndrRequested && status !== SUBMISSION_STATUS.APPROVED)
        return Utility.error(
          "Push For NDR Calling is available only while approving a submission."
        );

      if (ndrRequested) {
        const setup = Calling.validateCsrInfrastructure();
        if (!setup.success) return setup;
        remarks = Calling.configuredPushRemark();
      }

      const reviewerUser = Database.users.findByUsername(reviewedBy);
      const reviewerRole = reviewerUser ? reviewerUser.data.ROLE : "";

      const completedAt = Date.now();
      const timestamp = Utility.formatDateTime(new Date(completedAt));

      Database.submissions.review(
        submission.row,
        reviewedBy,
        status,
        Utility.safeString(remarks)
      );

      Database.submissions.updateCell(
        submission.row,
        "REVIEW_TIME",
        calculateReviewTime(
          reviewLock.claimedAt || submission.data.LAST_UPDATED,
          completedAt
        )
      );

      clearReviewLock(submissionId);

      Database.audit.insert({
        TIMESTAMP: timestamp,
        SUBMISSION_ID: submissionId,
        ACTION: "Status Updated",
        MODULE: "Submission",
        OLD_STATUS: submission.data.STATUS,
        NEW_STATUS: status,
        PERFORMED_BY: reviewedBy,
        ROLE: reviewerRole,
        REMARKS: Utility.safeString(remarks),
        VERSION: Config.get("APP_VERSION")
      });

      if (ndrRequested) {
        /*
         * Database reads can be cached within this execution.  Do not reread the
         * submission here: the cached object may still contain the old manager
         * remark and would incorrectly stop the CSR ticket from being created.
         * Build the post-review record from the value that was just committed.
         */
        const reviewedSubmission = {
          row: submission.row,
          data: Object.assign({}, submission.data, {
            STATUS: status,
            ASSIGNED_TO: reviewedBy,
            REVIEWED_BY: reviewedBy,
            REVIEWED_ON: timestamp,
            LAST_UPDATED: timestamp,
            MANAGER_REMARKS: Utility.safeString(remarks)
          })
        };

        const ticketResult = Calling.createFromSubmission(
          reviewedSubmission,
          reviewerUser && reviewerUser.data
            ? Utility.safeString(reviewerUser.data.RIDER_NAME) || reviewedBy
            : reviewedBy,
          reviewerRole,
          { source: "RTO_QUICK_ACTION" }
        );

        if (!ticketResult.success) {
          return Utility.error(
            "Submission was approved, but the CSR ticket could not be created: " +
            ticketResult.message
          );
        }
      }

      return Utility.success(
        ndrRequested
          ? "Submission approved and sent to the CSR Calling Queue."
          : SUCCESS.UPDATED
      );

    } finally {

      lock.releaseLock();

    }

  }

  /**
   * ============================================================
   * APPROVE
   * ============================================================
   */

  function approveSubmission(
    submissionId,
    reviewedBy
  ) {

    return updateStatus(

      submissionId,

      SUBMISSION_STATUS.APPROVED,

      reviewedBy

    );

  }

  /**
   * ============================================================
   * REJECT
   * ============================================================
   */

  function rejectSubmission(
    submissionId,
    reviewedBy
  ) {

    return updateStatus(

      submissionId,

      SUBMISSION_STATUS.REJECTED,

      reviewedBy

    );

  }

  /**
   * ============================================================
   * REVIEW TIME
   * ============================================================
   */

function calculateReviewTime(reviewStartedOn, completedAt) {

    if (!reviewStartedOn) return "";

    const start = Utility.parseDateTime(reviewStartedOn);

    if (!start) return "";

    const finish = completedAt instanceof Date
      ? completedAt
      : isFinite(Number(completedAt))
        ? new Date(Number(completedAt))
        : new Date();

    if (isNaN(finish.getTime()) || finish.getTime() < start.getTime())
      return "";

    const diff = finish.getTime() - start.getTime();

    return Utility.formatElapsedMilliseconds(diff);

}

  /**
   * Repairs historic review-time values using the authoritative audit trail.
   * It only updates rows which have both a Review Claimed and final status
   * event, so existing data is never guessed or overwritten blindly.
   */
  function repairReviewTimesFromAudit() {

    const auditsBySubmission = {};

    Database.audit.list().forEach(audit => {
      const submissionId = Utility.safeString(audit.data.SUBMISSION_ID);

      if (!submissionId) return;

      if (!auditsBySubmission[submissionId])
        auditsBySubmission[submissionId] = [];

      auditsBySubmission[submissionId].push(audit);
    });

    let updated = 0;
    let repaired = 0;
    let direct = 0;
    let unavailable = 0;
    let skipped = 0;

    Database.submissions.list().forEach(submission => {
      const submissionId = Utility.safeString(submission.data.SUBMISSION_ID);
      const finalStatus = Utility.safeString(submission.data.STATUS);
      const events = auditsBySubmission[submissionId] || [];

      if ([SUBMISSION_STATUS.APPROVED, SUBMISSION_STATUS.REJECTED].indexOf(finalStatus) === -1) {
        skipped++;
        return;
      }

      const ordered = events.slice().sort((left, right) => {
        const leftTime = Utility.parseDateTime(left.data.TIMESTAMP);
        const rightTime = Utility.parseDateTime(right.data.TIMESTAMP);
        return (leftTime ? leftTime.getTime() : 0) - (rightTime ? rightTime.getTime() : 0);
      });

      let desiredReviewTime = "";

      const directApprovalEvent = ordered.slice().reverse().find(event => {
        const action = Utility.safeString(event.data.ACTION).toUpperCase();
        return action === "ADMIN DIRECT APPROVAL" ||
          action === "ADMIN BULK DIRECT APPROVAL";
      });

      if (directApprovalEvent) {
        desiredReviewTime = "0 Minutes";
        direct++;
      }

      let finalEvent = null;

      for (let index = ordered.length - 1; index >= 0; index--) {
        const event = ordered[index];

        if (Utility.safeString(event.data.ACTION).toUpperCase() === "STATUS UPDATED" &&
            Utility.safeString(event.data.NEW_STATUS).toUpperCase() === finalStatus) {
          finalEvent = event;
          break;
        }
      }

      if (!desiredReviewTime && finalEvent) {
        const finalTime = Utility.parseDateTime(finalEvent.data.TIMESTAMP);
        let claimedEvent = null;

        for (let index = ordered.indexOf(finalEvent) - 1; index >= 0; index--) {
          if (Utility.safeString(ordered[index].data.ACTION).toUpperCase() === "REVIEW CLAIMED") {
            claimedEvent = ordered[index];
            break;
          }
        }

        const claimedTime = claimedEvent && Utility.parseDateTime(claimedEvent.data.TIMESTAMP);

        if (finalTime && claimedTime && finalTime.getTime() >= claimedTime.getTime()) {
          desiredReviewTime = Utility.formatElapsedMilliseconds(
            finalTime.getTime() - claimedTime.getTime()
          );
          repaired++;
        }
      }

      if (!desiredReviewTime) {
        // There is no trustworthy claim timestamp for this historic record.
        // Do not calculate a fabricated duration from a formatted sheet date.
        desiredReviewTime = "Not available (legacy)";
        unavailable++;
      }

      if (Utility.safeString(submission.data.REVIEW_TIME) !== desiredReviewTime) {
        Database.submissions.updateCell(
          submission.row,
          "REVIEW_TIME",
          desiredReviewTime
        );

        updated++;
      }
    });

    return { updated, repaired, direct, unavailable, skipped };

  }

  /**
   * ============================================================
   * DELETE
   * ============================================================
   */

  function deleteSubmission(
    submissionId
  ) {

    const submission =
      Database.submissions.findBySubmissionId(submissionId);

    if (!submission)
      return Utility.error(ERROR.SUBMISSION_NOT_FOUND);

    Database.submissions.remove(
      submission.row
    );

    clearReviewLock(submissionId);

    Database.audit.insert({

      TIMESTAMP: Utility.formatDateTime(),

      SUBMISSION_ID: submissionId,

      ACTION: "Deleted",

      MODULE: "Submission",

      OLD_STATUS: submission.data.STATUS,

      NEW_STATUS: "",

      PERFORMED_BY: "",

      ROLE: "",

      REMARKS: "",

      VERSION: Config.get("APP_VERSION")

    });

    return Utility.success(SUCCESS.UPDATED);

  }

  /**
   * ============================================================
   * SEARCH
   * ============================================================
   */

  function search(orderNumber) {

    return Database.submissions.findByOrderNumber(
      Utility.safeString(orderNumber).toUpperCase()
    );

  }

  /**
   * ============================================================
   * STATISTICS
   * ============================================================
   */

  function statistics() {

    return {

      total:
        Database.submissions.count(),

      pending:
        Database.submissions.countByStatus(
          SUBMISSION_STATUS.PENDING
        ),

      approved:
        Database.submissions.countByStatus(
          SUBMISSION_STATUS.APPROVED
        ),

      rejected:
        Database.submissions.countByStatus(
          SUBMISSION_STATUS.REJECTED
        )

    };

  }

  /**
   * ============================================================
   * PUBLIC API
   * ============================================================
   */

return {

    create,

    bulkUploadContext,

    bulkCreate,

    get,

    list,

    mySubmissions,

    isReviewLockActive,

    releaseExpiredReviewLocks,

    claimForReview,

    assignSubmission,

    updateStatus,

    approveSubmission,

    rejectSubmission,

    deleteSubmission,

    search,

    statistics,

    calculateReviewTime,

    repairReviewTimesFromAudit

  };

})();

/**
 * Install this once from the Apps Script editor.  The time-driven trigger
 * releases locks even when no reviewer refreshes the portal.
 */
function installReviewLockExpiryTrigger() {

  const handler = "releaseExpiredReviewLocks";

  ScriptApp.getProjectTriggers()
    .filter(trigger => trigger.getHandlerFunction() === handler)
    .forEach(trigger => ScriptApp.deleteTrigger(trigger));

  ScriptApp.newTrigger(handler)
    .timeBased()
    .everyMinutes(1)
    .create();

}

/** Trigger handler; do not rename it after installing the trigger. */
function releaseExpiredReviewLocks() {

  return {
    rtoReleased: Submission.releaseExpiredReviewLocks(),
    csrReleased: Calling.releaseExpiredReviewLocks()
  };

}

/** Run manually once from the Apps Script editor to correct historic review times. */
function repairSubmissionReviewTimesFromAudit() {

  const result = Submission.repairReviewTimesFromAudit();

  const message = "Updated " + result.updated + " review-time row(s): " +
    result.repaired + " recalculated from review claim to final decision, " +
    result.direct + " direct approval row(s) set to 0 Minutes, " +
    result.unavailable + " legacy row(s) marked Not available (legacy). " +
    "Skipped " + result.skipped + " non-final row(s).";

  Logger.log(message);
  return message;

}
