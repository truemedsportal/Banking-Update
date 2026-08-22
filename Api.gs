/**
 * Browser API gateway.
 *
 * Only apiCall() is public to google.script.run. All protected operations use
 * the session ID to identify the user; a username from the browser is never
 * trusted for access control.
 */
const API = (() => {

  function recordData(record) {
    return record && record.data ? record.data : (record || {});
  }

  function value(data, names) {
    const source = recordData(data);
    const keys = Object.keys(source);

    for (let i = 0; i < names.length; i++) {
      if (source[names[i]] !== undefined && source[names[i]] !== null)
        return source[names[i]];
    }

    for (let i = 0; i < names.length; i++) {
      const wanted = String(names[i]).replace(/[^A-Za-z0-9]/g, "").toUpperCase();
      const match = keys.find(key =>
        String(key).replace(/[^A-Za-z0-9]/g, "").toUpperCase() === wanted
      );

      if (match && source[match] !== undefined && source[match] !== null)
        return source[match];
    }

    return "";
  }

  function text(data, names) {
    const raw = value(data, names);
    if (raw instanceof Date) return Utility.formatDateTime(raw);
    return raw === null || raw === undefined ? "" : String(raw);
  }

  function userDto(user) {
    return {
      username: text(user, ["USERNAME", "username"]),
      riderName: text(user, ["RIDER_NAME", "riderName", "NAME"]),
      employeeId: text(user, ["EMPLOYEE_ID", "employeeId"]),
      zone: text(user, ["ZONE", "zone"]),
      warehouse: text(user, ["WAREHOUSE", "warehouse"]),
      lmHub: text(user, ["LM_HUB", "lmHub", "HUB"]),
      role: Auth.canonicalRole(text(user, ["ROLE", "role"])),
      access: text(user, ["ACCESS_SCOPE", "access"]),
      email: text(user, ["REGISTERED_EMAIL", "email"]),
      status: text(user, ["STATUS", "status"]),
      profilePhoto: Auth.profilePhotoUrl(value(user, ["USER_PHOTO", "User Photo", "profilePhoto"]))
    };
  }

  function submissionDto(record) {
    const data = recordData(record);

    return {
      submissionId: text(data, ["SUBMISSION_ID", "Submission ID", "submissionId"]),
      timestamp: text(data, ["TIMESTAMP", "Timestamp", "timestamp"]),
      username: text(data, ["USERNAME", "Username", "username"]),
      riderName: text(data, ["RIDER_NAME", "Rider Name", "riderName"]),
      employeeId: text(data, ["EMPLOYEE_ID", "Employee ID", "employeeId"]),
      zone: text(data, ["ZONE", "Zone", "zone"]),
      warehouse: text(data, ["WAREHOUSE", "Warehouse", "warehouse"]),
      lmHub: text(data, ["LM_HUB", "LM Hub", "lmHub"]),
      orderNumber: text(data, ["ORDER_NUMBER", "Order Number", "orderNumber"]),
      mandatoryProof: text(data, ["MANDATORY_PROOF", "Mandatory Proof", "mandatoryProof"]),
      optionalProof: text(data, ["OPTIONAL_PROOF", "Optional Proof", "optionalProof"]),
      reason: text(data, ["REASON", "Reason", "reason"]),
      status: text(data, ["STATUS", "Status", "status"]) || SUBMISSION_STATUS.PENDING,
      assignedTo: text(data, ["ASSIGNED_TO", "Assigned To", "assignedTo"]),
      reviewedBy: text(data, ["REVIEWED_BY", "Reviewed By", "reviewedBy"]),
      reviewedOn: text(data, ["REVIEWED_ON", "Reviewed On", "reviewedOn"]),
      lastUpdated: text(data, ["LAST_UPDATED", "Last Updated", "lastUpdated"]),
      reviewTime: text(data, ["REVIEW_TIME", "Review Time", "reviewTime"])
    };
  }

  function notificationDto(record) {
    const data = recordData(record);
    const readStatus = text(data, ["READ_STATUS", "Read Status", "readStatus"]);

    return {
      id: text(data, ["NOTIFICATION_ID", "Notification ID", "id"]),
      title: text(data, ["TITLE", "Title", "title"]),
      message: text(data, ["MESSAGE", "Message", "message"]),
      type: text(data, ["TYPE", "Type", "type"]),
      date: text(data, ["CREATED_ON", "Created On", "date"]),
      read: readStatus.toUpperCase() === "YES"
    };
  }

  function csrTicketDto(record) {
    const data = recordData(record);

    return {
      ticketId: text(data, ["CSR_TICKET_ID"]),
      submissionId: text(data, ["SUBMISSION_ID"]),
      orderNumber: text(data, ["ORDER_NUMBER"]),
      riderName: text(data, ["RIDER_NAME"]),
      employeeId: text(data, ["EMPLOYEE_ID"]),
      zone: text(data, ["ZONE"]),
      warehouse: text(data, ["WAREHOUSE"]),
      lmHub: text(data, ["LM_HUB"]),
      reason: text(data, ["REASON"]),
      mandatoryProof: text(data, ["MANDATORY_PROOF_LINK"]),
      optionalProof: text(data, ["OPTIONAL_PROOF_LINK"]),
      firstAttemptAt: text(data, ["FIRST_ATTEMPT_DELIVERY_DATE_TIME"]),
      lastAttemptAt: text(data, ["LAST_ATTEMPT_DELIVERY_DATE_TIME"]),
      priorSubmissionCount: text(data, ["PRIOR_SUBMISSION_COUNT"]),
      ndrPushedBy: text(data, ["NDR_PUSHED_BY"]),
      ndrPushedByRole: text(data, ["NDR_PUSHED_BY_ROLE"]),
      ndrPushedAt: text(data, ["NDR_PUSHED_DATE_TIME"]),
      rtoReviewedBy: text(data, ["RTO_REVIEWED_BY"]),
      rtoApprovedOn: text(data, ["RTO_APPROVED_ON"]),
      rtoManagerRemarks: text(data, ["RTO_MANAGER_REMARKS"]),
      createdAt: text(data, ["CSR_TICKET_CREATED_AT"]),
      finalStatus: text(data, ["CALLING_FINAL_STATUS"]),
      currentStatus: text(data, ["CURRENT_STATUS"]),
      currentAssignedAgent: text(data, ["CURRENT_ASSIGNED_AGENT"]),
      lastActivityAt: text(data, ["LAST_CSR_ACTIVITY_AT"]),
      reviewOpenedBy: text(data, ["CSR_REVIEW_OPENED_BY"]),
      reviewOpenedAt: text(data, ["CSR_REVIEW_OPENED_AT"]),
      reviewLockExpiresAt: text(data, ["CSR_REVIEW_LOCK_EXPIRES_AT"]),
      assignmentCompletedAt: text(data, ["CSR_ASSIGNMENT_COMPLETED_AT"]),
      assignmentReviewTime: text(data, ["CSR_ASSIGNMENT_REVIEW_TIME"]),
      finalOutcome: text(data, ["FINAL_OUTCOME"]),
      closedAt: text(data, ["CSR_CLOSED_AT"]),
      totalReviewTime: text(data, ["TOTAL_TIME_TAKEN_FOR_REVIEW"]),
      calls: [1, 2, 3].map(slot => ({
        slot,
        assignedBy: text(data, ["ASSIGNED_BY_" + slot]),
        assignedAt: text(data, ["CALL_" + slot + "_ASSIGNED_DATE_TIME"]),
        agentName: text(data, ["CALLING_AGENT_" + slot + "_NAME"]),
        openedAt: text(data, ["CALL_" + slot + "_REVIEW_OPENED_AT"]),
        remark: text(data, ["CALLING_" + slot + "_REMARK"]),
        completedAt: text(data, ["CALLING_" + slot + "_COMPLETED_DATE_TIME"]),
        completionTime: text(data, ["CALL_" + slot + "_ASSIGNMENT_TO_COMPLETION_TIME"])
      }))
    };
  }

  function summary(records, field) {
    const groups = {};

    records.forEach(record => {
      const name = text(record, [field]) || "Unspecified";
      const status = text(record, ["STATUS"]);

      if (!groups[name])
        groups[name] = { name, total: 0, pending: 0, approved: 0, rejected: 0 };

      groups[name].total++;

      switch (status) {
        case SUBMISSION_STATUS.SUBMITTED:
        case SUBMISSION_STATUS.PENDING:
        case SUBMISSION_STATUS.UNDER_REVIEW:
        case SUBMISSION_STATUS.REOPENED:
          groups[name].pending++;
          break;
        case SUBMISSION_STATUS.APPROVED:
        case SUBMISSION_STATUS.ARCHIVED:
          groups[name].approved++;
          break;
        case SUBMISSION_STATUS.REJECTED:
          groups[name].rejected++;
          break;
      }
    });

    return Object.values(groups).sort((left, right) => {
      if (right.pending !== left.pending)
        return right.pending - left.pending;

      if (right.total !== left.total)
        return right.total - left.total;

      return left.name.localeCompare(right.name);
    });
  }

    function normaliseRole(role) {
      const normalised = Utility.safeString(role).toUpperCase().replace(/\s+/g, "_");
      return normalised === "MANAGER" ? "HUB_MANAGER" : normalised;
    }

  function isManager(user) {
    const role = normaliseRole(user.ROLE);
    return ["HUB_MANAGER", "ADMIN", "SUPER_ADMIN"].indexOf(role) !== -1;
  }

  function isAdmin(user) {
    const role = normaliseRole(user.ROLE);
    return role === "ADMIN" || role === "SUPER_ADMIN";
  }

  function requireSession(sessionId) {
    return Auth.validateSession(sessionId) || null;
  }

  function accessError(user, predicate) {
    return predicate(user) ? null : Utility.error(ERROR.ACCESS_DENIED);
  }

  function canAccessSubmission(user, record) {
    if (!record) return false;

    if (normaliseRole(user.ROLE) === "RIDER") {
      return Utility.safeString(record.data.USERNAME).toLowerCase() ===
        Utility.safeString(user.USERNAME).toLowerCase();
    }

    return Database.submissions.byScope(user).some(item => item.row === record.row);
  }

  function isReviewLockedByAnotherUser(user, record) {

    return Utility.safeString(record && record.data.STATUS) ===
        SUBMISSION_STATUS.UNDER_REVIEW &&
      Submission.isReviewLockActive(record) &&
      Utility.safeString(record.data.ASSIGNED_TO).toLowerCase() !==
        Utility.safeString(user.USERNAME).toLowerCase();

  }

  function pendingRecordsForUser(user) {

    let records = Database.submissions.byScope(user);

    // Reconcile time-expired locks before anyone sees the pending queue.
    Submission.releaseExpiredReviewLocks(records);
    records = Database.submissions.byScope(user);

    return records.filter(record => {
      const status = Utility.safeString(record.data.STATUS);

      if (status === SUBMISSION_STATUS.SUBMITTED) return true;

      return status === SUBMISSION_STATUS.UNDER_REVIEW &&
        Submission.isReviewLockActive(record) &&
          Utility.safeString(record.data.ASSIGNED_TO).toLowerCase() ===
            Utility.safeString(user.USERNAME).toLowerCase();
    });

  }

  function dashboardCounts(user) {
    const data = Dashboard.userDashboard(user.USERNAME);

    return Utility.success(SUCCESS.FETCHED, {
      total: data.total || 0,
      pending: data.pending || 0,
      approved: data.approved || 0,
      rejected: data.rejected || 0,
      underReview: data.underReview || 0,
      legitimacy: data.legitimacy || 0
    });
  }

  function adminDashboard(user) {
    let records = Database.submissions.byScope(user);

    Submission.releaseExpiredReviewLocks(records);
    records = Database.submissions.byScope(user);

    const pending = records.filter(record => {
      const status = Utility.safeString(record.data.STATUS);
      return status === SUBMISSION_STATUS.SUBMITTED || status === SUBMISSION_STATUS.UNDER_REVIEW;
    }).length;

    const recentActivity = records.slice()
      .sort((left, right) => {
        const rightDate = Utility.parseDateTime(
          right.data.LAST_UPDATED || right.data.TIMESTAMP
        );
        const leftDate = Utility.parseDateTime(
          left.data.LAST_UPDATED || left.data.TIMESTAMP
        );
        return (rightDate ? rightDate.getTime() : 0) - (leftDate ? leftDate.getTime() : 0);
      })
      .slice(0, 10)
      .map(submissionDto);

    return Utility.success(SUCCESS.FETCHED, {
      total: records.length,
      pending,
      approved: records.filter(record => record.data.STATUS === SUBMISSION_STATUS.APPROVED).length,
      rejected: records.filter(record => record.data.STATUS === SUBMISSION_STATUS.REJECTED).length,
      zoneWise: summary(records, "ZONE"),
      warehouseWise: summary(records, "WAREHOUSE"),
      hubWise: summary(records, "LM_HUB"),
      recentActivity
    });
  }

  function dispatch(action, sessionId, args) {
    args = Array.isArray(args) ? args : [];

    if (action === "login") return Auth.login(args[0], args[1]);

    // This contains display-only values used by the separately hosted PWA.
    // It intentionally returns no sheet IDs, secrets, user data or session data.
    if (action === "externalBootstrap") {
      return Utility.success(SUCCESS.FETCHED, {
        name: Utility.safeString(Config.get("APP_NAME")),
        version: Utility.safeString(Config.get("APP_VERSION")),
        company: Utility.safeString(Config.get("COMPANY_NAME")),
        logoUrl: Utility.safeString(Config.get("APP_LOGO_URL")),
        themeColor: Utility.safeString(Config.get("APP_THEME_COLOR")),
        darkModeEnabled: Utility.safeString(Config.get("ENABLE_DARK_MODE")).toLowerCase() === "yes",
        translationEnabled: Utility.safeString(Config.get("ENABLE_TRANSLATION")).toLowerCase() === "yes"
      });
    }

    if (action === "validateSession") {
      const user = requireSession(sessionId);
      return user
        ? Utility.success(SUCCESS.FETCHED, { sessionId, user: userDto(user) })
        : Utility.error(ERROR.SESSION_EXPIRED);
    }

    const user = requireSession(sessionId);
    if (!user) return Utility.error(ERROR.SESSION_EXPIRED);

    switch (action) {
      case "logout":
        return Auth.logout(user.USERNAME, sessionId);

      case "changePassword":
        return Auth.changePassword(user.USERNAME, args[1], args[2]);

      case "userManagementContext":
        return UserManagement.list(user);
      
      case "managedUserAvailability":
       return UserManagement.availability(user, args[0] || {});

      case "createManagedUser":
        return UserManagement.create(user, args[0]);

      case "updateManagedUser":
        return UserManagement.update(user, args[0], args[1]);

      case "bankingContext":
        return Banking.context(user);

      case "bankingUploadSlip":
        return Banking.uploadSlip(user, args[0] || {});

      case "bankingPreflight":
        return Banking.preflight(user, args[0] || {});

      case "bankingSubmit":
        return Banking.submit(user, args[0] || {});

      case "bankingRepository":
        return Banking.search(user, args[0] || {});

      case "bankingBulk":
        return Banking.bulk(user, args[0] || {});

      case "bankingResendEmail":
        return Banking.resendEmail(user, args[0]);

      case "bankingMailAuthorization":
        return Banking.mailAuthorization(user);

      case "bankingBatch":
        return Banking.batch(user, args[0]);

      case "translateUserManual":
        return ManualTranslation.translate(user, args[0] || {});

      case "attendanceMine":
        return Utility.success(SUCCESS.FETCHED, Attendance.mine(user));

      case "attendanceDashboard":
        return Utility.success(SUCCESS.FETCHED, Attendance.riderDashboard(user));

      case "attendanceCalendar":
        return Utility.success(SUCCESS.FETCHED, Attendance.attendanceCalendar(user, args[0]));

      case "attendanceCorrectionRiders":
        return Utility.success(SUCCESS.FETCHED, Attendance.correctionRiderOptions(user));

      case "attendanceCorrection":
        return Attendance.correctAttendance(user, args[0] || {});

      case "attendanceSubmit":
        return Attendance.submit(user, args[0] || {});

      case "attendanceQueue":
        return Utility.success(SUCCESS.FETCHED, Attendance.queue(user));

      case "attendanceApprovedKm":
        return Utility.success(SUCCESS.FETCHED, Attendance.approvedKm(user));

      case "attendanceAction":
        return Attendance.act(user, args[0], args[1], args[2]);

      case "attendanceEditKm":
        return Attendance.editKm(user, args[0], args[1], args[2], args[3]);

      case "attendanceCounts":
        return Utility.success(SUCCESS.FETCHED, Attendance.counts(user));

      case "attendanceWorkspace":
        return Utility.success(SUCCESS.FETCHED, Attendance.workspace(user, args[0]));

      case "attendanceRepository":
        return Utility.success(SUCCESS.FETCHED, Attendance.repository(user, args[0] || {}));

      case "attendanceRiderOptions":
        return Utility.success(SUCCESS.FETCHED, Attendance.riderOptions(user));

      case "pendingQueueCount": {
        const error = accessError(user, isManager);
        return error || Utility.success(SUCCESS.FETCHED, pendingRecordsForUser(user).length);
      }

      case "navigationCounts": {
        const error = accessError(user, isManager);
        if (error) return error;
        return Utility.success(SUCCESS.FETCHED, {
          regularization: Attendance.counts(user).regularization,
          pendingRequests: pendingRecordsForUser(user).length
        });
      }

      case "zoneAdminAttendanceEntry":
        return Attendance.zoneAdminEntry(user, args[0] || {});

      case "rosterList":
        return Utility.success(SUCCESS.FETCHED, Roster.list(user, args[0], args[1]));

      case "uploadRoster":
        return Roster.upload(user, args[0] || []);

      case "myLeaveRequests":
        return Utility.success(SUCCESS.FETCHED, Roster.myLeaves(user));

      case "applyUnpaidLeave":
        return Roster.applyLeave(user, args[0] || {});

      case "leaveQueue":
        return Utility.success(SUCCESS.FETCHED, Roster.leaveQueue(user));

      case "leaveAction":
        return Roster.actionLeave(user, args[0], args[1]);

      case "createSubmission": {
        const data = args[0] && typeof args[0] === "object" ? args[0] : {};
        data.username = user.USERNAME;
        return Submission.create(data);
      }

      case "bulkUploadContext": {
        const error = accessError(user, isAdmin);
        return error || Submission.bulkUploadContext(user.USERNAME);
      }

      case "bulkCreateSubmissions": {
        const error = accessError(user, isAdmin);
        if (error) return error;

        const rows = Array.isArray(args[0]) ? args[0] : [];
        const location = args[1] && typeof args[1] === "object" ? args[1] : {};

        return Submission.bulkCreate(user.USERNAME, rows, location);
      }

      case "mySubmissions":
        return Utility.success(SUCCESS.FETCHED, Submission.mySubmissions(user.USERNAME).map(submissionDto));

      case "getSubmission": {
        let record = Submission.get(args[0]);
        if (!record) return Utility.error(ERROR.SUBMISSION_NOT_FOUND);
        if (!canAccessSubmission(user, record)) return Utility.error(ERROR.ACCESS_DENIED);

        Submission.releaseExpiredReviewLocks([record]);
        record = Submission.get(args[0]);

        if (isReviewLockedByAnotherUser(user, record))
          return Utility.error("This submission is currently being reviewed by another user.");
        return Utility.success(SUCCESS.FETCHED, submissionDto(record));
      }

      case "dashboardCounts":
        return dashboardCounts(user);

      case "pendingRequests": {
        const error = accessError(user, isManager);
        return error || Utility.success(
          SUCCESS.FETCHED,
          pendingRecordsForUser(user).map(submissionDto)
        );
      }

      case "pendingLocationOptions": {
        const error = accessError(user, isManager);
        return error || Utility.success(SUCCESS.FETCHED, Config.locations());
      }

      case "pendingWorkspace": {
        const error = accessError(user, isManager);
        if (error) return error;
        const records = pendingRecordsForUser(user).map(submissionDto);
        return Utility.success(SUCCESS.FETCHED, {
          requests: records,
          locations: Config.locations(),
          count: records.length
        });
      }

      case "claimReview": {
        const error = accessError(user, isManager);
        if (error) return error;
        const record = Submission.get(args[0]);
        if (!canAccessSubmission(user, record)) return Utility.error(ERROR.ACCESS_DENIED);
        return Submission.claimForReview(args[0], user.USERNAME);
      }

      case "updateStatus": {
        const error = accessError(user, isManager);
        if (error) return error;
        const status = args[1];
        if ([SUBMISSION_STATUS.APPROVED, SUBMISSION_STATUS.REJECTED].indexOf(status) === -1)
          return Utility.error("Invalid submission status.");
        const record = Submission.get(args[0]);
        if (!canAccessSubmission(user, record)) return Utility.error(ERROR.ACCESS_DENIED);
        const reviewOptions =
          args[3] && typeof args[3] === "object" ? args[3] : {};
        return Submission.updateStatus(
          args[0],
          status,
          user.USERNAME,
          args[2],
          reviewOptions
        );
      }

      case "getReasons":
        return Utility.success(SUCCESS.FETCHED, Database.reasons.byRole(user.ROLE)
          .map(record => ({
            reason: record.data.REASON,
            mandatoryProof: ["TRUE", "YES"].indexOf(Utility.safeString(record.data.MANDATORY_PROOF).toUpperCase()) !== -1,
            optionalProof: ["TRUE", "YES"].indexOf(Utility.safeString(record.data.OPTIONAL_PROOF).toUpperCase()) !== -1
          }))
          .filter(item => item.reason));

      case "csrLocationOptions": {
        const error = accessError(user, Calling.isCsrUser);
        return error || Utility.success(SUCCESS.FETCHED, Config.locations());
      }

      case "csrCallingAgents": {
        const error = accessError(user, Calling.isCsrAdmin);
        return error || Utility.success(SUCCESS.FETCHED, Calling.callingAgents().map(record => ({
          username: text(record.data, ["USERNAME"]),
          name: text(record.data, ["RIDER_NAME"]) || text(record.data, ["USERNAME"]),
          employeeId: text(record.data, ["EMPLOYEE_ID"]),
          zone: text(record.data, ["ZONE"]),
          warehouse: text(record.data, ["WAREHOUSE"]),
          lmHub: text(record.data, ["LM_HUB"])
        })));
      }

      case "csrDashboard": {
        const error = accessError(user, Calling.isCsrUser);
        if (error) return error;
        const data = Calling.dashboard(user);
        data.recent = data.recent.map(csrTicketDto);
        return Utility.success(SUCCESS.FETCHED, data);
      }

      case "csrAdminQueue": {
        const error = accessError(user, Calling.isCsrAdmin);
        if (error) return error;
        const filters = args[0] && typeof args[0] === "object" ? args[0] : {};
        return Utility.success(SUCCESS.FETCHED, Calling.listForAdmin(user, filters).map(csrTicketDto));
      }

      case "csrAgentQueue": {
        const error = accessError(user, Calling.isCallingAgent);
        if (error) return error;
        const filters = args[0] && typeof args[0] === "object" ? args[0] : {};
        return Utility.success(SUCCESS.FETCHED, Calling.listForAgent(user, filters).map(csrTicketDto));
      }

      case "getCsrTicket": {
        const error = accessError(user, Calling.isCsrUser);
        if (error) return error;
        const ticket = Database.calling.findByTicketId(args[0]);
        if (!ticket) return Utility.error("CSR ticket not found.");
        Calling.releaseExpiredReviewLocks([ticket]);
        const refreshed = Database.calling.findByTicketId(args[0]);
        if (!Calling.canAccessTicket(user, refreshed)) return Utility.error(ERROR.ACCESS_DENIED);
        return Utility.success(SUCCESS.FETCHED, csrTicketDto(refreshed));
      }

      case "claimCsrAdminReview": {
        const error = accessError(user, Calling.isCsrAdmin);
        return error || Calling.claimAdminReview(args[0], user);
      }

      case "assignCsrTickets": {
        const error = accessError(user, Calling.isCsrAdmin);
        return error || Calling.assignTickets(args[0], args[1], Number(args[2]), user);
      }

      case "claimCsrCallReview": {
        const error = accessError(user, Calling.isCallingAgent);
        return error || Calling.claimCallReview(args[0], user);
      }

      case "completeCsrCall": {
        const error = accessError(user, Calling.isCallingAgent);
        return error || Calling.completeCall(args[0], args[1], args[2], user);
      }

      case "csrReasons": {
        const error = accessError(user, Calling.isCallingAgent);
        return error || Utility.success(SUCCESS.FETCHED, Calling.csrReasons().map(record => text(record.data, ["REASON"])));
      }

      case "csrClosingOutcomes": {
        const error = accessError(user, Calling.isCallingAgent);
        return error || Utility.success(SUCCESS.FETCHED, Calling.closingOutcomes());
      }

      case "csrRepository": {
        const error = accessError(user, Calling.isCsrAdmin);
        if (error) return error;
        const filters = args[0] && typeof args[0] === "object" ? args[0] : {};
        return Utility.success(SUCCESS.FETCHED, Calling.listForAdmin(user, filters).map(csrTicketDto));
      }

      case "syncCsrTickets": {
        const error = accessError(user, Calling.isCsrAdmin);
        return error || Calling.syncMissingTickets(user);
      }

      case "adminDashboard": {
        const error = accessError(user, isAdmin);
        return error || adminDashboard(user);
      }

      case "notifications":
        return Utility.success(SUCCESS.FETCHED, Notification.userNotifications(user.USERNAME).map(notificationDto));

      case "unreadNotificationCount":
        return Utility.success(SUCCESS.FETCHED, Notification.unreadCount(user.USERNAME));

      case "markNotificationRead": {
        const notification = Notification.get(args[0]);
        if (!notification) return Utility.error(ERROR.NOTIFICATION_NOT_FOUND);
        if (Utility.safeString(notification.data.USERNAME).toLowerCase() !== Utility.safeString(user.USERNAME).toLowerCase())
          return Utility.error(ERROR.ACCESS_DENIED);
        return Notification.markRead(args[0]);
      }

      case "markAllNotificationsRead":
        return Notification.markAllRead(user.USERNAME);

      case "repositorySearch": {
        const error = accessError(user, isAdmin);
        if (error) return error;
        const searchType = Utility.safeString(args[0]);
        const searchValue = Utility.safeString(args[1]);
        const dateRange = args[2] && typeof args[2] === "object" ? args[2] : {};

        if (Utility.safeString(dateRange.start) &&
            Utility.safeString(dateRange.end) &&
            Utility.safeString(dateRange.start) > Utility.safeString(dateRange.end))
          return Utility.error("The repository end date must not be earlier than the start date.");

        let records;

        switch (searchType) {
          case "submission": records = Repository.searchSubmission(searchValue, dateRange); break;
          case "order": records = Repository.searchOrder(searchValue, dateRange); break;
          case "employee": records = Repository.searchEmployee(searchValue, dateRange); break;
          case "username": records = Repository.searchUsername(searchValue, dateRange); break;
          case "zone": records = Repository.searchZone(searchValue, dateRange); break;
          case "warehouse": records = Repository.searchWarehouse(searchValue, dateRange); break;
          case "hub": records = Repository.searchHub(searchValue, dateRange); break;
          default: return Utility.error("Invalid repository search type.");
        }

        return Utility.success(SUCCESS.FETCHED, records.map(submissionDto));
      }

      case "repositoryOrderHistory": {
        const error = accessError(user, isAdmin);
        if (error) return error;

        const dateRange = args[1] && typeof args[1] === "object" ? args[1] : {};

        if (Utility.safeString(dateRange.start) &&
            Utility.safeString(dateRange.end) &&
            Utility.safeString(dateRange.start) > Utility.safeString(dateRange.end))
          return Utility.error("The repository end date must not be earlier than the start date.");

        return Utility.success(
          SUCCESS.FETCHED,
          Repository.searchOrderHistory(args[0], dateRange)
        );
      }

      case "uploadFile":
        return FileUpload.uploadBase64(args[0], args[1], args[2]);

      case "appInfo":
        return Utility.success(SUCCESS.FETCHED, {
          name: Config.get("APP_NAME"),
          version: Config.get("APP_VERSION"),
          company: Config.get("COMPANY_NAME")
        });

      default:
        return Utility.error("Unsupported request.");
    }
  }

  return { dispatch };
})();

function apiCall(action, sessionId) {
  const args = Array.prototype.slice.call(arguments, 2);

  try {
    return API.dispatch(Utility.safeString(action), Utility.safeString(sessionId), args);
  } catch (error) {
    console.error(error && error.stack ? error.stack : error);

    // Return a useful message to the portal instead of collapsing every
    // Drive/Sheets failure into "Something went wrong". This is particularly
    // important for file submissions, where the user can correct the file or
    // an administrator can correct the configured Drive link.
    const message = Utility.safeString(error && error.message);

    return Utility.error(
      message
        ? "Unable to complete the request: " + message
        : "Unable to complete the request. Please try again."
    );
  }
}
