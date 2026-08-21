/**
 * External PWA API entry point.
 *
 * The Apps Script web app must be deployed as "Anyone" and "Execute as me".
 * It is protected by a private gateway key: browsers never call this endpoint
 * directly; Cloudflare Pages Functions adds the key server-side.
 */
function doPost(e) {
  let request = {};
  try {
    request = JSON.parse((e && e.postData && e.postData.contents) || "{}");
  } catch (error) {
    return externalApiJson_({ success: false, message: "Invalid API request." });
  }

  const expectedKey = Utility.safeString(Config.get("EXTERNAL_API_GATEWAY_KEY"));
  const suppliedKey = Utility.safeString(request.gatewayKey);
  if (!expectedKey || !suppliedKey || suppliedKey !== expectedKey) {
    return externalApiJson_({ success: false, message: "Unauthorized API request." });
  }

  try {
    const result = API.dispatch(
      Utility.safeString(request.action),
      Utility.safeString(request.sessionId),
      Array.isArray(request.args) ? request.args : []
    );
    return externalApiJson_(result);
  } catch (error) {
    console.error(error && error.stack ? error.stack : error);
    // Domain validation messages are intentionally safe and useful to the
    // mobile/PWA client (duplicate request, invalid date, missing approver,
    // invalid KM, etc.). Do not replace every error with one generic message.
    const message = Utility.safeString(error && error.message).trim();
    return externalApiJson_({ success: false, message: message || "Unable to complete the request." });
  }
}

function externalApiJson_(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload || { success: false }))
    .setMimeType(ContentService.MimeType.JSON);
}
