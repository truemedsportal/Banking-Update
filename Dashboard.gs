/**
 * ============================================================
 * TRUE MEDS - RTO & REATTEMPT PORTAL
 * File      : Dashboard.gs
 * Purpose   : Dashboard & Analytics
 * Version   : 1.0
 * ============================================================
 */

const Dashboard = (() => {

  /**
   * ============================================================
   * DASHBOARD COUNTS
   * ============================================================
   */

  function counts() {

    return {

      total:
        Database.submissions.count(),

      pending:
        Database.submissions.countByStatus(
          SUBMISSION_STATUS.SUBMITTED
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

  function cleanStatus(status) {

  status = String(status || "").trim();

  if (status.indexOf("Submitted") > -1) return SUBMISSION_STATUS.SUBMITTED;
  if (status.indexOf("Under Review") > -1) return SUBMISSION_STATUS.UNDER_REVIEW;
  if (status.indexOf("Approved") > -1) return SUBMISSION_STATUS.APPROVED;
  if (status.indexOf("Rejected") > -1) return SUBMISSION_STATUS.REJECTED;

  return status;
}

  /**
 * ============================================================
 * USER DASHBOARD
 * ============================================================
 */

function userDashboard(username) {

  const records =
    Database.submissions.findByUsername(username);

  const total =
    records.length;
    
  const pending =
    records.filter(r =>
      cleanStatus(r.data.STATUS) === SUBMISSION_STATUS.SUBMITTED
    ).length;

  const underReview =
    records.filter(r =>
      cleanStatus(r.data.STATUS) === SUBMISSION_STATUS.UNDER_REVIEW
    ).length;

  const approved =
    records.filter(r =>
      cleanStatus(r.data.STATUS) === SUBMISSION_STATUS.APPROVED
    ).length;

  const rejected =
    records.filter(r =>
      cleanStatus(r.data.STATUS) === SUBMISSION_STATUS.REJECTED
    ).length;

  /* ----------------------------------------------------------
     Legitimacy Score
     ---------------------------------------------------------- */

  const reviewed = Math.max(0, total - pending - underReview);
  const legitimacy = reviewed === 0
      ? 0
      : Number(((approved / reviewed) * 100).toFixed(2));

  return {

    /* Existing fields (DO NOT REMOVE) */

    total,
    pending,
    approved,
    rejected,
    submissions: records,

    /* New fields */

    underReview,
    legitimacy

  };

}
  /**
   * ============================================================
   * MANAGER DASHBOARD
   * ============================================================
   */

  function managerDashboard(username) {

    const assigned =
      Database.submissions.byAssignee(username);

    return {

      assigned:

        assigned.length,

      pending:

        assigned.filter(r =>

          r.data.STATUS ===
          SUBMISSION_STATUS.SUBMITTED

        ).length,

      approved:

        assigned.filter(r =>

          r.data.STATUS ===
          SUBMISSION_STATUS.APPROVED

        ).length,

      rejected:

        assigned.filter(r =>

          r.data.STATUS ===
          SUBMISSION_STATUS.REJECTED

        ).length,

      submissions:

        assigned

    };

  }

  /**
   * ============================================================
   * PART 2 CONTINUES...
   * ============================================================
   */  /**
   * ============================================================
   * ADMIN DASHBOARD
   * ============================================================
   */

  function adminDashboard() {

    return {

      counts: counts(),

      pending:
        Database.submissions.pending(),

      approved:
        Database.submissions.approved(),

      rejected:
        Database.submissions.rejected(),

      recent:
        recentSubmissions()

    };

  }

  /**
   * ============================================================
   * SUPER ADMIN DASHBOARD
   * ============================================================
   */

  function superAdminDashboard() {

    return {

      counts: counts(),

      recent:
        recentSubmissions(),

      leaderboard:
        leaderboard(),

      zoneWise:
        zoneWise(),

      warehouseWise:
        warehouseWise(),

      hubWise:
        hubWise()

    };

  }

  /**
   * ============================================================
   * RECENT SUBMISSIONS
   * ============================================================
   */

  function recentSubmissions(limit) {

    limit = limit || 10;

    return Database.submissions
      .list()
      .sort(function (a, b) {

        const right = Utility.parseDateTime(b.data.TIMESTAMP);
        const left = Utility.parseDateTime(a.data.TIMESTAMP);

        return (right ? right.getTime() : 0) -
               (left ? left.getTime() : 0);

      })
      .slice(0, limit);

  }

  /**
   * ============================================================
   * ZONE WISE
   * ============================================================
   */

  function zoneWise() {

    const result = {};

    Database.submissions.list().forEach(function (item) {

      const zone =
        Utility.safeString(item.data.ZONE);

      if (!result[zone])
        result[zone] = 0;

      result[zone]++;

    });

    return result;

  }

  /**
   * ============================================================
   * WAREHOUSE WISE
   * ============================================================
   */

  function warehouseWise() {

    const result = {};

    Database.submissions.list().forEach(function (item) {

      const warehouse =
        Utility.safeString(item.data.WAREHOUSE);

      if (!result[warehouse])
        result[warehouse] = 0;

      result[warehouse]++;

    });

    return result;

  }

  /**
   * ============================================================
   * LM HUB WISE
   * ============================================================
   */

  function hubWise() {

    const result = {};

    Database.submissions.list().forEach(function (item) {

      const hub =
        Utility.safeString(item.data.LM_HUB);

      if (!result[hub])
        result[hub] = 0;

      result[hub]++;

    });

    return result;

  }

  /**
   * ============================================================
   * LEADERBOARD
   * ============================================================
   */

  function leaderboard() {

    const max = Number(Config.get("LEADERBOARD_COUNT"));

    if (!isFinite(max) || max < 1)
      throw new Error("Configuration setting 'LEADERBOARD_COUNT' must be a positive number.");

    const score = {};

    Database.submissions.list().forEach(function (item) {

      const user =
        Utility.safeString(item.data.USERNAME);

      if (!score[user]) {

        score[user] = {

          username: user,

          total: 0

        };

      }

      score[user].total++;

    });

    return Object
      .values(score)
      .sort(function (a, b) {

        return b.total - a.total;

      })
      .slice(0, max);

  }

  function leaderboardStatus(status) {
    return Utility.safeString(status).trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_");
  }

  function riderLeaderboard(actor) {
    const actorUsername = Utility.safeString(actor && actor.USERNAME).trim();
    if (!actorUsername) throw new Error("A signed-in rider is required.");

    const riders = Database.users.all()
      .map(record => record.data || {})
      .filter(user => leaderboardStatus(user.ROLE) === "RIDER" && leaderboardStatus(user.STATUS) === "ACTIVE");
    const byUsername = {};
    riders.forEach(user => {
      const username = Utility.safeString(user.USERNAME).trim();
      if (!username) return;
      byUsername[username.toLowerCase()] = {
        username,
        riderName: Utility.safeString(user.RIDER_NAME) || username,
        employeeId: Utility.safeString(user.EMPLOYEE_ID),
        zone: Utility.safeString(user.ZONE),
        warehouse: Utility.safeString(user.WAREHOUSE),
        lmHub: Utility.safeString(user.LM_HUB),
        profilePhoto: Auth.profilePhotoUrl(user.USER_PHOTO),
        total: 0,
        pending: 0,
        reviewed: 0,
        approved: 0,
        rejected: 0,
        legitimacy: 0,
        rewardTokens: 0,
        penaltyTokens: 0,
        availableCredits: 0
      };
    });

    Database.submissions.list().forEach(record => {
      const data = record.data || {};
      const username = Utility.safeString(data.USERNAME).trim().toLowerCase();
      const rider = byUsername[username];
      if (!rider) return;
      const status = leaderboardStatus(data.STATUS);
      rider.total++;
      if (["PENDING", "SUBMITTED", "UNDER_REVIEW", "REOPENED"].indexOf(status) !== -1) {
        rider.pending++;
      } else {
        rider.reviewed++;
        if (status === "APPROVED" || status === "ARCHIVED") rider.approved++;
        if (status === "REJECTED") rider.rejected++;
      }
    });

    const participants = Object.keys(byUsername).map(name => {
      const rider = byUsername[name];
      rider.legitimacy = rider.reviewed
        ? Number(((rider.approved / rider.reviewed) * 100).toFixed(2))
        : 0;
      rider.rewardTokens = Number((rider.approved * 2).toFixed(1));
      rider.penaltyTokens = Number((rider.rejected * 1.5).toFixed(1));
      rider.availableCredits = Number((rider.rewardTokens - rider.penaltyTokens).toFixed(1));
      return rider;
    }).filter(rider => rider.total > 0 && rider.reviewed > 0);

    const compare = (left, right) =>
      (right.total - left.total) ||
      (right.approved - left.approved) ||
      (right.legitimacy - left.legitimacy) ||
      (left.rejected - right.rejected) ||
      left.riderName.localeCompare(right.riderName);
    const samePerformance = (left, right) => !!left && !!right &&
      left.total === right.total && left.approved === right.approved &&
      left.legitimacy === right.legitimacy && left.rejected === right.rejected;
    const sameText = (left, right) => Utility.safeString(left).trim().toLowerCase() ===
      Utility.safeString(right).trim().toLowerCase();
    const actorStats = byUsername[actorUsername.toLowerCase()] || null;
    const limit = Math.max(3, Math.min(10, Number(Config.get("LEADERBOARD_COUNT")) || 5));

    function scope(name, label, predicate) {
      const sorted = participants.filter(predicate).sort(compare);
      let prior = null;
      let priorRank = 0;
      const ranked = sorted.map((rider, index) => {
        const rank = samePerformance(prior, rider) ? priorRank : index + 1;
        prior = rider;
        priorRank = rank;
        return Object.assign({}, rider, {
          rank,
          isCurrent: sameText(rider.username, actorUsername),
          rankReason: "Ranked by total submissions first (" + rider.total + "), then approvals (" +
            rider.approved + "), legitimacy (" + rider.legitimacy.toFixed(2) + "%), and fewer rejections."
        });
      });
      const current = ranked.find(rider => rider.isCurrent) || null;
      const leaders = ranked.slice(0, limit);
      if (current && leaders.every(rider => !rider.isCurrent)) leaders.push(current);
      return {
        name,
        label,
        participantCount: ranked.length,
        rank: current ? current.rank : null,
        current,
        leaders
      };
    }

    const noMatch = () => false;
    return {
      rule: "Total submissions is the first ranking criterion. Ties are decided by approved count, legitimacy percentage, fewer rejections, then rider name.",
      formula: "Legitimacy = Approved / (Total submissions - Pending submissions) × 100",
      current: actorStats,
      scopes: [
        scope("panIndia", "Pan India", () => true),
        scope("zone", actorStats && actorStats.zone ? actorStats.zone + " Zone" : "Zone", actorStats ? rider => sameText(rider.zone, actorStats.zone) : noMatch),
        scope("warehouse", actorStats && actorStats.warehouse ? actorStats.warehouse + " Warehouse" : "Warehouse", actorStats ? rider => sameText(rider.warehouse, actorStats.warehouse) : noMatch),
        scope("lmHub", actorStats && actorStats.lmHub ? actorStats.lmHub + " LM Hub" : "LM Hub", actorStats ? rider => sameText(rider.lmHub, actorStats.lmHub) : noMatch)
      ]
    };
  }

  /**
   * ============================================================
   * PUBLIC API
   * ============================================================
   */

  return {

    counts,

    userDashboard,

    managerDashboard,

    adminDashboard,

    superAdminDashboard,

    recentSubmissions,

    zoneWise,

    warehouseWise,

    hubWise,

    leaderboard,

    riderLeaderboard

  };

})();
