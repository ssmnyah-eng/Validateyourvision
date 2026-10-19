const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
function customerPage(file) {
 const html=fs.readFileSync(path.join(__dirname,'..',file),'utf8');
 const code=html.slice(html.indexOf('function moveDateParts('),html.indexOf('async function loadBooking()'));
 const c=vm.createContext({Intl,console});vm.runInContext(code,c);return c;
}
test('customer pages display legacy dates and arrival-window times',()=>{
 for (const file of ['cancel.html','reschedule.html']) {
  const c=customerPage(file);
  assert.equal(c.moveDateParts('Tuesday, October 20, 2026 PM').time,'16:00');
  assert.equal(c.moveDateParts('October 20, 2026 9:00 AM').time,'09:00');
  assert.match(c.fmt('Tuesday, October 20, 2026 AM'),/October 20, 2026/);
  assert.equal(c.moveDateParts('bad'),null);
 }
});
test('refund notice uses Eastern time for both winter and summer dates',()=>{
 const c=customerPage('cancel.html');
 for (const [date,expected] of [['January 20, 2027 AM','2027-01-20T12:00:00Z'],['July 20, 2027 PM','2027-07-20T20:00:00Z']]) {
  const observed=c.hoursUntil(date)*3600000+Date.now();assert.ok(Math.abs(observed-Date.parse(expected))<1000);
 }
});
test('careers shows success only after accepted submission and preserves rejected applications',async()=>{
 const html=fs.readFileSync(path.join(__dirname,'../careers.html'),'utf8');
 const code=html.slice(html.indexOf('async function submitApp('),html.lastIndexOf('</script>'));
 for (const accepted of [true,false]) {
  const success={style:{display:'none'},scrollIntoView(){}};const btn={};const form={style:{},action:'https://formspree.io/f/mwvdowqr',reportValidity:()=>true,querySelector:()=>btn};let sent=0,alerted=false;
  const c=vm.createContext({document:{getElementById:()=>success},fetch:async()=>{sent++;return {ok:accepted};},FormData:class {append(){}},alert:()=>alerted=true});
  vm.runInContext(code,c);await c.submitApp({preventDefault(){},target:form});assert.equal(sent,1);
  assert.equal(success.style.display,accepted?'block':'none');assert.equal(alerted,!accepted);
  if (!accepted) { assert.notEqual(form.style.display,'none');assert.equal(btn.disabled,false); }
 }
});
