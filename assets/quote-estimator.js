/* VYV planning model. Business assumptions and sources: QUOTE-MODEL.md. */
(function(root) {
  'use strict';
  const roundUp = n => Math.ceil(n * 4) / 4;
  const sizes = [[2.5,4],[5.5,6.45],[6.5,9],[7,11],[10,15],[12,18]];
  function estimate(input) {
    const stops = input.stops || [];
    const origin = stops[0] || {};
    const beds = Number.parseInt(origin.beds,10);
    const sqft = {'0-1000':1,'1000-1500':2,'1500-2000':3,'2000-3000':4,'3000+':5}[origin.sqft];
    let size = Number.isFinite(beds) ? Math.min(5,Math.max(0,beds)) : (sqft || 2);
    if (sqft) size = Math.max(size,sqft);
    const storage = {'5x5':0,'5x10':1,'5x15':2,'10x10':2,'10x15':3,'10x20':4,'10x25':5,'10x30':5};
    if (origin.propType === 'Storage') size = storage[origin.unitSize] ?? 2;
    const volume = {everything:1,most:0.9,half:0.7,few:0.45}[input.volume] || 1;
    const density = {light:0.85,normal:1,heavy:1.35}[input.density] || 1;
    const boxes = Math.max(0,Number(input.boxes) || 0);
    const boxFactor = boxes ? Math.max(1, boxes / ([20,40,65,100,140,180][size])) : 1;
    const inventory = boxes ? Math.max(density,Math.min(2.5,boxFactor)) : density;
    const crew = input.crew === 3 ? 0.85 : 1;
    let low = sizes[size][0] * volume * inventory * crew;
    let high = sizes[size][1] * volume * inventory * crew;
    const baseHandling = [low,high];
    const reasons = [];
    if (inventory > 1) reasons.push('Fuller inventory / box count');
    let accessLow = 0, accessHigh = 0;
    stops.forEach(s => {
      const floors = Math.max(0,(Number(s.floorLevel) || Number.parseInt(s.stories,10) || 1)-1);
      if (floors && s.elevator !== 'yes') { accessLow += floors*0.25; accessHigh += floors*0.6; }
      if (s.elevator === 'yes' && floors) { accessLow += 0.25; accessHigh += 0.75; }
    });
    if (accessHigh) {low += accessLow; high += accessHigh; reasons.push('Stairs / elevator access at all locations');}
    const garage = {'1 Car':0.5,'2 Car':1,'3+ Car':1.5}[origin.garage] || 0;
    low += garage*crew; high += garage*1.5*crew;
    if (garage) reasons.push('Garage contents');
    const extra = Math.max(0,stops.length-2); low += extra*0.5; high += extra;
    if (extra) reasons.push(extra + ' additional stop(s)');
    const special = {gun_safe:0.5,piano:0.75,pool_table:1,hot_tub:0.75,large_tv:0.25,antiques:0.5,artwork:0.25};
    const handling = (input.specialty || []).reduce((sum,key)=>sum+(special[key] || 0),0);
    low += handling; high += handling*1.5;
    if (handling) reasons.push('Special handling time (no separate item fee)');
    if (input.longCarry) {low += 0.5; high += 1.5; reasons.push('Long walk between truck and door');}
    const preparation = input.ready === 'not-ready' && !input.packing ? [1,2.5] : [0,0];
    low += preparation[0]; high += preparation[1];
    if (preparation[1]) reasons.push('Unfinished preparation allowance; packing service and materials still require confirmation');
    const miles = Math.max(0,Number(input.miles) || 0);
    const travelLow = Math.max(0.25,miles/35), travelHigh = Math.max(0.5,miles/20);
    low += travelLow; high += travelHigh;
    reasons.push('Loading, unloading, furniture protection and estimated driving time');
    low = roundUp(Math.max(2,low)); high = roundUp(Math.max(low+0.5,high));
    const quarter = n => Math.round(n*4)/4;
    const hours = [low,high];
    const driving = [roundUp(travelLow),roundUp(travelHigh)];
    const protection = baseHandling.map(h=>quarter(h*0.15));
    const loading = baseHandling.map((h,i)=>quarter(h*0.45 + Math.max(0,hours[i]-driving[i]-baseHandling[i]-preparation[i])/2));
    const unloading = hours.map((h,i)=>quarter(h-driving[i]-protection[i]-loading[i]-preparation[i]));
    const stages = {protection,loading,driving,unloading,preparation};
    const rate = Number(input.rate), truck = Number(input.truckFee), deposit = Number(input.deposit);
    if (![rate,truck,deposit].every(Number.isFinite) || rate <= 0 || truck < 0 || deposit < 0) throw Error('Complete date and distance pricing first.');
    const packingHours = input.packing ? [roundUp(Math.max(2,(size+1)*0.75*inventory*volume)),roundUp(Math.max(3,(size+1)*1.5*inventory*volume))] : [0,0];
    const packingRate = input.packing ? Number(input.packingRate) : 0;
    if (!Number.isFinite(packingRate) || packingRate < 0 || (input.packing && !packingRate)) throw Error('Choose the packing date first.');
    const labor = [Math.round(low*rate),Math.round(high*rate)];
    const packing = packingHours.map(h=>Math.round(h*packingRate));
    const total = [labor[0]+truck+packing[0],labor[1]+truck+packing[1]];
    return {version:2,stages,crew:input.crew,volume:input.volume,density:input.density,boxes,readiness:input.ready,longCarry:!!input.longCarry,hours:[low,high],rate,labor,truckFee:truck,packingHours,packingRate,packing,total,deposit,balance:total.map(v=>Math.max(0,v-deposit)),reasons,needsReview:high>12 || size>=5 || (input.ready==='not-ready' && !input.packing) || !origin.beds && !origin.sqft && origin.propType!=='Storage',miles};
  }
  root.VYVQuote = {estimate};
})(typeof window !== 'undefined' ? window : globalThis);
