/**
 * User-management service for the User Master sheet.
 *
 * Replace the complete contents of UserManagement.gs with this file.
 * This file is intentionally self-contained.  Do not add another
 * UserManagement declaration in any other .gs file.
 */
const UserManagement = (() => {
  const USER_SHEET = 'User Master';
  const CONFIG_SHEET = 'Configuration';
  const PHOTO_FOLDER_ID = '1Noc1Vl_1-x16hu4C2g1TX9UQXfoQGPUa';

  const HEADERS = [
    'Username', 'Password', 'Rider Name', 'Employee ID', 'Zone',
    'Warehouse', 'LM Hub', 'Status', 'Failed Attempts', 'Locked',
    'Role', 'Access Scope', 'Session ID', 'Last Login',
    'Registered Email', 'User Photo', 'Created / Edited By',
    'Creation / Edit Date and Time', 'Vendor Name'
  ];

  function text(value) {
    return String(value === null || value === undefined ? '' : value).trim();
  }

  function key(value) {
    return text(value).toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '');
  }

  function roleKey(value) {
    const valueKey = key(value);
    const aliases = {
      SUPERADMIN: 'SUPER_ADMIN',
      SUPER_ADMIN: 'SUPER_ADMIN',
      ADMIN: 'ADMIN',
      MANAGER: 'HUB_MANAGER',
      HUB_MANAGER: 'HUB_MANAGER',
      HUBMANAGER: 'HUB_MANAGER',
      RIDER: 'RIDER',
      CALLING_AGENT: 'CALLING_AGENT',
      CALLINGAGENT: 'CALLING_AGENT'
    };
    return aliases[valueKey] || '';
  }

  function roleLabel(value) {
    const labels = {
      SUPER_ADMIN: 'Super Admin',
      ADMIN: 'Admin',
      HUB_MANAGER: 'Hub Manager',
      RIDER: 'Rider',
      CALLING_AGENT: 'Calling Agent'
    };
    return labels[roleKey(value)] || text(value);
  }

  function scopeKey(value) {
    const valueKey = key(value);
    const aliases = {
      PAN_INDIA: 'PAN_INDIA',
      PANINDIA: 'PAN_INDIA',
      ZONE: 'ZONE',
      WAREHOUSE: 'WAREHOUSE',
      LM_HUB: 'LM_HUB',
      LMHUB: 'LM_HUB',
      CSR: 'CSR'
    };
    return aliases[valueKey] || '';
  }

  function scopeLabel(value) {
    const labels = {
      PAN_INDIA: 'Pan India',
      ZONE: 'Zone',
      WAREHOUSE: 'Warehouse',
      LM_HUB: 'LM Hub',
      CSR: 'CSR'
    };
    return labels[scopeKey(value)] || text(value);
  }

  /*
   * Do not use Utility.success here.  Some projects define it as
   * Utility.success(message, data), which swaps the data and message.
   * The browser must always receive { success, data, message } below.
   */
  function success(data, message) {
    return {
      success: true,
      data: data === undefined ? {} : data,
      message: message || 'Success.'
    };
  }

  function failure(message) {
    return { success: false, data: null, message: text(message) || 'Unable to complete the request.' };
  }

  function getSheet() {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(USER_SHEET);
    if (!sheet) throw new Error('Sheet "User Master" was not found.');
    return sheet;
  }

  function ensureHeaders(sheet) {
    const currentColumns = Math.max(sheet.getLastColumn(), 1);
    let headings = sheet.getRange(1, 1, 1, currentColumns).getDisplayValues()[0];
    const known = {};
    headings.forEach((heading, index) => { if (key(heading)) known[key(heading)] = index; });
    const missing = HEADERS.filter((heading) => !Object.prototype.hasOwnProperty.call(known, key(heading)));
    if (missing.length) {
      sheet.getRange(1, currentColumns + 1, 1, missing.length).setValues([missing]);
      headings = headings.concat(missing);
    }
    const map = {};
    headings.forEach((heading, index) => { if (key(heading)) map[key(heading)] = index; });
    return { map: map, width: headings.length };
  }

  function cell(row, map, heading) {
    const index = map[key(heading)];
    return index === undefined ? '' : row[index];
  }

  function userRecords() {
    const sheet = getSheet();
    const headerInfo = ensureHeaders(sheet);
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) return { sheet: sheet, map: headerInfo.map, width: headerInfo.width, records: [] };

    const rows = sheet.getRange(2, 1, lastRow - 1, headerInfo.width).getValues();
    const records = rows.map((row, index) => ({ row: row, rowNumber: index + 2 }))
      .filter((entry) => text(cell(entry.row, headerInfo.map, 'Username')))
      .map((entry) => {
        const row = entry.row;
        return {
          row: row,
          rowNumber: entry.rowNumber,
          username: text(cell(row, headerInfo.map, 'Username')),
          password: text(cell(row, headerInfo.map, 'Password')),
          riderName: text(cell(row, headerInfo.map, 'Rider Name')),
          employeeId: text(cell(row, headerInfo.map, 'Employee ID')),
          zone: text(cell(row, headerInfo.map, 'Zone')),
          warehouse: text(cell(row, headerInfo.map, 'Warehouse')),
          lmHub: text(cell(row, headerInfo.map, 'LM Hub')),
          status: text(cell(row, headerInfo.map, 'Status')) || 'Active',
          failedAttempts: text(cell(row, headerInfo.map, 'Failed Attempts')),
          locked: text(cell(row, headerInfo.map, 'Locked')),
          role: roleLabel(cell(row, headerInfo.map, 'Role')),
          access: scopeLabel(cell(row, headerInfo.map, 'Access Scope')),
          sessionId: text(cell(row, headerInfo.map, 'Session ID')),
          lastLogin: cell(row, headerInfo.map, 'Last Login'),
          email: text(cell(row, headerInfo.map, 'Registered Email')),
          vendorName: text(cell(row, headerInfo.map, 'Vendor Name')),
          userPhoto: text(cell(row, headerInfo.map, 'User Photo')),
          editedBy: text(cell(row, headerInfo.map, 'Created / Edited By')),
          editedAt: cell(row, headerInfo.map, 'Creation / Edit Date and Time')
        };
      });
    return { sheet: sheet, map: headerInfo.map, width: headerInfo.width, records: records };
  }

      function actorInfo(actor) {
        const actorData = actor || {};
        return {
          username: text(actorData.username || actorData.Username || actorData.USERNAME),
          name: text(actorData.riderName || actorData.name || actorData['Rider Name'] || actorData.RIDER_NAME || actorData.username || actorData.USERNAME),
          role: roleKey(actorData.role || actorData.Role || actorData.ROLE),
          access: scopeKey(actorData.access || actorData.accessScope || actorData['Access Scope'] || actorData.ACCESS_SCOPE),
          zone: text(actorData.zone || actorData.Zone || actorData.ZONE),
          warehouse: text(actorData.warehouse || actorData.Warehouse || actorData.WAREHOUSE),
          lmHub: text(actorData.lmHub || actorData['LM Hub'] || actorData.LM_HUB)
        };
      }

  function configurationLocations() {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG_SHEET);
    if (!sheet || sheet.getLastRow() < 2) return [];
    // Configuration mapping is H:Zone, I:Warehouse, J:LM Hub.
    const values = sheet.getRange(2, 8, sheet.getLastRow() - 1, 3).getDisplayValues();
    const seen = {};
    return values.map((row) => ({ zone: text(row[0]), warehouse: text(row[1]), lmHub: text(row[2]) }))
      .filter((row) => row.zone && row.warehouse && row.lmHub)
      .filter((row) => {
        const identifier = [row.zone, row.warehouse, row.lmHub].join('|').toLowerCase();
        if (seen[identifier]) return false;
        seen[identifier] = true;
        return true;
      });
  }

  function vendorNames() {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG_SHEET);
    if (!sheet || sheet.getLastRow() < 2) return [];
    const values = sheet.getRange(2, 12, sheet.getLastRow() - 1, 1).getDisplayValues().map(row => text(row[0])).filter(Boolean);
    return values.filter((value, index) => values.findIndex(item => item.toLowerCase() === value.toLowerCase()) === index);
  }

  function same(left, right) {
    return text(left).toLowerCase() === text(right).toLowerCase();
  }

  function allowedRoleKeys(actor) {
    if (actor.role === 'SUPER_ADMIN') {
      return actor.access === 'CSR'
        ? ['CALLING_AGENT', 'ADMIN', 'SUPER_ADMIN']
        : ['RIDER', 'HUB_MANAGER', 'ADMIN', 'SUPER_ADMIN', 'CALLING_AGENT'];
    }
    if (actor.role === 'ADMIN') {
      if (actor.access === 'CSR') return ['CALLING_AGENT'];
      if (actor.access === 'WAREHOUSE') return ['RIDER', 'HUB_MANAGER', 'ADMIN'];
      if (actor.access === 'ZONE') return ['RIDER', 'HUB_MANAGER', 'ADMIN'];
    }
    if (actor.role === 'HUB_MANAGER' && actor.access === 'LM_HUB') return ['RIDER'];
    return [];
  }

  function allowedScopes(actor, targetRole) {
    const target = roleKey(targetRole);
    if (target === 'RIDER') return [];
    if (target === 'CALLING_AGENT') return ['CSR'];
    if (target === 'HUB_MANAGER') return ['LM_HUB'];
    if (target === 'SUPER_ADMIN') return actor.access === 'CSR' ? ['CSR'] : ['PAN_INDIA', 'CSR'];
    if (target !== 'ADMIN') return [];

    if (actor.role === 'SUPER_ADMIN') {
      return actor.access === 'CSR' ? ['CSR'] : ['ZONE', 'WAREHOUSE', 'CSR'];
    }
    if (actor.role === 'ADMIN') {
      if (actor.access === 'CSR') return ['CSR'];
      if (actor.access === 'WAREHOUSE') return ['WAREHOUSE'];
      // A Zone Admin can appoint an Admin for a Zone or one Warehouse in that Zone.
      if (actor.access === 'ZONE') return ['ZONE', 'WAREHOUSE'];
    }
    return [];
  }

  function permittedLocations(actor) {
    const rows = configurationLocations();
    if (actor.role === 'SUPER_ADMIN') return rows;
    if (actor.role === 'ADMIN' && actor.access === 'CSR') return rows;
    if (actor.role === 'ADMIN' && actor.access === 'ZONE') {
      return rows.filter((row) => same(row.zone, actor.zone));
    }
    if (actor.role === 'ADMIN' && actor.access === 'WAREHOUSE') {
      return rows.filter((row) => same(row.warehouse, actor.warehouse));
    }
    if (actor.role === 'HUB_MANAGER' && actor.access === 'LM_HUB') {
      return rows.filter((row) => same(row.lmHub, actor.lmHub));
    }
    return [];
  }

  function isLocationAllowed(actor, candidate) {
    return permittedLocations(actor).some((row) =>
      same(row.zone, candidate.zone) && same(row.warehouse, candidate.warehouse) && same(row.lmHub, candidate.lmHub)
    );
  }

  function canManage(actor, candidate) {
    const targetRole = roleKey(candidate.role);
    const targetScope = scopeKey(candidate.access);
    if (allowedRoleKeys(actor).indexOf(targetRole) === -1) return false;
    if (allowedScopes(actor, targetRole).indexOf(targetScope) === -1 && targetRole !== 'RIDER') return false;
    if (targetRole === 'RIDER' && targetScope) return false;
    return isLocationAllowed(actor, candidate);
  }

  function publicUser(record) {
    return {
      username: record.username,
      riderName: record.riderName,
      employeeId: record.employeeId,
      zone: record.zone,
      warehouse: record.warehouse,
      lmHub: record.lmHub,
      status: record.status,
      role: roleLabel(record.role),
      access: scopeLabel(record.access),
      email: record.email,
      vendorName: record.vendorName,
      userPhoto: record.userPhoto
    };
  }

  function context(actor) {
    const currentActor = actorInfo(actor);
    const data = userRecords();
    if (!allowedRoleKeys(currentActor).length) return failure('You are not authorized to access User Management.');

    return success({
      actor: {
        username: currentActor.username,
        role: roleLabel(currentActor.role),
        access: scopeLabel(currentActor.access),
        zone: currentActor.zone,
        warehouse: currentActor.warehouse,
        lmHub: currentActor.lmHub
      },
      roles: allowedRoleKeys(currentActor).map(roleLabel),
      locations: permittedLocations(currentActor),
      vendors: vendorNames(),
      users: data.records.filter((record) => canManage(currentActor, record)).map(publicUser),
      takenUsernames: data.records.map((record) => record.username),
      takenEmployeeIds: data.records.map((record) => record.employeeId)
    });
  }

  function hashPassword(password) {
    const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text(password), Utilities.Charset.UTF_8);
    return bytes.map((byte) => {
      const value = byte < 0 ? byte + 256 : byte;
      return ('0' + value.toString(16)).slice(-2);
    }).join('');
  }

  function isSha256(value) {
    return /^[a-f0-9]{64}$/i.test(text(value));
  }

  function validateEmail(value) {
    const email = text(value);
    return !email || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  }

  function normalisedInput(payload) {
    const input = payload || {};
    const role = roleKey(input.role);
    let access = scopeKey(input.access || input.accessScope);
    if (role === 'RIDER') access = '';
    if (role === 'CALLING_AGENT') access = 'CSR';
    return {
      username: text(input.username),
      riderName: text(input.riderName || input.name),
      employeeId: text(input.employeeId),
      role: role,
      access: access,
      zone: text(input.zone),
      warehouse: text(input.warehouse),
      lmHub: text(input.lmHub),
      status: text(input.status) || 'Active',
      email: text(input.email),
      vendorName: text(input.vendorName),
      password: text(input.password),
      photo: input.photo || input.userPhoto || null
    };
  }

  function validateInput(actor, input, records, originalUsername) {
    if (!input.username) throw new Error('Username is required.');
    if (!input.riderName) throw new Error('Rider / Calling Agent Name is required.');
    if (!input.employeeId) throw new Error('Employee ID is required.');
    if (!input.role) throw new Error('Role is required.');
    if (input.role === 'RIDER' && !input.vendorName) throw new Error('Vendor Name is required for a Rider.');
    if (!input.zone || !input.warehouse || !input.lmHub) {
      throw new Error('Zone, Warehouse and LM Hub are required.');
    }
    if (!validateEmail(input.email)) throw new Error('Please enter a valid registered email.');
    if (allowedRoleKeys(actor).indexOf(input.role) === -1) throw new Error('You cannot create or edit this role.');
    if (input.role !== 'RIDER' && allowedScopes(actor, input.role).indexOf(input.access) === -1) {
      throw new Error('The selected access scope is not permitted for this role.');
    }
    if (!isLocationAllowed(actor, input)) throw new Error('The selected Zone, Warehouse and LM Hub are outside your permitted mapping.');

    const original = text(originalUsername).toLowerCase();
    const duplicateUsername = records.some((record) =>
      record.username.toLowerCase() === input.username.toLowerCase() && record.username.toLowerCase() !== original
    );
    if (duplicateUsername) throw new Error('This username already exists. Please choose another username.');

    const currentRecord = records.filter((record) => record.username.toLowerCase() === original)[0];
    const duplicateEmployeeId = records.some((record) =>
      record.employeeId.toLowerCase() === input.employeeId.toLowerCase() && (!currentRecord || record.rowNumber !== currentRecord.rowNumber)
    );
    if (duplicateEmployeeId) throw new Error('This Employee ID already exists. Please use a unique Employee ID.');
  }

  function dataUrlParts(value) {
    const match = text(value).match(/^data:([^;]+);base64,([\s\S]+)$/i);
    return match ? { mimeType: match[1], base64: match[2] } : null;
  }

  function fileIdFromUrl(value) {
    const source = text(value);
    const idMatch = source.match(/[?&]id=([^&]+)/i) || source.match(/\/d\/([^/?]+)/i);
    return idMatch ? idMatch[1] : '';
  }

  function savePhoto(photo, username, oldPhoto) {
    if (!photo) return oldPhoto || '';
    if (typeof photo === 'string') return text(photo) || oldPhoto || '';
    const parts = dataUrlParts(photo.dataUrl || photo.data || '');
    if (!parts) return oldPhoto || '';
    const mimeType = /^image\/(jpeg|jpg|png|webp)$/i.test(parts.mimeType) ? parts.mimeType : 'image/jpeg';
    const extension = mimeType === 'image/png' ? 'png' : (mimeType === 'image/webp' ? 'webp' : 'jpg');
    const name = (text(username).replace(/[^A-Za-z0-9_-]/g, '_') || 'user') + '_' + new Date().getTime() + '.' + extension;
    const blob = Utilities.newBlob(Utilities.base64Decode(parts.base64), mimeType, name);
    const folder = DriveApp.getFolderById(PHOTO_FOLDER_ID);
    const file = folder.createFile(blob);
    try {
      file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    } catch (error) {
      // A Workspace administrator may disable public sharing.  The stored Drive link still works for permitted users.
    }
    const oldFileId = fileIdFromUrl(oldPhoto);
    if (oldFileId) {
      try { DriveApp.getFileById(oldFileId).setTrashed(true); } catch (error) { /* Previous file may be inaccessible. */ }
    }
    return 'https://drive.google.com/uc?export=view&id=' + file.getId();
  }

  function rowValues(width, map, input, actor, existing) {
    const values = existing ? existing.row.slice() : Array(width).fill('');
    const put = (heading, value) => { const index = map[key(heading)]; if (index !== undefined) values[index] = value; };
    put('Username', input.username);
    put('Rider Name', input.riderName);
    put('Employee ID', input.employeeId);
    put('Zone', input.zone);
    put('Warehouse', input.warehouse);
    put('LM Hub', input.lmHub);
    put('Status', input.status);
    put('Role', roleLabel(input.role));
    put('Access Scope', scopeLabel(input.access));
    put('Registered Email', input.email);
    put('Vendor Name', input.vendorName);
    put('Created / Edited By', actor.username || actor.name || 'System');
    put('Creation / Edit Date and Time', new Date());
    return { values: values, put: put };
  }

  function create(actor, payload) {
    const lock = LockService.getScriptLock();
    lock.waitLock(30000);
    try {
      const currentActor = actorInfo(actor);
      const source = userRecords();
      const input = normalisedInput(payload);
      if (!input.password) throw new Error('Initial Access Code is required.');
      validateInput(currentActor, input, source.records, '');
      const result = rowValues(source.width, source.map, input, currentActor, null);
      result.put('Password', isSha256(input.password) ? input.password.toLowerCase() : hashPassword(input.password));
      result.put('Failed Attempts', 0);
      result.put('Locked', 'NO');
      result.put('Session ID', '');
      result.put('Last Login', '');
      result.put('User Photo', savePhoto(input.photo, input.username, ''));
      source.sheet.appendRow(result.values);
      return success({ user: publicUser(Object.assign({}, input, { userPhoto: cell(result.values, source.map, 'User Photo') })) }, 'User created successfully in User Master.');
    } finally {
      lock.releaseLock();
    }
  }

  function update(actor, originalUsername, payload) {
    const lock = LockService.getScriptLock();
    lock.waitLock(30000);
    try {
      const currentActor = actorInfo(actor);
      const source = userRecords();
      const original = text(originalUsername);
      const existing = source.records.filter((record) => record.username.toLowerCase() === original.toLowerCase())[0];
      if (!existing) throw new Error('The user to edit was not found.');
      if (!canManage(currentActor, existing)) throw new Error('You are not authorized to edit this user.');
      const input = normalisedInput(payload);
      validateInput(currentActor, input, source.records, original);
      const result = rowValues(source.width, source.map, input, currentActor, existing);
      if (input.password) {
        result.put('Password', isSha256(input.password) ? input.password.toLowerCase() : hashPassword(input.password));
        result.put('Failed Attempts', 0);
        result.put('Locked', 'NO');
        result.put('Session ID', '');
      }
      result.put('User Photo', savePhoto(input.photo, input.username, existing.userPhoto));
      source.sheet.getRange(existing.rowNumber, 1, 1, source.width).setValues([result.values]);
      return success({ user: publicUser(Object.assign({}, input, { userPhoto: cell(result.values, source.map, 'User Photo') })) }, 'User updated successfully in User Master.');
    } finally {
      lock.releaseLock();
    }
  }

  // `list` is retained because Api.gs routes userManagementContext to it.
  function list(actor) {
    return context(actor);
  }

  return { context: context, list: list, create: create, update: update };
})();
