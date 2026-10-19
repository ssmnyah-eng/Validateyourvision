(function(){
 'use strict';
 const ENDPOINT='https://script.google.com/macros/s/AKfycbw1yL2yQICaVmDsveep-b2KOYkABwjqH6lMMpH0pesOvFaXZ9mrd43Drt8nU14km5N2/exec';
 const $=id=>document.getElementById(id);
 const money=n=>'$'+Math.round(n).toLocaleString('en-US');
 const range=a=>a.map(money).join(' – ');
 const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const easternToday=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 const stop=()=>({address:'',unit:'',propType:'Home/Townhouse',beds:'',sqft:'',garage:'None',stories:'',floorLevel:'',elevator:'',unitSize:''});
 const empty=()=>({id:crypto.randomUUID(),revision:0,name:'',phone:'',email:'',notes:'',date:'',time:'',stops:[stop(),stop()],volume:'everything',density:'normal',boxes:'',longCarry:false,specialty:[],ready:'ready',packing:false,packingDate:'',packingTime:'',paymentLink:'',holdHours:24,status:'Draft',distance:null});
 let draft=empty(), session='', records=[], dirty=false, busy=false, routeGeneration=0, editVersion=0;
 const fields={'customer-name':'name','customer-phone':'phone','customer-email':'email','customer-notes':'notes','move-date':'date','move-time':'time','move-volume':'volume','move-density':'density','move-boxes':'boxes','long-carry':'longCarry','packing-ready':'ready','packing-selected':'packing','packing-date':'packingDate','packing-time':'packingTime','stripe-link':'paymentLink','hold-hours':'holdHours'};
 function message(id,text){$(id).textContent=text;}
 async function api(action,payload={}){
  const response=await fetch(ENDPOINT,{method:'POST',body:JSON.stringify({action,staffToken:session,...payload})});
  const data=await response.json();
  if(!data.ok){
   if(data.code==='STAFF_AUTH'){session='';$('workspace').hidden=true;$('login-panel').hidden=false;$('logout').hidden=true;message('login-message','Your session expired. Sign in again; this call is still open in this tab.');}
   throw Error(data.error||'The request could not be completed.');
  }
  return data;
 }
 function tab(name){
  for(const button of document.querySelectorAll('[data-tab]')){
   const selected=button.dataset.tab===name;button.setAttribute('aria-selected',String(selected));button.tabIndex=selected?0:-1;$('panel-'+button.dataset.tab).hidden=!selected;
  }
 }
 function read(){
  for(const [id,key]of Object.entries(fields)){const el=$(id);draft[key]=el.type==='checkbox'?el.checked:el.value;}
  draft.holdHours=Number(draft.holdHours)||24;
  draft.specialty=[...document.querySelectorAll('[data-specialty]:checked')].map(el=>el.value);
  for(const el of document.querySelectorAll('[data-stop-field]'))draft.stops[Number(el.dataset.stopIndex)][el.dataset.stopField]=el.value;
  if(draft.distance?.routeKey!==VYVStaffModel.routeKey(draft))draft.distance=null;
  return draft;
 }
 function markDirty(){editVersion++;dirty=true;message('save-state','Unsaved changes');read();refreshQuote();}
 function options(values,value){return '<option value="">Not specified</option>'+values.map(v=>{const [key,label]=Array.isArray(v)?v:[v,v];return '<option value="'+escape(key)+'"'+(String(value)===String(key)?' selected':'')+'>'+escape(label)+'</option>';}).join('');}
 function stopField(i,key,label,type='text',values){const value=draft.stops[i][key]??'';const attrs='id="staff-stop-'+i+'-'+key+'" data-stop-index="'+i+'" data-stop-field="'+key+'"';return '<label>'+label+(values?'<select '+attrs+'>'+options(values,value)+'</select>':'<input '+attrs+' type="'+type+'" value="'+escape(value)+'"'+(type==='number'?' min="0" max="100"':' maxlength="500"')+'>')+'</label>';}
 function renderStops(){
  $('staff-stops').innerHTML=draft.stops.map((s,i)=>'<section class="stop-card"><div class="stop-head"><h3>'+escape(i===0?'Pickup':i===draft.stops.length-1?'Destination':'Extra stop '+i)+'</h3><div class="stop-actions"><button type="button" data-up="'+i+'" '+(i===0?'disabled':'')+'>↑</button><button type="button" data-down="'+i+'" '+(i===draft.stops.length-1?'disabled':'')+'>↓</button>'+(draft.stops.length>2?'<button type="button" data-remove="'+i+'">Remove</button>':'')+'</div></div>'+stopField(i,'address','Street address')+stopField(i,'unit','Apartment / unit')+'<div class="field-grid">'+stopField(i,'propType','Property type','text',['Home/Townhouse','Apartment','Highrise','Office','Storage'])+stopField(i,'beds','Bedrooms','text',[1,2,3,4,'5+','6','7','8+'])+stopField(i,'sqft','Square footage','text',['0-1000','1000-1500','1500-2000','2000-3000','3000+'])+stopField(i,'floorLevel','Floor level','number')+stopField(i,'stories','Stories','text',[1,2,3,'4+'])+stopField(i,'elevator','Elevator','text',[['yes','Yes'],['no','No']])+stopField(i,'garage','Garage','text',['None','1 Car','2 Car','3+ Car'])+stopField(i,'unitSize','Storage unit size','text',['5x5','5x10','5x15','10x10','10x15','10x20','10x25','10x30'])+'</div></section>').join('');
  for(const input of document.querySelectorAll('[data-stop-field="address"]'))VYVAddresses.attach(input);
 }
 function renderEditor(){
  for(const [id,key]of Object.entries(fields)){const el=$(id);if(el.type==='checkbox')el.checked=!!draft[key];else el.value=draft[key]??'';}
  for(const el of document.querySelectorAll('[data-specialty]'))el.checked=draft.specialty.includes(el.value);
  renderStops();refreshQuote();refreshStatus();
 }
 function refreshStatus(){
  const expires=draft.holdUntil?new Date(draft.holdUntil).toLocaleString():'';
  message('record-status',(draft.status||'Draft')+(draft.revision?' · saved call':' · new call')+(expires?' · hold until '+expires:''));
  $('cancel-reservation').hidden=draft.status!=='Awaiting payment';
 }
 function refreshQuote(){
  message('summary-name',draft.name||'New customer');
  message('summary-date',draft.date?(draft.date+' · '+(draft.time||'window not selected')):'Date not selected');
  message('summary-route',draft.stops.map(s=>s.address||'Address needed').join(' → '));
  try{message('date-rate',VYVPricing.rateForDate(draft.date,3)?money(VYVPricing.rateForDate(draft.date,3))+'/hr · 3 movers':'');}catch{message('date-rate','Choose a date to see the rate');}
  try{
   draft.quote=VYVStaffModel.quote(draft);const q=draft.quote;
   $('quote-detail').hidden=false;message('detail-total',range(q.total));message('summary-total',range(q.total));
   message('detail-hours',q.hours.join('–')+' moving hours · 3 movers at '+money(q.rate)+'/hr');
   message('summary-caption',q.hours.join('–')+' hrs · Deposit '+money(q.deposit)+' · Balance '+range(q.balance));
   const rows=[['Moving labor',range(q.labor)],['Truck fee',money(q.truckFee)],['Packing / unpacking labor',draft.packing?range(q.packing):'Not selected'],['Deposit due (credited)',money(q.deposit)],['Estimated remaining balance',range(q.balance)]];
   $('quote-breakdown').replaceChildren();
   for(const [label,value]of rows){const row=document.createElement('div'),dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=label;dd.textContent=value;row.append(dt,dd);$('quote-breakdown').append(row);}
   const labels={protection:'Wrapping / preparation',loading:'Loading',driving:'Driving between locations',unloading:'Unloading / placement',preparation:'Unfinished preparation allowance'};
   message('stage-detail',Object.entries(q.stages).filter(([k,v])=>v[1]>0).map(([k,v])=>labels[k]+': '+v.join('–')+' hrs').join('\n'));
   message('review-note',q.needsReview?'Crew review recommended for this inventory or preparation level.':'Estimate includes loading, travel between locations and unloading.');
   message('quote-message','Route: '+draft.distance.moveMiles+' mi · Pickup: '+draft.distance.baseMiles+' mi from Fredericksburg');
  }catch(error){draft.quote=null;$('quote-detail').hidden=true;message('summary-total','—');message('summary-caption',error.message);message('quote-message',error.message);}
 }
 async function calculate(){
  read();const key=VYVStaffModel.routeKey(draft),generation=++routeGeneration,callId=draft.id;
  const addresses=draft.stops.map(s=>s.address.trim());
  if(!draft.date||addresses.some(s=>!s)){refreshQuote();return;}
  $('calculate-quote').disabled=true;message('quote-message','Checking route…');
  try{
   const distances=await Promise.all([VYVAddresses.routeMiles('Fredericksburg, VA 22401',addresses[0]),...addresses.slice(1).map((address,i)=>VYVAddresses.routeMiles(addresses[i],address))]);
   if(generation!==routeGeneration||callId!==draft.id)return;
   read();if(key!==VYVStaffModel.routeKey(draft))throw Error('Addresses changed. Update the route again.');
   draft.distance={routeKey:key,baseMiles:distances[0],moveMiles:Math.round(distances.slice(1).reduce((a,b)=>a+b,0)*10)/10};
   editVersion++;dirty=true;message('save-state','Unsaved changes');refreshQuote();
  }catch(error){if(generation!==routeGeneration||callId!==draft.id)return;draft.distance=null;refreshQuote();message('quote-message',error.message||'Route unavailable. Check complete addresses and retry.');}
  finally{$('calculate-quote').disabled=false;}
 }
 async function save(reserve=false){
  if(busy)return;read();
  try{
   if(draft.paymentLink&&!VYVStaffModel.isStripeLink(draft.paymentLink))throw Error('Use a valid HTTPS Stripe payment or invoice link.');
   if(reserve)VYVStaffModel.validateReservation(draft,easternToday());
   busy=true;$('save-draft').disabled=$('reserve').disabled=true;
   message(reserve?'reservation-message':'save-state',reserve?'Reserving without charging a card…':'Saving draft…');
   const outgoing=JSON.parse(JSON.stringify(draft)),savedEditVersion=editVersion;
   const result=await api('staff_save',{draft:outgoing,reserve});
   if(draft.id===outgoing.id){
    if(editVersion===savedEditVersion){draft=result.record;dirty=false;renderEditor();message('save-state','Saved');}
    else {for(const key of ['revision','status','holdUntil','updatedAt','paymentStatus','savedRequestHash','savedAsReservation'])draft[key]=result.record[key];dirty=true;refreshStatus();refreshQuote();message('save-state','Earlier changes saved; new edits are still unsaved.');}
    message('reservation-message',reserve?'Reservation saved as awaiting payment. No card charged and no message sent.':'Draft saved.');
   }
   await loadRecords();
  }catch(error){message(reserve?'reservation-message':'save-state',error.message);}
  finally{busy=false;$('save-draft').disabled=$('reserve').disabled=false;}
 }
 async function loadRecords(){
  try{const data=await api('staff_list');records=data.records||[];renderRecords();}catch(e){message('saved-records',e.message);}
 }
 function renderRecords(){
  const query=$('record-search').value.toLowerCase();$('saved-records').replaceChildren();
  for(const record of records.filter(r=>[r.name,r.phone,r.email,r.date].join(' ').toLowerCase().includes(query))){
   const button=document.createElement('button');button.type='button';button.className='record';button.textContent=record.name||'Unnamed draft';
   const detail=document.createElement('span');const expired=record.status==='Awaiting payment'&&Date.parse(record.holdUntil)<Date.now();detail.textContent=(record.date||'Date not set')+' · '+(expired?'Hold expired':record.status);button.append(detail);
   button.addEventListener('click',()=>{if(dirty&&!confirm('Leave the unsaved changes in this call?'))return;draft=JSON.parse(JSON.stringify(record));++routeGeneration;editVersion++;dirty=false;renderEditor();message('save-state','Saved record opened');message('reservation-message','');});$('saved-records').append(button);
  }
  if(!$('saved-records').children.length)message('saved-records','No saved calls found.');
 }
 async function availability(){
  try{const r=await fetch(ENDPOINT+'?action=get_booked_slots');const data=await r.json();if(!data.ok)throw Error(data.error);const taken=data.slots?.[draft.date]||[];message('availability',draft.date?(taken.length?'Booked / held windows: '+taken.join(', ')+'. Final availability is checked when reserving.':'No booked windows reported for this date. Final availability is checked when reserving.'):'Choose a date, then refresh availability.');}
  catch{message('availability','Availability could not be loaded. Reservation availability will be checked by the server.');}
 }
 $('login-form').addEventListener('submit',async e=>{
  e.preventDefault();$('login-button').disabled=true;message('login-message','Checking secure sign-in…');
  try{
   const health=await(await fetch(ENDPOINT+'?action=health')).json();
   if(!health.dashboardEnabled)throw Error('One-time setup needed: deploy the provided staff dashboard backend, then try again.');
   if(!health.dashboardConfigured)throw Error('Set DASHBOARD_PASSWORD in Apps Script Properties, then try again.');
   const data=await api('staff_login',{password:$('password').value});session=data.session;$('password').value='';$('login-panel').hidden=true;$('workspace').hidden=false;$('logout').hidden=false;renderEditor();await loadRecords();
  }catch(error){message('login-message',error.message||'Unable to sign in. Please retry.');}
  finally{$('login-button').disabled=false;}
 });
 $('logout').addEventListener('click',async()=>{if(dirty&&!confirm('Sign out and discard unsaved changes?'))return;try{await api('staff_logout');}catch{}session='';draft=empty();records=[];dirty=false;$('workspace').hidden=true;$('login-panel').hidden=false;$('logout').hidden=true;$('call-form').reset();$('saved-records').replaceChildren();message('login-message','Signed out.');});
 for(const button of document.querySelectorAll('[data-tab]')){
  button.addEventListener('click',()=>tab(button.dataset.tab));
  button.addEventListener('keydown',event=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();const buttons=[...document.querySelectorAll('[data-tab]')];let i=buttons.indexOf(button);i=event.key==='Home'?0:event.key==='End'?buttons.length-1:(i+(event.key==='ArrowRight'?1:-1)+buttons.length)%buttons.length;tab(buttons[i].dataset.tab);buttons[i].focus();});
 }
 $('call-form').addEventListener('submit',e=>e.preventDefault());
 $('call-form').addEventListener('input',markDirty);$('call-form').addEventListener('change',markDirty);
 $('staff-stops').addEventListener('click',event=>{
  const b=event.target.closest('button');if(!b)return;read();
  for(const [key,delta]of [['up',-1],['down',1]])if(b.dataset[key]!==undefined){const i=Number(b.dataset[key]),j=i+delta;if(j>=0&&j<draft.stops.length)[draft.stops[i],draft.stops[j]]=[draft.stops[j],draft.stops[i]];}
  if(b.dataset.remove!==undefined&&draft.stops.length>2)draft.stops.splice(Number(b.dataset.remove),1);
  draft.distance=null;editVersion++;dirty=true;renderStops();refreshQuote();message('save-state','Unsaved changes');
 });
 $('add-stop').addEventListener('click',()=>{read();if(draft.stops.length>=10){message('save-state','A maximum of 10 stops is supported.');return;}draft.stops.splice(draft.stops.length-1,0,stop());draft.distance=null;editVersion++;dirty=true;renderStops();refreshQuote();message('save-state','Unsaved changes');});
 $('new-call').addEventListener('click',()=>{if(dirty&&!confirm('Start a new call and discard unsaved changes?'))return;draft=empty();dirty=false;++routeGeneration;renderEditor();message('save-state','New call');message('reservation-message','');tab('customer');});
 $('save-draft').addEventListener('click',()=>save(false));$('reserve').addEventListener('click',()=>save(true));$('calculate-quote').addEventListener('click',calculate);
 $('refresh-records').addEventListener('click',loadRecords);$('record-search').addEventListener('input',renderRecords);$('refresh-availability').addEventListener('click',()=>{read();availability();});
 $('cancel-reservation').addEventListener('click',async()=>{if(busy||!confirm('Cancel this reservation and release its held window?'))return;try{busy=true;const data=await api('staff_cancel',{id:draft.id,revision:draft.revision});draft=data.record;dirty=false;renderEditor();await loadRecords();message('reservation-message','Reservation cancelled. Its window is released.');}catch(e){message('reservation-message',e.message);}finally{busy=false;}});
 $('copy-summary').addEventListener('click',async()=>{read();refreshQuote();if(!draft.quote){message('copy-message','Calculate the quote first.');return;}const q=draft.quote;const text=['VYV estimated moving quote',draft.name,draft.date+' '+draft.time,'3 movers · '+money(q.rate)+'/hr',draft.stops.map(s=>s.address).join(' → '),'Estimated moving time: '+q.hours.join('–')+' hours','Moving labor: '+range(q.labor),'Truck fee: '+money(q.truckFee),draft.packing?'Packing labor: '+range(q.packing):'Packing not selected','Estimated total: '+range(q.total),'Deposit credited to total: '+money(q.deposit),'Estimated remaining balance: '+range(q.balance),'Final charge is based on actual work time and agreed services.',draft.paymentLink?'Stripe payment link: '+draft.paymentLink:''].filter(Boolean).join('\n');try{await navigator.clipboard.writeText(text);message('copy-message','Quote copied. Nothing was sent.');}catch{message('copy-message','Clipboard unavailable. You can select the quote text on this page.');}});
 const specials={antiques:'Antiques',gun_safe:'Gun safe',piano:'Piano',pool_table:'Pool table',hot_tub:'Hot tub',large_tv:'Large TV',artwork:'Artwork / mirrors'};
 $('specialty-options').innerHTML=Object.entries(specials).map(([value,label])=>'<label class="check"><input type="checkbox" data-specialty value="'+value+'">'+label+'</label>').join('');
 window.addEventListener('beforeunload',event=>{if(dirty){event.preventDefault();event.returnValue='';}});
 tab('customer');
})();
