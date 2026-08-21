/**
 * ============================================================
 * TRUE MEDS - RTO & REATTEMPT PORTAL
 * File : Validation.gs
 * Purpose : Central Validation Library
 * Version : 2.0.0
 * ============================================================
 */

const Validation = (() => {

  /**
   * ------------------------------------------------------------
   * Empty Check
   * ------------------------------------------------------------
   */
  function required(value, fieldName) {

    if (Utility.safeString(value) !== "")
      return Utility.success();

    return Utility.error(
      (fieldName ? fieldName + " is required." : "This field is required.")
    );

  }

  /**
   * ------------------------------------------------------------
   * Username
   * ------------------------------------------------------------
   */
  function username(username) {

    username = Utility.safeString(username);

    const result = required(username);

    if (!result.success)
      return Utility.error(ERROR.INVALID_USERNAME);

    return Utility.success();

  }

  /**
   * ------------------------------------------------------------
   * Password
   * ------------------------------------------------------------
   */
  function password(password) {

    password = Utility.safeString(password);

    const result = required(password);

    if (!result.success)
      return Utility.error(ERROR.INVALID_PASSWORD);

    return Utility.success();

  }

  /**
   * ------------------------------------------------------------
   * Order Number
   * Digits Only
   * Max 11
   * Stored as TEXT
   * ------------------------------------------------------------
   */
  function orderNumber(orderNumber) {

    orderNumber = Utility.safeString(orderNumber);

    const result = required(orderNumber);

    if (!result.success)
      return Utility.error(ERROR.ORDER_REQUIRED);

    if (orderNumber.length > 11)
      return Utility.error(ERROR.ORDER_MAX_LENGTH);

    if (!/^[0-9]+$/.test(orderNumber))
      return Utility.error(ERROR.INVALID_ORDER_NUMBER);

    return Utility.success();

  }

  /**
   * ------------------------------------------------------------
   * Email
   * ------------------------------------------------------------
   */
  function email(email) {

    email = Utility.safeString(email);

    if (email === "")
      return Utility.success();

    const regex =
      /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (!regex.test(email))
      return Utility.error(ERROR.INVALID_EMAIL);

    return Utility.success();

  }

  /**
   * ------------------------------------------------------------
   * Phone
   * ------------------------------------------------------------
   */
  function phone(phone) {

    phone = Utility.safeString(phone);

    if (phone === "")
      return Utility.success();

    if (!/^[0-9]{10}$/.test(phone))
      return Utility.error(ERROR.INVALID_PHONE);

    return Utility.success();

  }

  /**
   * ------------------------------------------------------------
   * Upload Size
   * ------------------------------------------------------------
   */
  function fileSize(sizeBytes) {

    const configuredLimit = Number(Config.get("MAX_UPLOAD_SIZE_MB"));

    if (!isFinite(configuredLimit) || configuredLimit < 1)
      return Utility.error("Configuration setting 'MAX_UPLOAD_SIZE_MB' must be a positive number.");

    const limit = configuredLimit * 1024 * 1024;

    if (sizeBytes > limit)
      return Utility.error(ERROR.FILE_TOO_LARGE);

    return Utility.success();

  }

  /**
   * ------------------------------------------------------------
   * Mime Type
   * ------------------------------------------------------------
   */
  function mimeType(type) {

    if (SUPPORTED_MIME_TYPES.indexOf(type) === -1)
      return Utility.error(ERROR.INVALID_FILE_TYPE);

    return Utility.success();

  }

  /**
   * ------------------------------------------------------------
   * Generic Length
   * ------------------------------------------------------------
   */
  function maxLength(text, length) {

    text = Utility.safeString(text);

    if (text.length > length)
      return false;

    return true;

  }

  /**
   * ------------------------------------------------------------
   * Public API
   * ------------------------------------------------------------
   */

  return {

    required,

    username,

    password,

    orderNumber,

    email,

    phone,

    fileSize,

    mimeType,

    maxLength

  };

})();

