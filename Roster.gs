/** Roster and unpaid-leave service. Data is held in the Attendance spreadsheet. */
const Roster = (() => {
  const FILE_ID = '1o4D3VKI-7Vv7W2xQZcnzWLkjHa0IbAQGoG2cbu4-YP0';
  const ROSTER_HEADERS = ['ROSTER_ID','USERNAME','RIDER_NAME','EMPLOYEE_ID','ZONE','WAREHOUSE','LM_HUB','ROSTER_DATE','SHIFT','WEEK_OFF','UPDATED_BY','UPDATED_ON'];
  const LEAVE_HEADERS = ['LEAVE_ID','USERNAME','RIDER_NAME','EMPLOYEE_ID','ZONE','WAREHOUSE','LM_HUB','LEAVE_DATE','LEAVE_TYPE','REASON','STATUS','ASSIGNED_TO','SUBMITTED_ON','ACTIONED_BY','ACTIONED_ON'];
  const text = value => Utility.safeString(value).trim();
  const key = value => text(value).toUpperCase().replace(/[^A-Z0-9]+/g,'_').replace(/^_|_$/g,'');
  const same = (a,b) => text(a).toLowerCase() === text(b).toLowerCase();
  const role = user => key(user.ROLE) === 'MANAGER' ? 'HUB_MANAGER' : key(user.ROLE);
  let spreadsheetCache_ = null;
  const sheetCache_ = {};
  const valuesCache_ = {};
  let usersCache_ = null;
  // Roster uploads are entered by people, not systems. Accept the common
  // day-first formats supplied by operations and normalise them to yyyy-MM-dd.
  // Examples: 1-Aug-26, 01-08-26, 1-8-26, 01-08-2026 and 1-8-2026.
  const monthNumber_ = value => ({jan:1,january:1,feb:2,february:2,mar:3,march:3,apr:4,april:4,may:5,jun:6,june:6,jul:7,july:7,aug:8,august:8,sep:9,sept:9,september:9,oct:10,october:10,nov:11,november:11,dec:12,december:12})[text(value).toLowerCase()] || 0;
  const fullYear_ = value => { const year=Number(value); return String(value).length===2 ? 2000+year : year; };
  const normalDate_ = (year, month, day) => {
    const parsed = new Date(Number(year), Number(month)-1, Number(day), 12);
    if (!Number.isInteger(Number(year)) || !Number.isInteger(Number(month)) || !Number.isInteger(Number(day)) || parsed.getFullYear()!==Number(year) || parsed.getMonth()!==Number(month)-1 || parsed.getDate()!==Number(day)) throw new Error('Invalid roster date.');
    return Utilities.formatDate(parsed,Session.getScriptTimeZone(),'yyyy-MM-dd');
  };
  const dateKey = value => {
    if (value instanceof Date && !isNaN(value.getTime())) return Utilities.formatDate(value,Session.getScriptTimeZone(),'yyyy-MM-dd');
    const raw=text(value); if(/^\d{4}-\d{2}-\d{2}$/.test(raw)) return normalDate_(raw.slice(0,4),raw.slice(5,7),raw.slice(8,10));
    let p=raw.match(/^(\d{1,2})[-\s/]([A-Za-z]+)[-\s/](\d{2}|\d{4})$/);
    if(p) return normalDate_(fullYear_(p[3]),monthNumber_(p[2]),p[1]);
    p=raw.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{2}|\d{4})$/);
    if(p) return normalDate_(fullYear_(p[3]),p[2],p[1]);
    throw new Error('Invalid roster date. Use DD-MMM-YYYY, DD-MM-YYYY or DD-MM-YY.');
  };
  const dateValue = value => { const p=dateKey(value).split('-'); return new Date(+p[0],+p[1]-1,+p[2],12); };
  const dayDifference_ = (from, to) => Math.round((Date.UTC(+to.slice(0,4),+to.slice(5,7)-1,+to.slice(8,10))-Date.UTC(+from.slice(0,4),+from.slice(5,7)-1,+from.slice(8,10)))/86400000);
  function ss_(){if(!spreadsheetCache_)spreadsheetCache_=SpreadsheetApp.openById(FILE_ID);return spreadsheetCache_;}
  function sheet_(name, headers){if(sheetCache_[name])return sheetCache_[name];const ss=ss_();let sheet=ss.getSheetByName(name);if(!sheet){sheet=ss.insertSheet(name);sheet.getRange(1,1,1,headers.length).setValues([headers]);sheet.setFrozenRows(1);}sheetCache_[name]=sheet;return sheet;}
  function values_(name,headers){if(valuesCache_[name])return valuesCache_[name];const s=sheet_(name,headers);if(s.getLastRow()<2)return valuesCache_[name]=[];valuesCache_[name]=s.getRange(2,1,s.getLastRow()-1,headers.length).getValues().map((row,i)=>{const out={row:i+2};headers.forEach((h,j)=>out[h]=row[j]);return out;});return valuesCache_[name];}
  function users_(){if(!usersCache_)usersCache_=Database.users.all().map(record=>Object.assign({row:record.row},record.data));return usersCache_;}
  function refresh_(name){delete valuesCache_[name];}
  function canManage_(actor,record){const r=role(actor);if(r==='SUPER_ADMIN')return true;if(r==='HUB_MANAGER')return key(actor.ACCESS_SCOPE)==='LM_HUB'&&same(actor.LM_HUB,record.LM_HUB);if(r==='ADMIN'&&key(actor.ACCESS_SCOPE)==='WAREHOUSE')return same(actor.WAREHOUSE,record.WAREHOUSE);return r==='ADMIN'&&key(actor.ACCESS_SCOPE)==='ZONE'&&same(actor.ZONE,record.ZONE);}
  function owners_(rider){const users=users_().filter(u=>key(u.STATUS)==='ACTIVE');let result=users.filter(u=>key(u.ROLE)==='HUB_MANAGER'&&key(u.ACCESS_SCOPE)==='LM_HUB'&&same(u.LM_HUB,rider.LM_HUB));if(!result.length)result=users.filter(u=>key(u.ROLE)==='ADMIN'&&key(u.ACCESS_SCOPE)==='WAREHOUSE'&&same(u.WAREHOUSE,rider.WAREHOUSE));if(!result.length)result=users.filter(u=>key(u.ROLE)==='ADMIN'&&key(u.ACCESS_SCOPE)==='ZONE'&&same(u.ZONE,rider.ZONE));if(!result.length)result=users.filter(u=>key(u.ROLE)==='SUPER_ADMIN'&&key(u.ACCESS_SCOPE)==='PAN_INDIA');return result;}
  function dto_(record, headers){const result={};headers.forEach(h=>result[h.toLowerCase()]=record[h] instanceof Date?Utility.formatDateTime(record[h]):record[h]);result.date_iso=dateKey(record.ROSTER_DATE||record.LEAVE_DATE);return result;}
  function list(actor, from, to){const roster=values_('Rosters',ROSTER_HEADERS).filter(r=>role(actor)==='RIDER'?same(r.USERNAME,actor.USERNAME):canManage_(actor,r)).filter(r=>!from||dateKey(r.ROSTER_DATE)>=from).filter(r=>!to||dateKey(r.ROSTER_DATE)<=to).map(r=>dto_(r,ROSTER_HEADERS));return roster;}
  function upload(actor, rows){
    if(['HUB_MANAGER','ADMIN','SUPER_ADMIN'].indexOf(role(actor))<0)throw new Error('Only Hub Managers, Admins and Super Admins can upload rosters.');
    if(!Array.isArray(rows)||!rows.length)throw new Error('Upload at least one roster row.');
    const users=users_(), sheet=sheet_('Rosters',ROSTER_HEADERS), existing=values_('Rosters',ROSTER_HEADERS), index={}, skipped=[], inserts=[], updates=[];
    existing.forEach(r=>index[text(r.USERNAME).toLowerCase()+'|'+dateKey(r.ROSTER_DATE)]=r);
    let saved=0;
    rows.forEach((input, position)=>{
      const rowNumber=Number(input.rowNumber)||position+2, username=text(input.username), riderName=text(input.riderName), supplied=username||riderName;
      try {
        if(!supplied) throw new Error('Username or Rider Name is required.');
        const date=dateKey(input.date);
        if(dayDifference_(date,dateKey(new Date()))>7) throw new Error('Roster updates are allowed only for today and the previous 7 days.');
        const candidates=users.filter(u=>key(u.ROLE)==='RIDER'&&key(u.STATUS)==='ACTIVE'&&(same(u.USERNAME,supplied)||same(u.RIDER_NAME,supplied)));
        if(!candidates.length) throw new Error('Active rider not found: '+supplied);
        if(candidates.length>1) throw new Error('More than one active rider matches: '+supplied+'. Use Username.');
        const rider=candidates[0];
        if(!canManage_(actor,rider)) throw new Error('Rider is outside your permitted scope: '+supplied);
        const values=['RST-'+Utilities.getUuid().slice(0,8).toUpperCase(),rider.USERNAME,rider.RIDER_NAME,rider.EMPLOYEE_ID,rider.ZONE,rider.WAREHOUSE,rider.LM_HUB,dateValue(date),text(input.shift)||'General',text(input.weekOff)||'No',actor.USERNAME,new Date()];
        const old=index[text(rider.USERNAME).toLowerCase()+'|'+date];
        if(old) updates.push({row:old.row,values:values}); else inserts.push(values);
        saved++;
      } catch(error) { skipped.push({row:rowNumber,rider:supplied||'Blank',reason:text(error.message||error)}); }
    });
    updates.forEach(item=>sheet.getRange(item.row,1,1,ROSTER_HEADERS.length).setValues([item.values]));
    if(inserts.length)sheet.getRange(sheet.getLastRow()+1,1,inserts.length,ROSTER_HEADERS.length).setValues(inserts);
    if(sheet.getLastRow()>1) sheet.getRange(2,8,sheet.getLastRow()-1,1).setNumberFormat('dd/MM/yyyy');
    refresh_('Rosters');
    const summary=saved+' roster record(s) saved'+(skipped.length?'; '+skipped.length+' row(s) skipped.':' successfully.');
    return {success:true,saved:saved,skipped:skipped,message:summary};
  }
  function myLeaves(actor){return values_('Leave Requests',LEAVE_HEADERS).filter(r=>same(r.USERNAME,actor.USERNAME)).map(r=>dto_(r,LEAVE_HEADERS));}
  function applyLeave(actor,input){const rider=users_().filter(u=>same(u.USERNAME,actor.USERNAME)&&key(u.ROLE)==='RIDER'&&key(u.STATUS)==='ACTIVE')[0];if(!rider)throw new Error('Only an active Rider can apply for unpaid leave.');const date=dateKey(input.date),existing=values_('Leave Requests',LEAVE_HEADERS).some(r=>same(r.USERNAME,rider.USERNAME)&&dateKey(r.LEAVE_DATE)===date&&key(r.STATUS)!=='REJECTED');if(existing)throw new Error('An active leave request already exists for this date.');const owners=owners_(rider);if(!owners.length)throw new Error('No responsible leave approver is mapped.');const id='LV-'+Utilities.getUuid().slice(0,8).toUpperCase();sheet_('Leave Requests',LEAVE_HEADERS).appendRow([id,rider.USERNAME,rider.RIDER_NAME,rider.EMPLOYEE_ID,rider.ZONE,rider.WAREHOUSE,rider.LM_HUB,dateValue(date),'Unpaid',text(input.reason),'Pending',owners.map(u=>u.USERNAME).join(', '),new Date(),'','']);owners.forEach(u=>Notification.create({username:u.USERNAME,role:u.ROLE,title:'Unpaid leave approval pending',message:rider.RIDER_NAME+' requested unpaid leave for '+date+'.',submissionId:id,type:NOTIFICATION.WARNING}));return {success:true,message:'Unpaid leave request sent for approval.'};}
  function leaveQueue(actor){if(['HUB_MANAGER','ADMIN','SUPER_ADMIN'].indexOf(role(actor))<0)throw new Error('Not authorised.');return values_('Leave Requests',LEAVE_HEADERS).filter(r=>key(r.STATUS)==='PENDING'&&canManage_(actor,r)).map(r=>dto_(r,LEAVE_HEADERS));}
  function actionLeave(actor,id,decision){const record=values_('Leave Requests',LEAVE_HEADERS).filter(r=>same(r.LEAVE_ID,id))[0];if(!record||key(record.STATUS)!=='PENDING'||!canManage_(actor,record))throw new Error('This leave request is not available for action.');const status=key(decision)==='APPROVED'?'Approved':'Rejected';sheet_('Leave Requests',LEAVE_HEADERS).getRange(record.row,11,1,5).setValues([[status,record.ASSIGNED_TO,record.SUBMITTED_ON,actor.USERNAME,new Date()]]);users_().filter(u=>same(u.USERNAME,record.USERNAME)).forEach(u=>Notification.create({username:u.USERNAME,role:u.ROLE,title:'Unpaid leave '+status.toLowerCase(),message:'Your unpaid leave for '+dateKey(record.LEAVE_DATE)+' was '+status.toLowerCase()+'.',submissionId:record.LEAVE_ID,type:status==='Approved'?NOTIFICATION.SUCCESS:NOTIFICATION.ERROR}));return {success:true,message:'Unpaid leave '+status.toLowerCase()+'.'};}
  return {list,upload,myLeaves,applyLeave,leaveQueue,actionLeave};
})();
