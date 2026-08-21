/**
 * Attendance and kilometre regularisation.
 * All attendance request data is stored in the separate Attendance spreadsheet.
 */
const Attendance = (() => {
  const ATTENDANCE_FILE_ID = '1o4D3VKI-7Vv7W2xQZcnzWLkjHa0IbAQGoG2cbu4-YP0';
  const REQUEST_SHEET = 'Attendance Requests';
  const HEADERS = ['REQUEST_ID','REQUEST_TYPE','USERNAME','RIDER_NAME','EMPLOYEE_ID','ZONE','WAREHOUSE','LM_HUB','VENDOR_NAME','ATTENDANCE_DATE','START_KM','END_KM','TOTAL_KM','STATUS','ASSIGNED_TO','ASSIGNED_ROLE','SUBMITTED_ON','ACTIONED_BY','ACTIONED_ON','REMARKS','REMINDER_SENT_ON','ATTENDANCE_STATE'];
  const str = value => Utility.safeString(value).trim();
  const key = value => str(value).toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '');
  const same = (left, right) => str(left).toLowerCase() === str(right).toLowerCase();
  const role = user => key(user.ROLE) === 'MANAGER' ? 'HUB_MANAGER' : key(user.ROLE);
  let spreadsheetCache_ = null;
  let requestSheetCache_ = null;
  let recordsCache_ = null;
  let usersCache_ = null;

  function dateKey(value) {
    if (value instanceof Date && !isNaN(value.getTime())) return Utilities.formatDate(value, Session.getScriptTimeZone(), 'yyyy-MM-dd');
    const raw = str(value);
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
    const match = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (match) return match[3] + '-' + ('0' + match[2]).slice(-2) + '-' + ('0' + match[1]).slice(-2);
    const parsed = new Date(raw);
    if (isNaN(parsed.getTime())) throw new Error('Invalid attendance date.');
    return Utilities.formatDate(parsed, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  function dateValue(keyValue) { const parts = dateKey(keyValue).split('-'); return new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]), 12, 0, 0); }
  function daysBetween(from, to) { return Math.round((Date.UTC(+to.slice(0,4), +to.slice(5,7)-1, +to.slice(8,10)) - Date.UTC(+from.slice(0,4), +from.slice(5,7)-1, +from.slice(8,10))) / 86400000); }
  function attendanceSpreadsheet_() {
    if (!spreadsheetCache_) spreadsheetCache_ = SpreadsheetApp.openById(ATTENDANCE_FILE_ID);
    return spreadsheetCache_;
  }
  function sheet_() {
    if (requestSheetCache_) return requestSheetCache_;
    const ss = attendanceSpreadsheet_(); let sheet = ss.getSheetByName(REQUEST_SHEET);
    if (!sheet) { sheet = ss.insertSheet(REQUEST_SHEET); sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]); sheet.setFrozenRows(1); }
    else if (sheet.getLastColumn() < HEADERS.length || sheet.getRange(1, HEADERS.length).getValue() !== HEADERS[HEADERS.length - 1]) sheet.getRange(1, HEADERS.length).setValue(HEADERS[HEADERS.length - 1]);
    requestSheetCache_ = sheet;
    return requestSheetCache_;
  }
  function records_() {
    if (recordsCache_) return recordsCache_;
    const sheet = sheet_(), count = sheet.getLastRow(); if (count < 2) return (recordsCache_ = []);
    recordsCache_ = sheet.getRange(2, 1, count - 1, HEADERS.length).getValues().map((row, index) => { const record = { row: index + 2 }; HEADERS.forEach((header, column) => record[header] = row[column]); return record; });
    return recordsCache_;
  }
  function users_() {
    if (!usersCache_)
      usersCache_ = Database.users.all().map(record => Object.assign({ row: record.row }, record.data));
    return usersCache_;
  }
  function refreshRecords_() { recordsCache_ = null; }
  function activeRider_(username) { return users_().filter(user => same(user.USERNAME, username) && key(user.ROLE) === 'RIDER' && key(user.STATUS) === 'ACTIVE')[0]; }
  function owner_(rider) {
    const users = users_().filter(user => key(user.STATUS) === 'ACTIVE');
    let recipients = users.filter(user => key(user.ROLE) === 'HUB_MANAGER' && key(user.ACCESS_SCOPE) === 'LM_HUB' && same(user.LM_HUB, rider.LM_HUB));
    if (!recipients.length) recipients = users.filter(user => key(user.ROLE) === 'ADMIN' && key(user.ACCESS_SCOPE) === 'WAREHOUSE' && same(user.WAREHOUSE, rider.WAREHOUSE));
    if (!recipients.length) recipients = users.filter(user => key(user.ROLE) === 'ADMIN' && key(user.ACCESS_SCOPE) === 'ZONE' && same(user.ZONE, rider.ZONE));
    if (!recipients.length) recipients = users.filter(user => key(user.ROLE) === 'SUPER_ADMIN' && key(user.ACCESS_SCOPE) === 'PAN_INDIA');
    return recipients;
  }
  function canManage_(actor, record) {
    const actorRole = role(actor); if (actorRole === 'SUPER_ADMIN') return true;
    if (actorRole === 'HUB_MANAGER') return key(actor.ACCESS_SCOPE) === 'LM_HUB' && same(actor.LM_HUB, record.LM_HUB);
    if (actorRole === 'ADMIN' && key(actor.ACCESS_SCOPE) === 'WAREHOUSE') return same(actor.WAREHOUSE, record.WAREHOUSE);
    return actorRole === 'ADMIN' && key(actor.ACCESS_SCOPE) === 'ZONE' && same(actor.ZONE, record.ZONE);
  }
  function notify_(people, title, message, id, type) { people.forEach(person => Notification.create({ username: person.USERNAME, role: person.ROLE, title, message, submissionId: id, type: type || NOTIFICATION.INFO })); }
  function dto_(record) {
    const out = {}; HEADERS.forEach(header => out[header.toLowerCase()] = record[header] instanceof Date ? Utility.formatDateTime(record[header]) : record[header]);
    out.attendance_date_iso = dateKey(record.ATTENDANCE_DATE); return out;
  }
  function append_(values) {
    const sheet = sheet_(), rowValues = values.slice(); while (rowValues.length < HEADERS.length) rowValues.push(''); sheet.appendRow(rowValues);
    const row = sheet.getLastRow();
    // Work Date is always displayed unambiguously, independent of spreadsheet locale.
    sheet.getRange(row, 10).setNumberFormat('dd/MM/yyyy HH:mm:ss');
    sheet.getRange(row, 17, 1, 3).setNumberFormat('dd/MM/yyyy HH:mm:ss');
    refreshRecords_();
    return row;
  }
  function activeDuplicate_(rider, type, workDate) { return records_().some(record => same(record.USERNAME, rider.USERNAME) && key(record.REQUEST_TYPE) === type && dateKey(record.ATTENDANCE_DATE) === workDate && key(record.STATUS) !== 'REJECTED'); }
  function submit(actor, input) {
    const rider = activeRider_(actor.USERNAME); if (!rider) throw new Error('Attendance can only be submitted by an active Rider.');
    const type = key(input.type), workDate = dateKey(input.date), age = daysBetween(workDate, dateKey(new Date()));
    if (['ATTENDANCE', 'KM'].indexOf(type) < 0) throw new Error('Invalid attendance request type.');
    if (age < 0 || age > (type === 'ATTENDANCE' ? 1 : 2)) throw new Error(type === 'ATTENDANCE' ? 'Attendance is available only for today or yesterday.' : 'KM is available only for today, yesterday, or two days ago.');
    const start = input.startKm === '' || input.startKm === undefined ? '' : Number(input.startKm), end = input.endKm === '' || input.endKm === undefined ? '' : Number(input.endKm);
    if (type === 'KM' && (!isFinite(start) || !isFinite(end) || start < 0 || end < start)) throw new Error('Enter valid Start KM and End KM values.');
    if (activeDuplicate_(rider, type, workDate)) throw new Error('A ' + (type === 'KM' ? 'KM' : 'Attendance') + ' request already exists for this date. You may submit it again only if the existing request is rejected.');
    const recipients = owner_(rider); if (!recipients.length) throw new Error('No responsible approver is mapped for this rider.');
    const id = 'ATT-' + Utilities.getUuid().slice(0, 8).toUpperCase(), now = new Date();
    append_([id, type, rider.USERNAME, rider.RIDER_NAME, rider.EMPLOYEE_ID, rider.ZONE, rider.WAREHOUSE, rider.LM_HUB, rider.VENDOR_NAME, dateValue(workDate), start, end, type === 'KM' ? end - start : '', 'Pending', recipients.map(person => person.USERNAME).join(', '), recipients.map(person => person.ROLE).join(', '), now, '', '', '', '']);
    notify_(recipients, 'Attendance approval pending', str(rider.RIDER_NAME) + ' submitted a ' + type + ' request for ' + workDate + '.', id, NOTIFICATION.WARNING);
    return { success: true, data: dto_(records_().filter(record => record.REQUEST_ID === id)[0]), message: 'Request sent for approval.' };
  }
  function mine(actor) { return records_().filter(record => same(record.USERNAME, actor.USERNAME)).map(dto_); }
  function riderDashboard(actor) {
    // Use the raw ledger fields here. `mine()` returns lower-case DTO fields,
    // whereas the ledger headers are upper-case; mixing the two made every
    // attendance dashboard total appear as zero.
    const records = records_().filter(record => same(record.USERNAME, actor.USERNAME));
    const count = (type, status) => records.filter(record => key(record.REQUEST_TYPE) === type && key(record.STATUS) === status).length;
    return {
      pendingAttendance: count('ATTENDANCE', 'PENDING'),
      pendingKm: count('KM', 'PENDING'),
      approvedAttendance: count('ATTENDANCE', 'APPROVED'),
      approvedKmRequests: count('KM', 'APPROVED'),
      present: count('ATTENDANCE', 'APPROVED'),
      absent: count('ATTENDANCE', 'REJECTED'),
      pending: records.filter(record => key(record.STATUS) === 'PENDING').length,
      totalKm: records.filter(record => key(record.REQUEST_TYPE) === 'KM' && key(record.STATUS) === 'APPROVED').reduce((sum, record) => sum + (Number(record.TOTAL_KM) || 0), 0),
      recent: records.slice(-6).reverse().map(dto_)
    };
  }
  function monthKey_(value) {
    const raw = str(value);
    if (/^\d{4}-\d{2}$/.test(raw)) return raw;
    return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM');
  }
  function attendanceCalendar(actor, month) {
    const actorRole = role(actor), monthKey = monthKey_(month);
    if (actorRole !== 'RIDER' && ['HUB_MANAGER','ADMIN','SUPER_ADMIN'].indexOf(actorRole) < 0) throw new Error('Not authorised.');
    const parts = monthKey.split('-'), year = Number(parts[0]), monthIndex = Number(parts[1]) - 1;
    const dayCount = new Date(year, monthIndex + 1, 0).getDate();
    const users = actorRole === 'RIDER'
      ? users_().filter(user => same(user.USERNAME, actor.USERNAME) && key(user.ROLE) === 'RIDER')
      : users_().filter(user => key(user.ROLE) === 'RIDER' && key(user.STATUS) === 'ACTIVE' && canManage_(actor, user));
    const attendanceByRiderAndDay = {};
    records_().filter(record => key(record.REQUEST_TYPE) === 'ATTENDANCE' && dateKey(record.ATTENDANCE_DATE).slice(0, 7) === monthKey).forEach(record => {
      attendanceByRiderAndDay[str(record.USERNAME).toLowerCase() + '|' + dateKey(record.ATTENDANCE_DATE)] = record;
    });
    const days = Array.from({ length: dayCount }, (_, index) => {
      const date = new Date(year, monthIndex, index + 1, 12), dateIso = monthKey + '-' + ('0' + (index + 1)).slice(-2);
      return { date: dateIso, day: index + 1, weekday: Utilities.formatDate(date, Session.getScriptTimeZone(), 'EEE') };
    });
    const riders = users.map(user => {
      const cells = days.map(day => {
        const record = attendanceByRiderAndDay[str(user.USERNAME).toLowerCase() + '|' + day.date], status = record ? key(record.STATUS) : '', manualState = record ? key(record.ATTENDANCE_STATE) : '';
        if (manualState === 'PRESENT') return { date: day.date, state: 'PRESENT', label: 'P', title: 'Present' };
        if (manualState === 'ABSENT') return { date: day.date, state: 'ABSENT', label: 'A', title: 'Absent' };
        if (manualState === 'LEAVE') return { date: day.date, state: 'LEAVE', label: 'L', title: 'Leave' };
        if (status === 'APPROVED') return { date: day.date, state: 'PRESENT', label: 'P', title: 'Present' };
        if (status === 'PENDING') return { date: day.date, state: 'PENDING', label: '~', title: 'Attendance pending approval' };
        if (status === 'REJECTED') return { date: day.date, state: 'REJECTED', label: 'A', title: 'Attendance request rejected' };
        return { date: day.date, state: 'EMPTY', label: '', title: 'No attendance record' };
      });
      return { username: str(user.USERNAME), riderName: str(user.RIDER_NAME), employeeId: str(user.EMPLOYEE_ID), zone: str(user.ZONE), warehouse: str(user.WAREHOUSE), lmHub: str(user.LM_HUB), cells: cells };
    });
    return { month: monthKey, days: days, riders: riders };
  }
  function correctionRiderOptions(actor) {
    if (['HUB_MANAGER','ADMIN','SUPER_ADMIN'].indexOf(role(actor)) < 0) throw new Error('Not authorised.');
    return users_().filter(user => key(user.ROLE) === 'RIDER' && key(user.STATUS) === 'ACTIVE' && canManage_(actor, user)).map(user => ({ username:str(user.USERNAME), name:str(user.RIDER_NAME), employeeId:str(user.EMPLOYEE_ID), zone:str(user.ZONE), warehouse:str(user.WAREHOUSE), lmHub:str(user.LM_HUB) }));
  }
  function correctAttendance(actor, input) {
    const actorRole = role(actor); if (['HUB_MANAGER','ADMIN','SUPER_ADMIN'].indexOf(actorRole) < 0) throw new Error('Not authorised.');
    const workDate = dateKey(input.date), age = daysBetween(workDate, dateKey(new Date())), state = key(input.state);
    if (age < 0) throw new Error('Future dates cannot be marked present, absent, or leave.');
    if (actorRole !== 'SUPER_ADMIN' && age > 2) throw new Error('Attendance corrections are allowed only for today and the previous 2 days.');
    if (['PRESENT','ABSENT','LEAVE'].indexOf(state) < 0) throw new Error('Choose Present, Absent, or Leave.');
    const rider = activeRider_(input.username); if (!rider || !canManage_(actor, rider)) throw new Error('Rider is outside your permitted scope.');
    const matching = records_().filter(record => same(record.USERNAME,rider.USERNAME) && key(record.REQUEST_TYPE)==='ATTENDANCE' && dateKey(record.ATTENDANCE_DATE)===workDate);
    const record = matching.length ? matching[matching.length-1] : null, now = new Date(), remarks = str(input.remarks);
    if (record) {
      const rowValues = sheet_().getRange(record.row, 1, 1, HEADERS.length).getValues()[0];
      rowValues[13] = 'Approved';
      rowValues[17] = actor.USERNAME;
      rowValues[18] = now;
      rowValues[19] = remarks;
      rowValues[21] = state.charAt(0)+state.slice(1).toLowerCase();
      sheet_().getRange(record.row, 1, 1, HEADERS.length).setValues([rowValues]);
      refreshRecords_();
      record.STATUS='Approved'; record.ATTENDANCE_STATE=state; writeAttendance_(record);
    } else {
      const id='ATT-'+Utilities.getUuid().slice(0,8).toUpperCase();
      append_([id,'ATTENDANCE',rider.USERNAME,rider.RIDER_NAME,rider.EMPLOYEE_ID,rider.ZONE,rider.WAREHOUSE,rider.LM_HUB,rider.VENDOR_NAME,dateValue(workDate),'','','','Approved',actor.USERNAME,actor.ROLE,now,actor.USERNAME,now,remarks,'',state.charAt(0)+state.slice(1).toLowerCase()]);
      writeAttendance_(records_().filter(item=>same(item.REQUEST_ID,id))[0]);
    }
    notify_(users_().filter(user=>same(user.USERNAME,rider.USERNAME)),'Attendance corrected', 'Your attendance for '+workDate+' was marked '+state.toLowerCase()+'.', '', NOTIFICATION.INFO);
    return { success:true, message:'Attendance marked '+state.toLowerCase()+'.' };
  }
  function queue(actor) { if (['HUB_MANAGER','ADMIN','SUPER_ADMIN'].indexOf(role(actor)) < 0) throw new Error('Not authorised.'); return records_().filter(record => canManage_(actor, record) && key(record.STATUS) === 'PENDING').map(dto_); }
  function approvedKm(actor) { if (['HUB_MANAGER','ADMIN','SUPER_ADMIN'].indexOf(role(actor)) < 0) throw new Error('Not authorised.'); return records_().filter(record => canManage_(actor, record) && key(record.REQUEST_TYPE) === 'KM' && key(record.STATUS) === 'APPROVED').sort((a,b) => new Date(b.ACTIONED_ON || b.SUBMITTED_ON) - new Date(a.ACTIONED_ON || a.SUBMITTED_ON)).slice(0, 100).map(dto_); }
  function counts(actor) { return { regularization: records_().filter(record => key(record.STATUS) === 'PENDING' && canManage_(actor, record)).length }; }
  function workspace(actor, month) {
    if (['HUB_MANAGER','ADMIN','SUPER_ADMIN'].indexOf(role(actor)) < 0) throw new Error('Not authorised.');
    const pending = queue(actor);
    return {
      queue: pending,
      counts: { regularization: pending.length },
      approvedKm: approvedKm(actor),
      calendar: attendanceCalendar(actor, month),
      correctionRiders: correctionRiderOptions(actor),
      leaveQueue: Roster.leaveQueue(actor)
    };
  }
  function repository(actor, filters) {
    if (['HUB_MANAGER','ADMIN','SUPER_ADMIN'].indexOf(role(actor)) < 0) throw new Error('Not authorised.'); filters = filters || {};
    const term = str(filters.term).toLowerCase(), from = str(filters.from), to = str(filters.to), vendor = str(filters.vendor).toLowerCase();
    return records_().filter(record => canManage_(actor, record)).filter(record => !term || str(record.RIDER_NAME).toLowerCase().indexOf(term) >= 0 || str(record.EMPLOYEE_ID).toLowerCase().indexOf(term) >= 0).filter(record => !from || dateKey(record.ATTENDANCE_DATE) >= from).filter(record => !to || dateKey(record.ATTENDANCE_DATE) <= to).filter(record => !str(filters.zone) || same(record.ZONE, filters.zone)).filter(record => !str(filters.warehouse) || same(record.WAREHOUSE, filters.warehouse)).filter(record => !str(filters.lmHub) || same(record.LM_HUB, filters.lmHub)).filter(record => !vendor || str(record.VENDOR_NAME).toLowerCase() === vendor).map(dto_);
  }
  function riderOptions(actor) { if (!(role(actor) === 'ADMIN' && key(actor.ACCESS_SCOPE) === 'ZONE')) return []; return users_().filter(user => key(user.ROLE) === 'RIDER' && key(user.STATUS) === 'ACTIVE' && same(user.ZONE, actor.ZONE)).map(user => ({ username: str(user.USERNAME), name: str(user.RIDER_NAME), employeeId: str(user.EMPLOYEE_ID), zone: str(user.ZONE), warehouse: str(user.WAREHOUSE), lmHub: str(user.LM_HUB) })); }
  function zoneAdminEntry(actor, input) {
    if (!(role(actor) === 'ADMIN' && key(actor.ACCESS_SCOPE) === 'ZONE')) throw new Error('Only a Zone Admin can make a historical attendance entry.');
    const rider = activeRider_(input.username), type = key(input.type), workDate = dateKey(input.date), age = daysBetween(workDate, dateKey(new Date()));
    if (!rider || !same(rider.ZONE, actor.ZONE)) throw new Error('Rider is outside your Zone scope.'); if (['ATTENDANCE','KM'].indexOf(type) < 0 || age < 0 || age > 15) throw new Error('Zone Admin can enter Attendance or KM only for the previous 15 days.');
    const start = type === 'KM' ? Number(input.startKm) : '', end = type === 'KM' ? Number(input.endKm) : ''; if (type === 'KM' && (!isFinite(start) || !isFinite(end) || end < start)) throw new Error('Enter valid KM values.'); if (activeDuplicate_(rider, type, workDate)) throw new Error('An active ' + type + ' record already exists for this rider and date.');
    const id = 'ATT-' + Utilities.getUuid().slice(0, 8).toUpperCase(), now = new Date(); append_([id, type, rider.USERNAME, rider.RIDER_NAME, rider.EMPLOYEE_ID, rider.ZONE, rider.WAREHOUSE, rider.LM_HUB, rider.VENDOR_NAME, dateValue(workDate), start, end, type === 'KM' ? end-start : '', 'Approved', actor.USERNAME, actor.ROLE, now, actor.USERNAME, now, str(input.remarks), '']); const saved = records_().filter(record => record.REQUEST_ID === id)[0]; writeAttendance_(saved); notify_(users_().filter(user => same(user.USERNAME, rider.USERNAME)), 'Attendance marked by Zone Admin', 'Your ' + type + ' record for ' + workDate + ' was added by ' + actor.USERNAME + '.', id, NOTIFICATION.SUCCESS); return { success: true, message: 'Attendance record saved and approved.' };
  }
  function act(actor, id, decision, remarks) { const record = records_().filter(item => same(item.REQUEST_ID, id))[0]; if (!record || !canManage_(actor, record) || key(record.STATUS) !== 'PENDING') throw new Error('This request is not available for action.'); if(daysBetween(dateKey(record.ATTENDANCE_DATE),dateKey(new Date()))<0) throw new Error('Future dates cannot be marked present or absent.'); const status = key(decision); if (['APPROVED','REJECTED'].indexOf(status) < 0) throw new Error('Invalid action.'); sheet_().getRange(record.row, 14, 1, 7).setValues([[status === 'APPROVED' ? 'Approved' : 'Rejected', record.ASSIGNED_TO, record.ASSIGNED_ROLE, record.SUBMITTED_ON, actor.USERNAME, new Date(), str(remarks)]]); refreshRecords_(); if (status === 'APPROVED') writeAttendance_(record); notify_(users_().filter(user => same(user.USERNAME, record.USERNAME)), 'Attendance request ' + status.toLowerCase(), 'Your ' + record.REQUEST_TYPE + ' request for ' + dateKey(record.ATTENDANCE_DATE) + ' was ' + status.toLowerCase() + '.', record.REQUEST_ID, status === 'APPROVED' ? NOTIFICATION.SUCCESS : NOTIFICATION.ERROR); return { success: true, message: 'Request ' + status.toLowerCase() + '.' }; }
  function writeAttendance_(record) { const workDate = dateValue(record.ATTENDANCE_DATE), sheetName = Utilities.formatDate(workDate, Session.getScriptTimeZone(), 'MMM yyyy'), ss = attendanceSpreadsheet_(); let sheet = ss.getSheetByName(sheetName); if (!sheet) { sheet = ss.insertSheet(sheetName); sheet.getRange(1,1,1,8).setValues([['Rider Name','Zone','Warehouse','LM Hub','Start Date','End Date','Vendor Name','KMs']]); sheet.setFrozenRows(1); } const column = 9 + workDate.getDate() - 1; if (!sheet.getRange(1,column).getValue()) sheet.getRange(1,column).setValue(workDate).setNumberFormat('dd mmm yyyy'); const rows = sheet.getDataRange().getValues(); let index = rows.findIndex((row, i) => i > 0 && same(row[0], record.RIDER_NAME) && same(row[3], record.LM_HUB)); if (index < 0) { index = sheet.getLastRow() + 1; sheet.getRange(index,1,1,8).setValues([[record.RIDER_NAME,record.ZONE,record.WAREHOUSE,record.LM_HUB,'','',record.VENDOR_NAME,'Attendance']]); sheet.getRange(index+1,8).setValue('Start KM'); sheet.getRange(index+2,8).setValue('End KM'); sheet.getRange(index+3,8).setValue('Total'); } else index += 1; const cells = sheet.getRange(index,column,4,1).getValues(); if (key(record.REQUEST_TYPE) === 'ATTENDANCE') { const state=key(record.ATTENDANCE_STATE); cells[0][0] = state==='ABSENT' ? 'A' : (state==='LEAVE' ? 'L' : 'P'); } else { cells[1][0]=record.START_KM; cells[2][0]=record.END_KM; cells[3][0]=record.TOTAL_KM; } sheet.getRange(index,column,4,1).setValues(cells); }
  function editKm(actor, id, start, end) { const record=records_().filter(item=>same(item.REQUEST_ID,id))[0]; if(!record||key(record.REQUEST_TYPE)!=='KM'||key(record.STATUS)!=='APPROVED'||!canManage_(actor,record)) throw new Error('Only an authorised manager can edit approved KM records.'); start=Number(start);end=Number(end);if(!isFinite(start)||!isFinite(end)||end<start)throw new Error('Enter valid KM values.');sheet_().getRange(record.row,11,1,3).setValues([[start,end,end-start]]);refreshRecords_();record.START_KM=start;record.END_KM=end;record.TOTAL_KM=end-start;writeAttendance_(record);return {success:true,message:'Approved KM record updated.'}; }
  function reminders() { const now=Date.now(); records_().filter(record=>key(record.STATUS)==='PENDING'&&now-new Date(record.SUBMITTED_ON).getTime()>21600000&&(!record.REMINDER_SENT_ON||now-new Date(record.REMINDER_SENT_ON).getTime()>3600000)).forEach(record=>{const people=users_().filter(user=>str(record.ASSIGNED_TO).split(',').map(value=>value.trim().toLowerCase()).indexOf(str(user.USERNAME).toLowerCase())>=0);notify_(people,'Reminder: attendance action overdue',record.RIDER_NAME+' has a pending '+record.REQUEST_TYPE+' request older than 6 hours.',record.REQUEST_ID,NOTIFICATION.WARNING);sheet_().getRange(record.row,21).setValue(new Date());}); }
  function migrateLegacy() {
    const legacy = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(REQUEST_SHEET); if (!legacy || legacy.getLastRow() < 2) return 0;
    const ids = {}; records_().forEach(record => ids[str(record.REQUEST_ID)] = true);
    const rows = legacy.getRange(2, 1, legacy.getLastRow() - 1, Math.min(legacy.getLastColumn(), HEADERS.length)).getValues(); let copied = 0;
    rows.forEach(row => { if (!str(row[0]) || ids[str(row[0])]) return; const target = row.slice(0, HEADERS.length); while (target.length < HEADERS.length) target.push(''); sheet_().appendRow(target); ids[str(row[0])] = true; copied++; });
    return copied;
  }
  return { submit, mine, riderDashboard, attendanceCalendar, correctionRiderOptions, correctAttendance, queue, approvedKm, counts, workspace, repository, riderOptions, zoneAdminEntry, act, editKm, reminders, migrateLegacy };
})();

function sendAttendanceEscalationReminders() { Attendance.reminders(); }
/** Run once manually if historic request rows must be copied to the Attendance spreadsheet. */
function migrateLegacyAttendanceRequests() { return Attendance.migrateLegacy(); }
