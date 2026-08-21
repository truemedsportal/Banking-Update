/**
 * ============================================================
 * TRUE MEDS - RTO & REATTEMPT PORTAL
 * File      : Constants.gs
 * Purpose   : Application Constants
 * Version   : 2.0.0
 * ============================================================
 */


/* ============================================================
 * APP
 * ============================================================ */

const APP = {

  // Display values are read from the Configuration sheet at runtime.
  // These keys only document the configuration contract for server code.
  NAME_SETTING: "APP_NAME",

  VERSION_SETTING: "APP_VERSION",

  COMPANY_SETTING: "COMPANY_NAME"

};
/* ============================================================
 * USER ROLES
 * ============================================================ */

const ROLE = {

  RIDER: "Rider",

  HUB_MANAGER: "Hub Manager",

  ADMIN: "Admin",

  SUPER_ADMIN: "Super Admin",

  CALLING_AGENT: "Calling Agent"

};
/* ============================================================
 * USER STATUS
 * ============================================================ */

const STATUS = {

  ACTIVE: "Active",

  INACTIVE: "Inactive",

  LOCKED: "Locked"

};
/* ============================================================
 * ACCESS SCOPE
 * ============================================================ */

const ACCESS_SCOPE = {

  WAREHOUSE: "Warehouse",

  ZONE: "Zone",

  PAN_INDIA: "Pan India",

  CSR: "CSR"

};
/* ============================================================
 * SUBMISSION STATUS
 * ============================================================ */

const SUBMISSION_STATUS = {

  PENDING: "Pending",

  SUBMITTED: "Submitted",

  UNDER_REVIEW: "Under Review",

  APPROVED: "Approved",

  REJECTED: "Rejected",

  REOPENED: "Reopened",

  ARCHIVED: "Archived"

};

/* ============================================================
 * CSR CALLING TICKET STATUS
 * ============================================================ */

const CSR_TICKET_STATUS = {

  OPEN: "OPEN",

  CLOSED: "CLOSED"

};

/* ============================================================
 * NOTIFICATION TYPE
 * ============================================================ */

const NOTIFICATION = {

  INFO: "Info",

  SUCCESS: "Success",

  WARNING: "Warning",

  ERROR: "Error",

  SYSTEM: "System"

};



/* ============================================================
 * ERROR MESSAGES
 * ============================================================ */

const ERROR = {

  INVALID_USERNAME:
    "Please enter Username.",

  INVALID_PASSWORD:
    "Please enter Password.",

  USER_NOT_FOUND:
    "User not found.",
  
  FILE_REQUIRED: 
    "Please select a file.",

  FILE_NOT_FOUND:
    "File not found.",

  INVALID_FOLDER:
    "Invalid Google Drive folder.",

  ACCOUNT_LOCKED:
    "Your account has been locked. Contact Administrator.",

  ACCOUNT_INACTIVE:
  "Your account is inactive. Please contact Administrator.",

  INVALID_SESSION:
  "Invalid session.",

  SESSION_ALREADY_EXISTS:
  "User is already logged in.",

  ACCESS_DENIED:
  "You are not authorized to access this page.",

  SUBMISSION_NOT_FOUND:
    "Submission not found.",

  NOTIFICATION_NOT_FOUND:
    "Notification not found.",

  INVALID_REASON:
  "Invalid reason selected.",

  SESSION_EXPIRED:
    "Your session has expired. Please login again.",

  ORDER_REQUIRED:
    "Order Number is required.",

  INVALID_ORDER_NUMBER:
    "Order Number should contain digits only.",

  ORDER_MAX_LENGTH:
    "Order Number cannot exceed 11 digits.",

  INVALID_EMAIL:
    "Invalid email address.",

  INVALID_PHONE:
    "Invalid mobile number.",

  FILE_TOO_LARGE:
    "Maximum upload size is 30 MB.",

  INVALID_FILE_TYPE:
    "Unsupported file type.",

  UPLOAD_REQUIRED:
    "Proof upload is required.",

  REASON_NOT_ALLOWED:
    "Selected reason is not allowed.",

  UNKNOWN:
    "Something went wrong."

};



/* ============================================================
 * SUCCESS MESSAGES
 * ============================================================ */

const SUCCESS = {

  LOGIN:
    "Login successful.",

  LOGOUT:
    "Logged out successfully.",

  PASSWORD_CHANGED:
    "Password changed successfully.",

  PASSWORD_RESET:
    "Password reset successfully.",

  PASSWORD_RESET_LINK:
    "Password reset link sent to registered email.",

  USER_UNLOCKED:
    "User unlocked successfully.",

  SUBMISSION_CREATED:
    "Submission created successfully.",

  SAVED:
    "Saved successfully.",

  UPDATED:
    "Updated successfully.",

  FILE_UPLOADED: 
    "File uploaded successfully.",

  FETCHED: 
    "Details fetched successfully.",

  COPIED:
    "File copied successfully.",

  MOVED:
    "File moved successfully.",

  DELETED:
    "File deleted successfully.",

};

/* ============================================================
 * SUPPORTED MIME TYPES
 * ============================================================ */

const SUPPORTED_MIME_TYPES = [

  // Images

  "image/jpeg",

  "image/png",

  "image/jpg",

  "image/webp",

  "image/heic",

  "image/heif",

  "image/gif",

  "image/bmp",



  // PDF

  "application/pdf",



  // Audio

  "audio/mpeg",

  "audio/mp3",

  "audio/wav",

  "audio/x-wav",

  "audio/aac",

  "audio/mp4",

  "audio/ogg",

  "audio/amr",

  "audio/3gpp",



  // Video

  "video/mp4",

  "video/quicktime",

  "video/x-msvideo",

  "video/x-matroska",

  "video/webm",

  "video/3gpp"

];



/* ============================================================
 * SUPPORTED LANGUAGES
 * ============================================================ */

const LANGUAGES = [

  "English",

  "Hindi",

  "Kannada",

  "Tamil",

  "Telugu",

  "Malayalam",

  "Marathi",

  "Gujarati",

  "Bengali",

  "Punjabi",

  "Odia",

  "Assamese"

];



/* ============================================================
 * THEME COLORS
 * ============================================================ */

const COLORS = {

  PRIMARY: "#1565C0",

  SUCCESS: "#2E7D32",

  WARNING: "#F9A825",

  ERROR: "#C62828",

  INFO: "#0288D1",

  LIGHT: "#F5F7FA",

  DARK: "#263238",

  WHITE: "#FFFFFF"

};



/* ============================================================
 * REGEX
 * ============================================================ */

const REGEX = {

  ORDER_NUMBER:
    /^[0-9]{1,11}$/,

  EMAIL:
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/,

  PHONE:
    /^[0-9]{10}$/

};
