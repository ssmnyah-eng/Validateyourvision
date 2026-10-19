const {test}=require('node:test');const assert=require('node:assert/strict');
const {VYVFixedQuoteCost:{priceReviewedPlan:price}}=require('../fixed-quote-cost-core');
// Fictional fixture values test arithmetic only; these are NOT VYV pay or pricing.
const plan={inventoryVerified:true,accessVerified:true,capacityVerified:true,performanceReviewed:true,scopeVersion:'fixture-1',stageHours:{protection:0.5,loading:2,driving:0.5,unloading:1.5,assembly:0.5,packing:0,accessDelays:0,otherIncludedWork:0},paidDepotTravelHours:1,paidSetupHours:0,fuelCostCents:3000,materialsCents:1000,tollsPermitsCents:0,specialistsCents:0,riskHours:1,depositCents:25000};
const config={costsApproved:true,loadedWagesCentsPerHour:[2500,2500,2500],truckCostCents:10000,allocatedOverheadCents:5000,incidentReserveCents:2000,variableOperatingCentsPerHour:0,processorPercent:0.03,processorFixedCents:30,targetOperatingMargin:0.3,applicableTaxRate:0};
test('missing wages or unverified inventory cannot generate a fixed price',()=>{
 for(const [p,c] of [[{...plan,inventoryVerified:false},config],[plan,{...config,loadedWagesCentsPerHour:undefined}],[plan,{...config,truckCostCents:undefined}],[{...plan,capacityVerified:false},config]]){
  const q=price(p,c);assert.equal(q.status,'review_required');assert.equal(q.priceCents,null);
 }
});
test('all three movers are paid for work plus depot travel and deposit is credited',()=>{
 const q=price(plan,config);assert.equal(q.customerJobHours,5);assert.equal(q.payrollHours,6);
 assert.equal(q.operatingCostCents,64000);assert.equal(q.contingencyCostCents,9500);
 assert.equal(q.priceCents,Math.ceil((64000+9500+30)/0.67));assert.equal(q.balanceCents,q.priceCents-25000);
 assert.equal(q.publishable,false);
});
test('a slower elevator increases cost while an unconfigured model stays blocked',()=>{
 const q=price(plan,config);const slower=price({...plan,stageHours:{...plan.stageHours,accessDelays:1}},config);
 assert.ok(slower.priceCents>q.priceCents);
 assert.equal(price({...plan,performanceReviewed:false},config).priceCents,null);
});
test('unreasonable margins and deposits are rejected rather than producing a price',()=>{
 assert.equal(price(plan,{...config,targetOperatingMargin:0.99}).priceCents,null);
 assert.equal(price({...plan,depositCents:99999999},config).priceCents,null);
});
test('missing configuration returns review and collected tax is included in fee math',()=>{
 assert.equal(price().priceCents,null);
 const q=price(plan,{...config,applicableTaxRate:0.05});
 const fee=(q.priceCents*config.processorPercent)+config.processorFixedCents;
 const contribution=q.preTaxCents-q.operatingCostCents-q.contingencyCostCents-fee;
 assert.ok(contribution/q.preTaxCents>=config.targetOperatingMargin-0.00001);
});
