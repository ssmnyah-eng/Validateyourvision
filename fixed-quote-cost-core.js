/* Draft internal cost guard. Not connected to customer checkout.
 * Stage hours must come from a reviewed inventory/work plan, not bedroom count.
 * All monetary inputs are cents. No wages, margins or productivity defaults.
 */
(function(root){
 'use strict';
 function priceReviewedPlan(plan = {}, config = {}) {
  const issues=[];
  const number=(value,name,min=0)=>{if(!Number.isFinite(value)||value<min) {issues.push(name);return 0;}return value;};
  if(!plan.inventoryVerified) issues.push('verified inventory');
  if(!plan.accessVerified) issues.push('confirmed access at every stop');
  if(!plan.capacityVerified) issues.push('truck volume and payload review');
  if(!plan.performanceReviewed) issues.push('reviewed task-time model');
  if(!plan.scopeVersion) issues.push('versioned service scope');
  if(!config.costsApproved) issues.push('owner-approved cost settings');
  if(!Array.isArray(config.loadedWagesCentsPerHour)||config.loadedWagesCentsPerHour.length!==3) issues.push('three loaded hourly wage rates');
  const wages=(config.loadedWagesCentsPerHour||[]).map((v,i)=>number(v,'wage '+(i+1),1));
  const stageNames=['protection','loading','driving','unloading','assembly','packing','accessDelays','otherIncludedWork'];
  const stages=Object.fromEntries(stageNames.map(k=>[k,number(plan.stageHours?.[k],k+' hours')]));
  const customerJobHours=Object.values(stages).reduce((a,b)=>a+b,0);
  if(customerJobHours<=0) issues.push('positive job duration');
  const paidTravel=number(plan.paidDepotTravelHours,'paid depot travel hours');
  const paidSetup=number(plan.paidSetupHours,'paid setup hours');
  const payrollHours=customerJobHours+paidTravel+paidSetup;
  const truck=number(config.truckCostCents,'truck cost');
  const fuel=number(plan.fuelCostCents,'fuel cost');
  const other=['materialsCents','tollsPermitsCents','specialistsCents'].reduce((sum,k)=>sum+number(plan[k],k),0);
  const overhead=number(config.allocatedOverheadCents,'allocated overhead');
  const riskHours=number(plan.riskHours,'documented time contingency');
  const incidentReserve=number(config.incidentReserveCents,'incident reserve');
  const hourlyOps=number(config.variableOperatingCentsPerHour,'hourly operating cost');
  const processorPercent=number(config.processorPercent,'processing fraction');
  const processorFixed=number(config.processorFixedCents,'fixed processing fee');
  const margin=number(config.targetOperatingMargin,'target operating margin');
  const taxRate=number(config.applicableTaxRate,'applicable tax rate');
  if(margin+processorPercent*(1+taxRate)>=1) issues.push('valid margin/processing configuration');
  if(margin>=1||processorPercent>=1||taxRate>1) issues.push('fraction units between zero and one');
  const deposit=number(plan.depositCents,'deposit');
  if(issues.length) return {status:'review_required',priceCents:null,issues:[...new Set(issues)]};
  const loadedCrewWage=wages.reduce((a,b)=>a+b,0);
  const payroll=payrollHours*loadedCrewWage;
  const operatingCost=payroll+truck+fuel+other+overhead+payrollHours*hourlyOps;
  const contingencyCost=riskHours*(loadedCrewWage+hourlyOps)+incidentReserve;
  // Fee percent applies to the full collected price, including configured tax.
  const preTax=Math.ceil((operatingCost+contingencyCost+processorFixed)/(1-margin-processorPercent*(1+taxRate)));
  const tax=Math.round(preTax*taxRate);
  const price=preTax+tax;
  if(deposit>price) return {status:'review_required',priceCents:null,issues:['deposit exceeds candidate total']};
  return {status:'internal_candidate',publishable:false,scopeVersion:plan.scopeVersion,customerJobHours,payrollHours,stages,operatingCostCents:Math.ceil(operatingCost),contingencyCostCents:Math.ceil(contingencyCost),preTaxCents:preTax,taxCents:tax,priceCents:price,depositCents:deposit,balanceCents:price-deposit};
 }
 root.VYVFixedQuoteCost={priceReviewedPlan};
})(typeof module!=='undefined' ? module.exports : globalThis);
