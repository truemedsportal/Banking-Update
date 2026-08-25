/**
 * ============================================================
 * TRUE MEDS - RTO & REATTEMPT PORTAL
 * File      : Code.gs
 * Purpose   : Application Entry Point
 * Version   : 2.0.0
 * ============================================================
 */

/**
 * Web App Entry
 */
function doGet(e) {

  const setting = key => Utility.safeString(Config.get(key));
  const requiredSetting = key => {
    const value = setting(key);
    if (!value)
      throw new Error("Configuration setting '" + key + "' is required.");
    return value;
  };
  const template = HtmlService.createTemplateFromFile("Index");
  const appName = requiredSetting("APP_NAME");
  const themeColor = requiredSetting("APP_THEME_COLOR");
  const logoUrl = requiredSetting("APP_LOGO_URL");

  template.appName = appName;
  template.themeColor = themeColor;
  template.bootConfig = JSON.stringify({
    name: appName,
    version: requiredSetting("APP_VERSION"),
    company: requiredSetting("COMPANY_NAME"),
    logoUrl,
    themeColor,
    darkModeEnabled: setting("ENABLE_DARK_MODE").toLowerCase() === "yes",
    translationEnabled: setting("ENABLE_TRANSLATION").toLowerCase() === "yes"
  });

  return template
    .evaluate()
    .setTitle(appName);

}


/**
 * Include HTML Files
 * Used for CSS / JS / Components
 */
function include(filename) {

  return HtmlService
    .createHtmlOutputFromFile(filename)
    .getContent();

}


