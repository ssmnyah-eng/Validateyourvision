const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
function backend() {
 const c = vm.createContext({console, ContentService:{MimeType:{JSON:'json'},createTextOutput:text=>({text,setMimeType(){return this;}})}});
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../vyv-booking-backend.js'),'utf8'), c);
 c.getSheet=()=>({getDataRange:()=>({getValues:()=>[[]]})});
 return c;
}
const decoded = result => JSON.parse(result.text);
const payment = () => ({id:'pi_audit',status:'succeeded',currency:'usd',amount_received:25000,metadata:{type:'deposit'},receipt_email:'audit@example.invalid',customer:'cus_audit',payment_method:'pm_audit'});
test('deposit creation validates amount and uses stable idempotency keys', () => {
 const c=backend();
 assert.equal(decoded(c.createPaymentIntent({amountCents:0})).ok,false);
 assert.equal(decoded(c.createPaymentIntent({amountCents:25000})).ok,false);
 const calls=[];
 c.stripeApi=(method,path,params,key)=>{calls.push({method,path,params,key});return path==='/customers'?{id:'cus_audit'}:{client_secret:'audit'};};
 const result=c.createPaymentIntent({amountCents:25000,email:'audit@example.invalid',name:'Audit',requestId:'audit-1234567890123456'});
 assert.equal(decoded(result).clientSecret,'audit');
 assert.equal(calls[1].params.confirm,undefined);
 assert.equal(calls[1].params.customer,'cus_audit');
 assert.ok(calls.every(x=>x.key));
});
test('verified deposit saves once in the existing 27-column layout without another charge', () => {
 const c=backend();const calls=[];const rows=[Array(27).fill('')];
 c.stripeApi=(method,path)=>{calls.push(method);return payment();};
 c.LockService={getScriptLock:()=>({waitLock(){},releaseLock(){}})};
 c.getSheet=()=>({appendRow:r=>rows.push(r),getDataRange:()=>({getValues:()=>rows})});
 c.generateToken=()=> 'audit-token';
 c.sendConfirmationEmail=c.notifyAdmin=()=>{};
 const input={paymentIntentId:'pi_audit',email:'audit@example.invalid'};
 assert.equal(decoded(c.saveBooking(input)).moveToken,'audit-token');
 assert.equal(decoded(c.saveBooking(input)).id,'audit-token');
 assert.equal(rows.length,2);
 assert.equal(rows[1].length,27);
 assert.deepEqual(calls,['get','get']);
 assert.equal(rows[1][16],'$250');
 assert.equal(rows[1][17],'pi_audit');
 assert.equal(rows[1][18],'pm_audit');
});
test('unpaid and mismatched deposits cannot create a booking',()=>{
 const c=backend();
 assert.throws(()=>c.verifyDeposit({}),/paid deposit/);
 c.stripeApi=()=>({...payment(),status:'requires_payment_method'});
 assert.throws(()=>c.verifyDeposit({paymentIntentId:'pi_audit'}),/verification/);
 c.stripeApi=payment;
 assert.throws(()=>c.verifyDeposit({paymentIntentId:'pi_audit',email:'other@example.invalid'}),/verification/);
});
test('availability understands AM and PM and ignores cancelled bookings',()=>{
 const c=backend();const rows=[[],Array(27).fill(''),Array(27).fill(''),Array(27).fill('')];
 rows[1][5]='Tuesday, October 20, 2026 AM';rows[1][19]='Upcoming';
 rows[2][5]='Tuesday, October 20, 2026 PM';rows[2][19]='Upcoming';
 rows[3][5]='Wednesday, October 21, 2026 AM';rows[3][19]='Cancelled';
 c.getSheet=()=>({getDataRange:()=>({getValues:()=>rows})});
 assert.deepEqual(decoded(c.getBookedSlots()).slots,{'2026-10-20':['AM','PM']});
});
test('customer check-in does not reset a running timer',()=>{
 const c=backend();const row=Array(27).fill('');row[21]='2026-10-20T11:00:00Z';
 c.findRow=()=>row;
 c.updateRowField=()=>{throw Error('Timer must not reset');};
 assert.equal(decoded(c.customerCheckin({moveToken:'audit'})).checkinAt,row[21]);
});
test('legacy headerless bookings are copied to the new layout without dropping the first row',()=>{
 const c=backend();const old=Array(28).fill('');
 old[0]='VYV-audit';old[1]='2026-07-21T19:15:27Z';old[2]='Audit';old[3]='audit@example.invalid';
 old[5]='October 20, 2026 AM';old[7]='3 Movers';old[17]='250';old[18]='pm_audit';old[20]='Upcoming';old[23]='move-audit';
 const snapshot=JSON.stringify(old);
 const rows=c.convertLegacyRows([old]);
 assert.equal(rows.length,1);assert.equal(rows[0].length,27);
 assert.equal(rows[0][1],'move-audit');assert.equal(rows[0][2],'Audit');
 assert.equal(rows[0][16],'250');assert.equal(rows[0][19],'Upcoming');
 assert.equal(JSON.stringify(old),snapshot);
 assert.throws(()=>c.convertLegacyRows([['unrecognized']]),/not recognized/);
});
test('setup creates an isolated tab and is safe to run twice',()=>{
 const c=backend();const source=[Array(28).fill('')];source[0][0]='VYV-audit';source[0][23]='move-audit';
 const original=JSON.stringify(source);const tabs={'Bookings':{getDataRange:()=>({getValues:()=>source})}};
 let created=0;
 c.SpreadsheetApp={openById:()=>({getSheetByName:n=>tabs[n],insertSheet:n=>{
   created++;const rows=[];let columns=26;
   const sheet={getMaxColumns:()=>columns,insertColumnsAfter:(_,count)=>columns+=count,setFrozenRows(){},getLastRow:()=>rows.length,getMaxRows:()=>1000,
    getDataRange:()=>({getValues:()=>rows}),getRange:(start,col,height,width)=>({getValues:()=>rows.slice(start-1,start-1+height),setValues:values=>values.forEach((row,i)=>rows[start-1+i]=[...row])})};
   tabs[n]=sheet;return sheet;
 }})};
 c.LockService={getScriptLock:()=>({waitLock(){},releaseLock(){}})};
 c.getProp=()=> 'configured';
 assert.equal(c.setupBackend().copied,1);
 assert.equal(c.setupBackend().copied,0);
 assert.equal(created,1);assert.equal(JSON.stringify(source),original);
 assert.equal(tabs['Bookings VYV'].getDataRange().getValues().length,2);
});
