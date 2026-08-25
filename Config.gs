/**
 * ============================================================
 * TRUE MEDS - RTO & REATTEMPT PORTAL
 * File      : Config.gs
 * Purpose   : Configuration Manager
 * Version   : 2.0.0
 * ============================================================
 */

const Config = (() => {

  const CONFIG_SHEET = "Configuration";
  const LINK_SHEET   = "G-sheet/Drive Links";

  let settingsCache = null;
  let linksCache = null;
  let locationsCache = null;
  const SCRIPT_CACHE = CacheService.getScriptCache();
  const SETTINGS_CACHE_KEY = "PORTAL_CONFIG_V2";
  const LINKS_CACHE_KEY = "PORTAL_LINKS_V2";
  const LOCATIONS_CACHE_KEY = "PORTAL_LOCATIONS_V2";
  const CACHE_SECONDS = 300;

  function cacheRead(key) {
    try {
      const value = SCRIPT_CACHE.get(key);
      return value ? JSON.parse(value) : null;
    } catch (error) {
      return null;
    }
  }

  function cacheWrite(key, value) {
    try {
      const payload = JSON.stringify(value);
      // CacheService accepts values smaller than 100 KB. Skip unusually large
      // link tables instead of failing the request.
      if (payload.length < 95000)
        SCRIPT_CACHE.put(key, payload, CACHE_SECONDS);
    } catch (error) {
      // Configuration remains available from Sheets when cache is unavailable.
    }
    return value;
  }

  /**
   * Load Configuration Sheet
   */
  function loadSettings() {

    if (settingsCache) return settingsCache;

    settingsCache = cacheRead(SETTINGS_CACHE_KEY);
    if (settingsCache) return settingsCache;

    const sheet = SpreadsheetApp
      .getActiveSpreadsheet()
      .getSheetByName(CONFIG_SHEET);

    if (!sheet)
      throw new Error("Configuration sheet not found.");

    const values = sheet.getDataRange().getValues();

    settingsCache = {};

    for (let i = 1; i < values.length; i++) {

      const key = String(values[i][0]).trim();

      if (!key) continue;

      settingsCache[key] = values[i][1];

    }

    return cacheWrite(SETTINGS_CACHE_KEY, settingsCache);

  }

  /**
   * Load Sheet / Drive Links
   */
  function loadLinks() {

    if (linksCache) return linksCache;

    linksCache = cacheRead(LINKS_CACHE_KEY);
    if (linksCache) return linksCache;

    const sheet = SpreadsheetApp
      .getActiveSpreadsheet()
      .getSheetByName(LINK_SHEET);

    if (!sheet)
      throw new Error("G-sheet/Drive Links sheet not found.");

    const values = sheet.getDataRange().getValues();

    linksCache = values.slice(1);

    return cacheWrite(LINKS_CACHE_KEY, linksCache);

  }

  /**
   * Load the location mapping stored in Configuration!H:J.
   * Row 1 contains the headers: Zone, Warehouse, LM Hub.
   */
  function loadLocations() {

    if (locationsCache) return locationsCache;

    locationsCache = cacheRead(LOCATIONS_CACHE_KEY);
    if (locationsCache) return locationsCache;

    const sheet = SpreadsheetApp
      .getActiveSpreadsheet()
      .getSheetByName(CONFIG_SHEET);

    if (!sheet)
      throw new Error("Configuration sheet not found.");

    const lastRow = sheet.getLastRow();

    if (lastRow < 2) {
      locationsCache = [];
      return locationsCache;
    }

    const values = sheet
      .getRange(2, 8, lastRow - 1, 3)
      .getDisplayValues();

    const seen = {};

    locationsCache = values.reduce((rows, value) => {
      const location = {
        zone: String(value[0] || "").trim(),
        warehouse: String(value[1] || "").trim(),
        lmHub: String(value[2] || "").trim()
      };

      if (!location.zone && !location.warehouse && !location.lmHub)
        return rows;

      const key = [location.zone, location.warehouse, location.lmHub]
        .join("|")
        .toLowerCase();

      if (!seen[key]) {
        seen[key] = true;
        rows.push(location);
      }

      return rows;
    }, []);

    return cacheWrite(LOCATIONS_CACHE_KEY, locationsCache);

  }
   
   function configText(value) {

    return value === null || value === undefined
      ? ""
      : String(value).trim();

  }

  function findConfigValueRange(key) {

    const sheet = SpreadsheetApp
      .getActiveSpreadsheet()
      .getSheetByName(CONFIG_SHEET);

    if (!sheet)
      throw new Error("Configuration sheet not found.");

    const lastRow = sheet.getLastRow();

    if (lastRow < 2)
      return null;

    const wanted = configText(key).toUpperCase();
    const keys = sheet
      .getRange(2, 1, lastRow - 1, 1)
      .getDisplayValues();

    for (let i = 0; i < keys.length; i++) {

      if (configText(keys[i][0]).toUpperCase() === wanted)
        return sheet.getRange(i + 2, 2);

    }

    return null;

  }

  function resolveConfigImageUrl(key) {

    const range = findConfigValueRange(key);

    if (!range)
      return "";

    const value = range.getValue();

    // Google Sheets Image-in-cell objects expose a temporary browser URL.
    if (value && typeof value.getContentUrl === "function")
      return value.getContentUrl();

    // Safe fallback while B24 still contains a normal URL. Convert normal
    // Drive share links to a browser-displayable thumbnail URL.
    const raw = configText(value);
    // Accept a Drive sharing URL, an open?id= URL, or a plain Drive file ID.
    // The latter is the value most commonly pasted in Configuration.
    const match = raw.match(/[?&]id=([A-Za-z0-9_-]+)/) || raw.match(/\/d\/([A-Za-z0-9_-]+)/);
    const fileId = match ? match[1] : (/^[A-Za-z0-9_-]{15,}$/.test(raw) ? raw : '');
    return fileId
      ? 'https://drive.google.com/thumbnail?id=' + encodeURIComponent(fileId) + '&sz=w800'
      : raw;

  }

  /**
   * Public API
   */
  return {

    /**
     * Get Setting Value
     */
    get(key) {

      const settingName = configText(key).toUpperCase();

      if (settingName === "APP_LOGO_URL")
        return resolveConfigImageUrl(settingName);

      const settings = loadSettings();

      return settings[settingName] !== undefined
        ? settings[settingName]
        : settings[key];

    },

    /**
     * Get All Settings
     */
    all() {

      return loadSettings();

    },

    /**
     * Get All Link Rows
     */
    links() {

      return loadLinks();

    },

    /**
     * Get Configuration!H:J location rows.
     */
    locations() {

      return loadLocations();

    },

    /**
     * Reload Configuration
     */
    refresh() {

      settingsCache = null;
      linksCache = null;
      locationsCache = null;
      SCRIPT_CACHE.removeAll([
        SETTINGS_CACHE_KEY,
        LINKS_CACHE_KEY,
        LOCATIONS_CACHE_KEY
      ]);

    }

  };

})();

