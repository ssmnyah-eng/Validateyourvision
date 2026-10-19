(function(root){
 function routeKey(draft){return JSON.stringify((draft.stops||[]).map(s=>(s.address||'').trim()));}
 function quote(draft){
  if(!draft.date) throw Error('Choose a move date to calculate the hourly rate.');
  if((draft.stops||[]).length<2||draft.stops.some(s=>!String(s.address||'').trim())) throw Error('Enter an address for pickup, destination and each stop.');
  if(draft.distance?.routeKey!==routeKey(draft)||![draft.distance.moveMiles,draft.distance.baseMiles].every(n=>Number.isFinite(n)&&n>=0)) throw Error('Update the route to calculate the truck fee and deposit.');
  if(draft.packing&&(!draft.packingDate||!['AM','PM'].includes(draft.packingTime))) throw Error('Choose a packing date and arrival window.');
  const p=root.VYVPricing;
  return root.VYVQuote.estimate({stops:draft.stops,crew:3,volume:draft.volume||'everything',specialty:draft.specialty||[],miles:draft.distance.moveMiles,rate:p.rateForDate(draft.date,3),truckFee:p.truckFeeFromMiles(draft.distance.moveMiles),deposit:p.depositFromBaseMiles(draft.distance.baseMiles),packing:!!draft.packing,packingRate:draft.packing?p.rateForDate(draft.packingDate,3):0,density:draft.density||'normal',boxes:draft.boxes||0,ready:draft.ready||'ready',longCarry:!!draft.longCarry});
 }
 function validateReservation(draft,today){
  if(!String(draft.name||'').trim()) throw Error('Add the customer name before reserving.');
  if(!String(draft.phone||'').trim()&&!String(draft.email||'').trim()) throw Error('Add a phone number or email before reserving.');
  if(draft.email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(draft.email)) throw Error('Check the customer email.');
  if(draft.phone&&String(draft.phone).replace(/\D/g,'').length<10) throw Error('Check the customer phone number.');
  if(!['AM','PM'].includes(draft.time)) throw Error('Choose an AM or PM move window.');
  if(draft.date<today) throw Error('Choose today or a future move date.');
  return quote(draft);
 }
 function isStripeLink(value){try{const u=new URL(value);return u.protocol==='https:'&&['buy.stripe.com','checkout.stripe.com','invoice.stripe.com'].includes(u.hostname)&&!u.username&&!u.password;}catch{return false;}}
 root.VYVStaffModel={routeKey,quote,validateReservation,isStripeLink};
})(typeof window!=='undefined'?window:globalThis);
