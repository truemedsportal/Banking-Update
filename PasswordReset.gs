/**
 * Password recovery for locked and forgotten-password users.
 * OTP mail is sent by the Apps Script deployment owner and uses the owner's
 * normal Google Workspace/Gmail daily quota. No paid third-party service is used.
 */
const PasswordReset = (() => {
  const REQUEST_SHEET = 'Rider Password Requests';
  const HEADERS = ['REQUEST_ID','REQUESTED_ON','USERNAME','RIDER_NAME','EMPLOYEE_ID','ZONE','WAREHOUSE','LM_HUB','REGISTERED_EMAIL','STATUS','REQUEST_CHANNEL','ACTIONED_BY','ACTIONED_ON','REMARKS'];
  const OTP_TTL_SECONDS = 600;
  const OTP_COOLDOWN_SECONDS = 60;
  const MAX_OTP_ATTEMPTS = 5;
  const text = value => Utility.safeString(value).trim();
  const key = value => text(value).toUpperCase().replace(/[^A-Z0-9]+/g,'_').replace(/^_|_$/g,'');
  const same = (left,right) => text(left).toLowerCase() === text(right).toLowerCase();
  const role = user => key(user && user.ROLE) === 'MANAGER' ? 'HUB_MANAGER' : key(user && user.ROLE);

  function sheet_() {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName(REQUEST_SHEET);
    if (!sheet) {
      sheet = ss.insertSheet(REQUEST_SHEET);
      sheet.getRange(1,1,1,HEADERS.length).setValues([HEADERS]);
      sheet.setFrozenRows(1);
    }
    return sheet;
  }

  function records_() {
    const sheet = sheet_();
    if (sheet.getLastRow() < 2) return [];
    return sheet.getRange(2,1,sheet.getLastRow()-1,HEADERS.length).getValues().map((row,index) => {
      const record = { row:index+2 };
      HEADERS.forEach((header,column) => record[header] = row[column]);
      return record;
    });
  }

  function canManage_(actor,record) {
    const r = role(actor);
    if (r === 'SUPER_ADMIN') return true;
    if (r === 'HUB_MANAGER') return key(actor.ACCESS_SCOPE) === 'LM_HUB' && same(actor.LM_HUB,record.LM_HUB);
    if (r === 'ADMIN' && key(actor.ACCESS_SCOPE) === 'WAREHOUSE') return same(actor.WAREHOUSE,record.WAREHOUSE);
    return r === 'ADMIN' && key(actor.ACCESS_SCOPE) === 'ZONE' && same(actor.ZONE,record.ZONE);
  }

  function validateNewPassword_(password) {
    const value = text(password);
    if (value.length < 8 || !/[a-z]/.test(value) || !/[A-Z]/.test(value) || !/[0-9]/.test(value)) {
      throw new Error('Use at least 8 characters with an uppercase letter, a lowercase letter, and a number.');
    }
    return value;
  }

  function cacheKey_(username,suffix) {
    return 'PASSWORD_RESET_' + key(username) + '_' + suffix;
  }

  function otpHash_(username,otp,salt) {
    return Auth.hash(text(username).toLowerCase() + '|' + text(otp) + '|' + text(salt));
  }

  function maskEmail_(email) {
    const parts = text(email).split('@');
    if (parts.length !== 2) return '';
    const local = parts[0];
    return (local.slice(0,Math.min(2,local.length)) || '*') + '***@' + parts[1];
  }

  function findActiveUser_(username) {
    const user = Database.users.findByUsername(text(username));
    if (!user || key(user.data.STATUS) !== 'ACTIVE') throw new Error('No active account was found for this username.');
    return user;
  }

  function requestOtp(input) {
    input = input || {};
    const user = findActiveUser_(input.username);
    const data = user.data;
    const email = text(data.REGISTERED_EMAIL);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new Error('No valid Registered Email is saved for this account. Use Request Admin Reset.');
    }
    const cache = CacheService.getScriptCache();
    if (cache.get(cacheKey_(data.USERNAME,'COOLDOWN'))) throw new Error('An OTP was sent recently. Wait one minute before requesting another.');
    if (MailApp.getRemainingDailyQuota() < 1) throw new Error('The daily email quota is currently exhausted. Use Request Admin Reset.');

    const otp = String(Math.floor(100000 + Math.random() * 900000));
    const salt = Utilities.getUuid();
    cache.put(cacheKey_(data.USERNAME,'OTP'), JSON.stringify({
      username:data.USERNAME,
      hash:otpHash_(data.USERNAME,otp,salt),
      salt:salt,
      attempts:0
    }), OTP_TTL_SECONDS);
    cache.put(cacheKey_(data.USERNAME,'COOLDOWN'),'1',OTP_COOLDOWN_SECONDS);

    const subject = 'TrueMeds portal password reset OTP';
    const body = 'Your TrueMeds portal password reset OTP is ' + otp + '. It expires in 10 minutes. Do not share this OTP.';
    MailApp.sendEmail({
      to:email,
      subject:subject,
      body:body,
      name:'TrueMeds HyperLocal Logistics Portal',
      htmlBody:'<div style="font-family:Arial,sans-serif;color:#172033"><h2>Password reset request</h2><p>Use this one-time password to reset your portal password:</p><div style="font-size:30px;font-weight:800;letter-spacing:8px;color:#0877c9">' + otp + '</div><p>This OTP expires in 10 minutes. Do not share it with anyone.</p></div>'
    });
    return Utility.success('OTP sent to your Registered Email.', { maskedEmail:maskEmail_(email), expiresMinutes:10 });
  }

  function verifyOtp(input) {
    input = input || {};
    const username = text(input.username);
    const otp = text(input.otp);
    const password = validateNewPassword_(input.newPassword);
    if (password !== text(input.confirmPassword)) throw new Error('New password and confirmation do not match.');
    const user = findActiveUser_(username);
    const cache = CacheService.getScriptCache();
    const cacheKey = cacheKey_(user.data.USERNAME,'OTP');
    const raw = cache.get(cacheKey);
    if (!raw) throw new Error('This OTP has expired. Request a new OTP.');
    const state = JSON.parse(raw);
    state.attempts = Number(state.attempts || 0) + 1;
    if (state.attempts > MAX_OTP_ATTEMPTS) {
      cache.remove(cacheKey);
      throw new Error('Too many incorrect OTP attempts. Request a new OTP.');
    }
    if (otpHash_(user.data.USERNAME,otp,state.salt) !== state.hash) {
      cache.put(cacheKey,JSON.stringify(state),OTP_TTL_SECONDS);
      throw new Error('The OTP is incorrect. Check the six digits and try again.');
    }
    cache.remove(cacheKey);
    const result = Auth.resetPassword(user.data.USERNAME,password);
    if (!result || !result.success) return result;
    resolvePending_(user.data.USERNAME,'SELF_SERVICE','OTP reset completed');
    return Utility.success('Password reset successfully. Sign in with your new password.');
  }

  function requestAdmin(input) {
    input = input || {};
    const user = findActiveUser_(input.username);
    const data = user.data;
    if (role(data) !== 'RIDER') throw new Error('Admin reset requests are available only for Rider accounts. Other users should use email OTP or contact a Super Admin.');
    const open = records_().find(record => same(record.USERNAME,data.USERNAME) && key(record.STATUS) === 'PENDING');
    if (open) return Utility.success('A password reset request is already pending with your mapped manager.', { requestId:text(open.REQUEST_ID) });
    const id = 'PWD-' + Utilities.getUuid().slice(0,10).toUpperCase();
    sheet_().appendRow([id,new Date(),data.USERNAME,data.RIDER_NAME,data.EMPLOYEE_ID,data.ZONE,data.WAREHOUSE,data.LM_HUB,data.REGISTERED_EMAIL,'Pending','LOGIN_PORTAL','','',text(input.remarks)||'Account locked / forgot password']);
    Database.users.all().map(record => record.data).filter(manager => ['HUB_MANAGER','ADMIN','SUPER_ADMIN'].indexOf(role(manager)) >= 0 && key(manager.STATUS) === 'ACTIVE' && canManage_(manager,data)).forEach(manager => {
      Notification.create({username:manager.USERNAME,role:manager.ROLE,title:'Rider password reset request',message:(data.RIDER_NAME || data.USERNAME) + ' requested a password reset.',submissionId:id,type:NOTIFICATION.WARNING});
    });
    return Utility.success('Password reset request sent to the responsible manager.', { requestId:id });
  }

  function list(actor,filters) {
    if (['HUB_MANAGER','ADMIN','SUPER_ADMIN'].indexOf(role(actor)) < 0) throw new Error('Not authorised.');
    filters = filters || {};
    const wantedStatus = key(filters.status || 'PENDING');
    const rows = records_().filter(record => canManage_(actor,record))
      .filter(record => !wantedStatus || wantedStatus === 'ALL' || key(record.STATUS) === wantedStatus)
      .sort((a,b) => new Date(b.REQUESTED_ON) - new Date(a.REQUESTED_ON))
      .map(record => ({
        requestId:text(record.REQUEST_ID), requestedOn:record.REQUESTED_ON instanceof Date ? Utility.formatDateTime(record.REQUESTED_ON) : text(record.REQUESTED_ON),
        username:text(record.USERNAME), riderName:text(record.RIDER_NAME), employeeId:text(record.EMPLOYEE_ID), zone:text(record.ZONE), warehouse:text(record.WAREHOUSE), lmHub:text(record.LM_HUB),
        registeredEmail:maskEmail_(record.REGISTERED_EMAIL), status:text(record.STATUS), actionedBy:text(record.ACTIONED_BY), actionedOn:record.ACTIONED_ON instanceof Date ? Utility.formatDateTime(record.ACTIONED_ON) : text(record.ACTIONED_ON), remarks:text(record.REMARKS)
      }));
    return rows;
  }

  function resolvePending_(username,actor,remarks) {
    const sheet = sheet_();
    records_().filter(record => same(record.USERNAME,username) && key(record.STATUS) === 'PENDING').forEach(record => {
      sheet.getRange(record.row,10,1,5).setValues([['Completed',record.REQUEST_CHANNEL,text(actor),new Date(),text(remarks)]]);
    });
  }

  function complete(actor,requestId,newPassword) {
    if (['HUB_MANAGER','ADMIN','SUPER_ADMIN'].indexOf(role(actor)) < 0) throw new Error('Not authorised.');
    const record = records_().find(item => same(item.REQUEST_ID,requestId));
    if (!record || key(record.STATUS) !== 'PENDING' || !canManage_(actor,record)) throw new Error('This password reset request is not available in your scope.');
    const password = validateNewPassword_(newPassword);
    const result = Auth.resetPassword(record.USERNAME,password);
    if (!result || !result.success) return result;
    sheet_().getRange(record.row,10,1,5).setValues([['Completed',record.REQUEST_CHANNEL,actor.USERNAME,new Date(),'Password reset by mapped manager']]);
    const email = text(record.REGISTERED_EMAIL);
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && MailApp.getRemainingDailyQuota() > 0) {
      MailApp.sendEmail({to:email,subject:'TrueMeds portal password reset completed',body:'Your portal password was reset by ' + actor.USERNAME + '. Sign in with the password shared through your authorised internal process. If you did not request this, contact your manager immediately.',name:'TrueMeds HyperLocal Logistics Portal'});
    }
    return Utility.success('Password reset completed and the account was unlocked.');
  }

  return { requestOtp, verifyOtp, requestAdmin, list, complete };
})();
