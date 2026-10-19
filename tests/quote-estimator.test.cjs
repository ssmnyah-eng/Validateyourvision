const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');const fs=require('node:fs');const path=require('node:path');
const c=vm.createContext({});vm.runInContext(fs.readFileSync(path.join(__dirname,'../assets/quote-estimator.js'),'utf8'),c);
const base={stops:[{propType:'Apartment',beds:1,sqft:'0-1000',floorLevel:1},{propType:'Apartment',floorLevel:1}],crew:2,volume:'everything',miles:10,rate:199,truckFee:99,deposit:250,density:'normal',ready:'ready'};
const estimate=patch=>c.VYVQuote.estimate({...base,...patch});
test('quote totals show labor plus truck, with deposit credited rather than added',()=>{
 const q=estimate({});
 assert.ok(q.hours[0]>=3);assert.ok(q.hours[1]>4);
 for(let i=0;i<2;i++) {assert.equal(q.total[i],q.labor[i]+99);assert.equal(q.balance[i],q.total[i]-250);}
});
test('dense one-bedroom, stairs at destination and extra stops expand the range',()=>{
 const standard=estimate({});const full=estimate({density:'heavy',boxes:75});
 assert.ok(full.hours[0]>standard.hours[0]);assert.ok(full.hours[1]>6);
 const stairs=estimate({stops:[base.stops[0],{propType:'Apartment',floorLevel:4,elevator:'no'}]});assert.ok(stairs.hours[1]>standard.hours[1]);
 const stop=estimate({stops:[base.stops[0],{propType:'Storage'},base.stops[1]]});assert.ok(stop.total[1]>standard.total[1]);
});
test('packing adds separately priced labor and uses the selected packing-day rate',()=>{
 const q=estimate({packing:true,packingRate:220});
 for(let i=0;i<2;i++) {assert.equal(q.packing[i],q.packingHours[i]*220);assert.equal(q.total[i],q.labor[i]+q.packing[i]+99);}
 assert.throws(()=>estimate({packing:true}),/packing date/);
});
test('crew, travel, volume and long carries affect estimates without changing the rate',()=>{
 const q=estimate({});assert.ok(estimate({crew:3}).hours[1]<q.hours[1]);
 assert.ok(estimate({miles:100}).total[1]>q.total[1]);
 assert.ok(estimate({volume:'few'}).total[1]<q.total[1]);
 assert.ok(estimate({longCarry:true}).total[1]>q.total[1]);
 assert.equal(estimate({density:'heavy'}).rate,199);
});
test('missing size and large complex moves request crew review; invalid pricing cannot quote',()=>{
 assert.equal(estimate({stops:[{},{}]}).needsReview,true);
 assert.equal(estimate({stops:[{beds:'5+'},{}]}).needsReview,true);
 assert.throws(()=>estimate({rate:undefined}),/pricing/);
});
test('three-mover one-bedroom quote includes the full local job at about five to six hours',()=>{
 const q=estimate({crew:3,miles:10});
 assert.equal(q.hours[0],5);assert.equal(q.hours[1],6);
 for(let i=0;i<2;i++) assert.equal(Object.values(q.stages).reduce((sum,v)=>sum+v[i],0),q.hours[i]);
 assert.ok(q.stages.loading[0]>0);assert.ok(q.stages.unloading[0]>0);assert.ok(q.stages.protection[0]>0);assert.ok(q.stages.driving[0]>0);
});
test('unfinished preparation increases moving hours without charging selected packing twice',()=>{
 const ready=estimate({crew:3});const unready=estimate({crew:3,ready:'not-ready'});
 assert.ok(unready.hours[0]>=ready.hours[0]+1);assert.ok(unready.hours[1]>=ready.hours[1]+2.5);
 const packed=estimate({crew:3,ready:'not-ready',packing:true,packingRate:199});
 assert.deepEqual(Array.from(packed.hours),Array.from(ready.hours));
 assert.ok(packed.packing[0]>0);
});
