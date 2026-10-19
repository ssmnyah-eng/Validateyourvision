const {test}=require('node:test');const assert=require('node:assert/strict');const vm=require('node:vm');const fs=require('node:fs');const path=require('node:path');const crypto=require('node:crypto');
const root=path.join(__dirname,'..');
function environment(){
 const tabs={};const cache=new Map();const props={DASHBOARD_PASSWORD:'fixture-password-not-for-real-use'};
 function sheet(){const rows=[];return {rows,getLastRow:()=>rows.length,setFrozenRows(){},appendRow:r=>rows.push([...r]),getDataRange:()=>({getValues:()=>rows}),getRange:(row,col,height,width)=>({getValues:()=>rows.slice(row-1,row-1+height).map(r=>r.slice(col-1,col-1+width)),setValues:values=>values.forEach((r,i)=>rows[row-1+i]=[...r])})};}
 const c=vm.createContext({console,URL,ContentService:{MimeType:{JSON:'json'},createTextOutput:text=>({text,setMimeType(){return this;}})},PropertiesService:{getScriptProperties:()=>({getProperty:key=>props[key]||''})},CacheService:{getScriptCache:()=>({get:k=>cache.get(k)||null,put:(k,v)=>cache.set(k,v),remove:k=>cache.delete(k)})},Utilities:{DigestAlgorithm:{SHA_256:'sha256'},Charset:{UTF_8:'utf8'},computeDigest:(_,v)=>crypto.createHash('sha256').update(v).digest(),base64EncodeWebSafe:b=>Buffer.from(b).toString('base64url'),getUuid:()=>crypto.randomUUID(),formatDate:()=>new Date().toISOString().slice(0,10)},LockService:{getScriptLock:()=>({waitLock(){},releaseLock(){}})},SpreadsheetApp:{openById:()=>({getSheetByName:n=>tabs[n]||null,insertSheet:n=>tabs[n]=sheet()})}});
 vm.runInContext(fs.readFileSync(path.join(root,'vyv-booking-backend.js'),'utf8'),c);
 const bookings=sheet();bookings.appendRow(Array(27).fill(''));c.getSheet=()=>bookings;
 const post=data=>JSON.parse(c.doPost({postData:{contents:JSON.stringify(data)}}).text);
 const login=()=>post({action:'staff_login',password:props.DASHBOARD_PASSWORD}).session;
 return {c,post,login,tabs,bookings,props};
}
const future=new Date(Date.now()+86400000*7).toISOString().slice(0,10);
function draft(){const stops=[{address:'First Public Street',propType:'Apartment',beds:'1',sqft:'0-1000'},{address:'Last Public Street',propType:'Home/Townhouse'}];return {id:crypto.randomUUID(),revision:0,name:'Test Customer',phone:'2025550100',email:'test@example.invalid',date:future,time:'AM',stops,volume:'everything',density:'normal',ready:'ready',specialty:[],packing:false,paymentLink:'',holdHours:24,distance:{baseMiles:2,moveMiles:10,routeKey:JSON.stringify(stops.map(s=>s.address))}};}
test('all staff data and writes require a server-issued session; password is not returned',()=>{
 const e=environment();assert.equal(e.post({action:'staff_list'}).code,'STAFF_AUTH');
 assert.equal(e.post({action:'staff_save',draft:draft()}).ok,false);
 assert.equal(e.post({action:'staff_login',password:'wrong'}).ok,false);
 const token=e.login();assert.equal(token.length,72);assert.equal(e.post({action:'staff_list',staffToken:token}).ok,true);
 assert.equal(e.post({action:'staff_logout',staffToken:token}).ok,true);assert.equal(e.post({action:'staff_list',staffToken:token}).ok,false);
});
test('password rotation invalidates prior sessions and staff cannot charge balances',()=>{
 const e=environment(),token=e.login();assert.equal(e.post({action:'charge_balance',staffToken:token}).ok,false);
 e.props.DASHBOARD_PASSWORD='different-private-fixture-password';assert.equal(e.post({action:'staff_list',staffToken:token}).ok,false);
});
test('partial call drafts save before customer/date/address details are complete',()=>{
 const e=environment(),token=e.login(),d=draft();d.name='';d.phone='';d.email='';d.date='';d.time='';d.stops[0].address='';
 const r=e.post({action:'staff_save',staffToken:token,draft:d});assert.equal(r.ok,true);assert.equal(r.record.status,'Draft');assert.equal(r.record.quote,null);
 assert.equal(e.post({action:'staff_list',staffToken:token}).records.length,1);
});
test('reserve is unpaid, uses shared estimate math and blocks another staff hold',()=>{
 const e=environment(),token=e.login(),d=draft();const expected=e.c.VYVStaffModel.quote(d);
 const r=e.post({action:'staff_save',staffToken:token,draft:d,reserve:true});assert.equal(r.ok,true);assert.equal(r.record.status,'Awaiting payment');assert.equal(r.record.paymentStatus,'Not verified');
 assert.deepEqual(r.record.quote.total,Array.from(expected.total));
 const conflict=e.post({action:'staff_save',staffToken:token,draft:draft(),reserve:true});assert.match(conflict.error,/already booked or held/);
 const slots=JSON.parse(e.c.getBookedSlots().text).slots;assert.ok(slots[future].includes('AM'));
});
test('a lost save response retries once without duplicate records or recursive snapshots',()=>{
 const e=environment(),token=e.login(),d=draft();const a=e.post({action:'staff_save',staffToken:token,draft:d,reserve:true});
 const b=e.post({action:'staff_save',staffToken:token,draft:d,reserve:true});assert.equal(a.record.id,b.record.id);assert.equal(b.record.revision,1);
 const records=e.post({action:'staff_list',staffToken:token}).records;assert.equal(records.length,1);assert.equal(records[0].savedRequest,undefined);
});
test('stale edits and unsafe payment links are rejected; cancellation releases the slot',()=>{
 const e=environment(),token=e.login(),d=draft();
 assert.equal(e.post({action:'staff_save',staffToken:token,draft:{...d,paymentLink:'javascript:alert(1)'}}).ok,false);
 const r=e.post({action:'staff_save',staffToken:token,draft:{...d,paymentLink:'https://buy.stripe.com/test'},reserve:true});assert.equal(r.ok,true);
 assert.equal(e.post({action:'staff_save',staffToken:token,draft:{...d,notes:'stale changed'}}).ok,false);
 const cancelled=e.post({action:'staff_cancel',staffToken:token,id:d.id,revision:r.record.revision});assert.equal(cancelled.record.status,'Cancelled');
 assert.deepEqual(JSON.parse(e.c.getBookedSlots().text).slots,{});
});
test('public paid bookings and packing holds prevent conflicting staff reservations',()=>{
 const e=environment(),token=e.login(),d=draft();const row=Array(27).fill('');row[5]=future+' AM';row[19]='Upcoming';e.bookings.appendRow(row);
 assert.equal(e.post({action:'staff_save',staffToken:token,draft:d,reserve:true}).ok,false);
});
test('optional packing holds are included in availability and expired holds stop blocking',()=>{
 const e=environment(),token=e.login(),d=draft();d.packing=true;d.packingDate=new Date(Date.now()+86400000*6).toISOString().slice(0,10);d.packingTime='PM';
 const saved=e.post({action:'staff_save',staffToken:token,draft:d,reserve:true});assert.equal(saved.ok,true);
 const slots=JSON.parse(e.c.getBookedSlots().text).slots;assert.ok(slots[d.packingDate].includes('PM'));
 const other=draft();other.date=d.packingDate;other.time='PM';assert.equal(e.post({action:'staff_save',staffToken:token,draft:other,reserve:true}).ok,false);
 const sheet=e.tabs['Staff Reservations'];const record=JSON.parse(sheet.rows[1][10]);record.holdUntil='2000-01-01T00:00:00Z';sheet.rows[1][10]=JSON.stringify(record);
 assert.deepEqual(JSON.parse(e.c.getBookedSlots().text).slots,{});
});
test('staff estimates use the public day rates, mileage thresholds and packing rates',()=>{
 const e=environment(),d=draft();const q=e.c.VYVStaffModel.quote(d);const day=new Date(d.date+'T12:00:00Z').getUTCDay();
 assert.equal(q.rate,[220,201,199,199,199,210,220][day]);assert.equal(q.truckFee,99);assert.equal(q.deposit,250);
 d.distance.moveMiles=60;d.distance.baseMiles=51;const far=e.c.VYVStaffModel.quote(d);assert.equal(far.truckFee,125);assert.equal(far.deposit,300);
 d.packing=true;d.packingDate=d.date;d.packingTime='PM';assert.equal(e.c.VYVStaffModel.quote(d).packingRate,q.rate);
});
