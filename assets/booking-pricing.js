/* Shared by public booking, staff quoting and the Apps Script staff backend. */
(function(root){
 const rates={2:{0:180,1:165,2:165,3:170,4:170,5:180,6:180},3:{0:220,1:201,2:199,3:199,4:199,5:210,6:220}};
 function rateForDate(date,crew=3){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date||'')) throw Error('Choose a move date.');
  const d=new Date(date+'T12:00:00Z');
  if(!Number.isFinite(d.getTime())||d.toISOString().slice(0,10)!==date) throw Error('Choose a valid date.');
  return rates[crew]?.[d.getUTCDay()] || 0;
 }
 root.VYVPricing={rates,rateForDate,truckFeeFromMiles:miles=>miles<=50?99:125,depositFromBaseMiles:miles=>miles>50?300:250};
})(typeof window!=='undefined'?window:globalThis);
