/**
 * ============================================================
 * TRUE MEDS - RTO & REATTEMPT PORTAL
 * File      : Auth.gs
 * Purpose   : Authentication Module
 * Version   : 3.0
 * ============================================================
 */

const Auth = (() => {

  const SESSION_PREFIX = "rto.session.";

  /**
   * ============================================================
   * PASSWORD HASH
   * ============================================================
   */

  function hash(password) {

    const bytes = Utilities.computeDigest(
      Utilities.DigestAlgorithm.SHA_256,
      Utility.safeString(password)
    );

    return bytes
      .map(b => {
        const value = (b < 0 ? b + 256 : b).toString(16);
        return ("0" + value).slice(-2);
      })
      .join("");

  }

  /**
   * ============================================================
   * VERIFY PASSWORD
   * ============================================================
   */

  function verify(password, passwordHash) {

    return hash(password) === passwordHash;

  }

  /**
   * ============================================================
   * SESSION ID
   * ============================================================
   */

  function sessionId() {

    return Utility.uuid();

  }

  function sessionDurationMs() {
    // Attendance operations may take time; all portal sessions are intentionally 10 hours.
    return 10 * 60 * 60 * 1000;

  }

  function sessionKey(id) {
    return SESSION_PREFIX + Utility.safeString(id);
  }

  function sessionUserKey(id) {
    return sessionKey(id) + ".user";
  }
  function canonicalRole(value) {
    const role = Utility.safeString(value).trim();
    const key = role.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
    return key === "MANAGER" ? "Hub Manager" : role;
    }

  /**
   * Returns a browser-safe image URL from the User Photo cell.  The column can
   * hold either a normal https URL or a Google Sheets in-cell image.
   */
  function profilePhotoUrl(value) {
    var url = "";
    if (typeof value === "string") {
      url = value;
    } else if (value && typeof value === "object") {
      url = value.url || value.webViewLink || value.photoUrl || "";
    }
    url = Utility.safeString(url).trim();
    if (!url) return "";

    var directId = /^[A-Za-z0-9_-]{15,}$/.test(url) ? url : "";
    var match = url.match(/[?&]id=([A-Za-z0-9_-]+)/) ||
      url.match(/\/d\/([A-Za-z0-9_-]+)/);
    var fileId = directId || (match && match[1]);

    if (fileId) {
      return "https://drive.google.com/thumbnail?id=" +
        encodeURIComponent(fileId) + "&sz=w400";
    }
    return /^https?:\/\//i.test(url) ? url : "";
  }


  function storeSession(id, username, userData) {

    const key = sessionKey(id);
    const payload = JSON.stringify({
        username: Utility.safeString(username),
        expiresAt: Date.now() + sessionDurationMs()
      });

    PropertiesService.getScriptProperties().setProperty(key, payload);
    CacheService.getScriptCache().put(key, payload, 300);
    if (userData) {
      CacheService.getScriptCache().put(
        sessionUserKey(id),
        JSON.stringify(userData),
        30
      );
    }

  }

  function readSession(id) {

    const key = sessionKey(id);
    const cache = CacheService.getScriptCache();
    const properties = PropertiesService.getScriptProperties();
    const raw = cache.get(key) || properties.getProperty(key);

    if (!raw) return null;

    try {
      const session = JSON.parse(raw);

      if (!session.expiresAt || Number(session.expiresAt) <= Date.now()) {
        cache.remove(key);
        cache.remove(sessionUserKey(id));
        properties.deleteProperty(key);
        return null;
      }

      // A short cache avoids repeated Script Properties reads during a page
      // load while PropertiesService remains the durable 10-hour store.
      cache.put(key, raw, 300);

      return session;
    } catch (error) {
      cache.remove(key);
      cache.remove(sessionUserKey(id));
      properties.deleteProperty(key);
      return null;
    }

  }

  function deleteSession(id) {

    if (Utility.safeString(id)) {
      const key = sessionKey(id);
      CacheService.getScriptCache().remove(key);
      CacheService.getScriptCache().remove(sessionUserKey(id));
      PropertiesService.getScriptProperties().deleteProperty(key);
    }

  }

  /**
   * ============================================================
   * FIND USER
   * ============================================================
   */

  function findUser(username) {

    return Database.users.findByUsername(username);

  }

  /**
   * ============================================================
   * LOGIN
   * ============================================================
   */

function login(username, password) {

  username = Utility.safeString(username);
  password = Utility.safeString(password);


    let result;

    result = Validation.username(username);
    if (!result.success) return result;

    result = Validation.password(password);
    if (!result.success) return result;

    const user = findUser(username);

    if (!user)
      return Utility.error(ERROR.USER_NOT_FOUND);

    const data = user.data;

    if (Utility.safeString(data.STATUS) !== STATUS.ACTIVE)
      return Utility.error(ERROR.ACCOUNT_INACTIVE);

    if (Utility.safeString(data.LOCKED).toUpperCase() === "YES")
      return Utility.error(ERROR.ACCOUNT_LOCKED);

    if (!verify(password, data.PASSWORD)) {

      const attempts =
        Database.users.incrementFailedAttempts(user);

      const maxAttempts = Number(Config.get("MAX_FAILED_LOGIN"));
      if (!isFinite(maxAttempts) || maxAttempts < 1)
        throw new Error("Configuration setting 'MAX_FAILED_LOGIN' must be a positive number.");

      if (attempts >= maxAttempts) {

        Database.users.lock(user.row);

        return Utility.error(ERROR.ACCOUNT_LOCKED);

      }

      return Utility.error(ERROR.INVALID_PASSWORD);

    }

    Database.users.resetFailedAttempts(user.row);

    const id = sessionId();

    deleteSession(data.SESSION_ID);

    Database.users.saveSession(
      user.row,
      id
    );

    storeSession(id, data.USERNAME, data);

    return Utility.success(
      SUCCESS.LOGIN,
      {
        sessionId: id,
        username: data.USERNAME,
        riderName: data.RIDER_NAME,
        employeeId: data.EMPLOYEE_ID,
        zone: data.ZONE,
        warehouse: data.WAREHOUSE,
        lmHub: data.LM_HUB,
        role: canonicalRole(data.ROLE),
        access: data.ACCESS_SCOPE,
        email: data.REGISTERED_EMAIL,
        status: data.STATUS,
        profilePhoto: profilePhotoUrl(data.USER_PHOTO)
      }
    );

  }

  /**
   * ============================================================
   * LOGOUT
   * ============================================================
   */
  function logout(username, activeSessionId) {

    const user = findUser(username);

    if (!user)
      return Utility.error(ERROR.USER_NOT_FOUND);

    deleteSession(activeSessionId || user.data.SESSION_ID);

    Database.users.clearSession(user.row);

    return Utility.success(
      SUCCESS.LOGOUT
    );

  }

  /**
   * ============================================================
   * VALIDATE SESSION
   * ============================================================
   */

  function validateSession(sessionId) {

    sessionId = Utility.safeString(sessionId);

    if (!sessionId)
      return null;

    const session = readSession(sessionId);

    if (!session)
      return null;

    // A page opens several independent Apps Script executions at once. Reuse
    // the already-validated user briefly so those calls do not each rescan the
    // User Master sheet. The short TTL still rechecks status and lock changes.
    const cachedUser = CacheService.getScriptCache().get(sessionUserKey(sessionId));
    if (cachedUser) {
      try { return JSON.parse(cachedUser); } catch (error) {}
    }

    const user = Database.users.findBySession(sessionId);

    if (!user)
      return null;

    if (
      Utility.safeString(session.username).toLowerCase() !==
      Utility.safeString(user.data.USERNAME).toLowerCase()
    ) {
      return null;
    }

    if (
      Utility.safeString(user.data.STATUS) !== STATUS.ACTIVE ||
      Utility.safeString(user.data.LOCKED).toUpperCase() === "YES"
    ) {

      return null;

    }

    CacheService.getScriptCache().put(
      sessionUserKey(sessionId),
      JSON.stringify(user.data),
      30
    );

    return user.data;

  }

  /**
   * ============================================================
   * CHANGE PASSWORD
   * ============================================================
   */

  function changePassword(username, oldPassword, newPassword) {

    const user = findUser(username);

    if (!user)
      return Utility.error(ERROR.USER_NOT_FOUND);

    if (!verify(oldPassword, user.data.PASSWORD))
      return Utility.error(ERROR.INVALID_PASSWORD);

    const result = Validation.password(newPassword);

    if (!result.success)
      return result;

    Database.users.updateCell(
      user.row,
      "PASSWORD",
      hash(newPassword)
    );

    return Utility.success(
      SUCCESS.PASSWORD_CHANGED
    );

  }

  /**
   * ============================================================
   * RESET PASSWORD
   * ============================================================
   */

  function resetPassword(username, newPassword) {

    const user = findUser(username);

    if (!user)
      return Utility.error(ERROR.USER_NOT_FOUND);

    const result = Validation.password(newPassword);

    if (!result.success)
      return result;

    Database.users.updateCell(
      user.row,
      "PASSWORD",
      hash(newPassword)
    );

    Database.users.resetFailedAttempts(user.row);

    Database.users.unlock(user.row);

    deleteSession(user.data.SESSION_ID);
    Database.users.clearSession(user.row);

    return Utility.success(
      SUCCESS.PASSWORD_RESET
    );

  }

  /**
   * ============================================================
   * UNLOCK USER
   * ============================================================
   */

  function unlockUser(username) {

    const user = findUser(username);

    if (!user)
      return Utility.error(ERROR.USER_NOT_FOUND);

    Database.users.unlock(user.row);

    Database.users.resetFailedAttempts(user.row);

    return Utility.success(
      SUCCESS.USER_UNLOCKED
    );

  }

  /**
   * ============================================================
   * PUBLIC API
   * ============================================================
   */

  return {

    hash,
    verify,

    sessionId,

    sessionDurationMs,

    findUser,

    login,
    logout,

    deleteSession,

    profilePhotoUrl,

    validateSession,

    changePassword,
    resetPassword,

    unlockUser

  };

})();
