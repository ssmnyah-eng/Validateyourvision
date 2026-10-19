const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
function backend() {
 const c = vm.createContext({console});
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../vyv-booking-backend.js'),'utf8'), c);
 return c;
}
test('deposit creation rejects unexpected amounts and requires a stable request ID', () => {
 const c=backend();
 assert.equal(c.createDepositIntent({amountCents:0}).ok,false);
 assert.equal(c.createDepositIntent({amountCents:25000}).ok,false);
 const calls=[];
 c.stripeRequest=(method,path,params,key)=>{calls.push({method,path,params,key});return path==='/customers'?{id:'cus_audit'}:{client_secret:'audit'};};
 assert.equal(c.createDepositIntent({amountCents:25000,email:'audit@example.invalid',name:'Audit',requestId:'audit-1234567890123456'}).ok,true);
 assert.equal(calls[1].params.confirm,undefined);
 assert.equal(calls[1].params.customer,'cus_audit');
 assert.ok(calls.every(x=>x.key));
});
test('save verifies payment and saves only once without another Stripe charge', () => {
 const c=backend();const calls=[];let row, count=0;
 c.stripeRequest=(method,path)=>{calls.push(method);return {id:'pi_audit',status:'succeeded',currency:'usd',amount_received:25000,metadata:{type:'deposit'},receipt_email:'audit@example.invalid',customer:'cus_audit',payment_method:'pm_audit'};};
 c.LockService={getScriptLock:()=>({waitLock(){},releaseLock(){}})};
 c.getOrCreateSheet=()=>({appendRow(r){row=r;count++;}});
 c.findBooking=id=>row?{ID:id,MoveToken:row[23]}:null;
 c.generateToken=()=> 'audit-token';
 c.sendConfirmationEmail=c.sendOwnerAlert=c.createCalendarEvent=()=>{};
 const input={paymentIntentId:'pi_audit',email:'audit@example.invalid'};
 assert.equal(c.saveBooking(input).ok,true);
 assert.equal(c.saveBooking(input).ok,true);
 assert.equal(count,1);
 assert.deepEqual(calls,['GET','GET']);
 assert.equal(row[17],'$250');
});
test('unpaid or mismatched deposits cannot create a booking',()=>{
 const c=backend();
 assert.throws(()=>c.verifiedDeposit({}),/paid deposit/);
 c.stripeRequest=()=>({status:'requires_payment_method',currency:'usd',amount_received:0});
 assert.throws(()=>c.verifiedDeposit({paymentIntentId:'pi_audit'}),/verification/);
});
