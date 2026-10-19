const {test}=require('node:test');const assert=require('node:assert/strict');const vm=require('node:vm');const fs=require('node:fs');const path=require('node:path');
function ui(){
 const html=fs.readFileSync(path.join(__dirname,'../vyv-dashboard/index.html'),'utf8');
 class El{constructor(){this.value='';this.checked=false;this.hidden=false;this.dataset={};this.listeners={};this.children=[];this.type='text';}addEventListener(k,fn){this.listeners[k]=fn;}setAttribute(k,v){this[k]=v;}append(...els){this.children.push(...els);}replaceChildren(){this.children=[];this.textContent='';}focus(){}reset(){}set innerHTML(value){this.markup=value;this.children=[];}get innerHTML(){return this.markup||'';}}
 const nodes=new Map();for(const tag of html.matchAll(/<[^>]+\bid="([^"]+)"[^>]*>/g)){const el=new El();el.hidden=/\bhidden\b/.test(tag[0]);el.type=tag[0].match(/type="([^"]+)"/)?.[1]||'text';nodes.set(tag[1],el);}
 const tabs=['customer','date','move','packing','quote'].map(name=>{const el=nodes.get('tab-'+name);el.dataset.tab=name;return el;});
 const document={getElementById:id=>nodes.get(id),querySelectorAll:selector=>selector==='[data-tab]'?tabs:[],createElement:()=>new El()};
 const requests=[];const c=vm.createContext({document,console,crypto:{randomUUID:()=> '11111111-1111-4111-8111-111111111111'},Intl,URL,confirm:()=>true,navigator:{clipboard:{writeText:async()=>{}}},fetch:async(url,options)=>{if(!options)return{json:async()=>({ok:true,dashboardEnabled:true,dashboardConfigured:true})};const body=JSON.parse(options.body);requests.push(body);return{json:async()=>body.action==='staff_login'?{ok:true,session:'test-session'}:{ok:true,records:[]}}}});c.window=c;c.addEventListener=()=>{};c.VYVAddresses={attach(){}};
 for(const file of ['booking-pricing.js','quote-estimator.js','staff-dashboard-model.js','staff-dashboard.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../assets',file),'utf8'),c);
 return {nodes,tabs,requests,context:c};
}
test('staff can open every tab without completing customer information or prior tabs',async()=>{
 const p=ui();assert.equal(p.nodes.get('workspace').hidden,true);
 p.nodes.get('password').value='mock-login-only';await p.nodes.get('login-form').listeners.submit({preventDefault(){}});
 assert.equal(p.nodes.get('workspace').hidden,false);assert.equal(p.nodes.get('customer-name').value,'');
 for(const name of ['packing','move','quote','date','customer']){
  p.nodes.get('tab-'+name).listeners.click();
  for(const other of ['customer','date','move','packing','quote'])assert.equal(p.nodes.get('panel-'+other).hidden,other!==name);
 }
 assert.deepEqual(p.requests.map(r=>r.action),['staff_login','staff_list']);
});
test('staff tabs have accessible keyboard navigation without triggering a save or payment',async()=>{
 const p=ui();p.nodes.get('tab-customer').listeners.keydown({key:'End',preventDefault(){}});
 assert.equal(p.nodes.get('panel-quote').hidden,false);assert.equal(p.requests.length,0);
});
test('typing during a slow draft save preserves the newer call information',async()=>{
 const p=ui();p.nodes.get('password').value='mock-login-only';await p.nodes.get('login-form').listeners.submit({preventDefault(){}});
 p.nodes.get('customer-name').value='First entry';p.nodes.get('call-form').listeners.input();
 let finish;
 p.context.fetch=async(url,options)=>{const body=JSON.parse(options.body);if(body.action==='staff_save')return new Promise(resolve=>finish=()=>resolve({json:async()=>({ok:true,record:{...body.draft,revision:1,status:'Draft'}})}));return{json:async()=>({ok:true,records:[]})};};
 const saving=p.nodes.get('save-draft').listeners.click();
 p.nodes.get('customer-name').value='Newer entry';p.nodes.get('call-form').listeners.input();finish();await saving;
 assert.equal(p.nodes.get('customer-name').value,'Newer entry');assert.match(p.nodes.get('save-state').textContent,/still unsaved/);
});
