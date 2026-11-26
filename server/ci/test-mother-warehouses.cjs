const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const path=process.argv[2]||require('node:path').join(__dirname,'../pb_hooks/lib/mother-warehouses.js');let puts=[],locked=false;
const A='3d520ee3-76c1-11f0-0a80-142900354c8e',B='36029ea4-e4b8-11f1-0a80-0c290009e4f4',id='12345678-1234-1234-1234-123456789abc';
const ref=(type,id)=>({meta:{href:'https://api.moysklad.ru/api/remap/1.2/entity/'+type+'/'+id,type}});
const original=()=>({id,name:'v100',store:ref('store',A),organization:ref('organization','281efedb-76c1-11f0-0a80-0fdb00366fa7'),deliveryPlannedMoment:'2026-11-29 08:00:00.000',state:{name:'Принят, Оплачен'},sum:500000,payedSum:500000,attributes:[{name:'Способ доставки',value:{name:'Доставка'}},{name:'Время доставки',value:'08:00–13:00'}],agent:{name:'Example'},shipmentAddress:'Example address'});
let row=original(),rows=[{ms_id:id,number:100,status:'confirmed'}];
const settings={get:k=>k==='ms_org_id'?'org':''};
const shop={settings:()=>settings,claim:()=>{if(locked)return false;locked=true;return true;},unclaim:()=>locked=false};
const ms={ms:(s,method,path,body)=>{if(method==='PUT'){puts.push(body);row.store=body.store;row.organization=body.organization;}return {ok:true,data:JSON.parse(JSON.stringify(row))};}};
const app={db:()=>({newQuery:()=>({all:out=>out.push(...rows)})})};
const box={module:{exports:{}},__hooks:'hooks',require:p=>p.endsWith('/shop.js')?shop:ms,arrayOf:()=>[],DynamicModel:function(){}};
vm.runInNewContext(fs.readFileSync(path,'utf8'),box);const lib=box.module.exports;
let result=lib.move(app,{order:id,from:A,to:B});assert.equal(result.order.store,B);assert.equal(puts.length,1);assert.deepEqual(Object.keys(puts[0]),['store','organization']);assert.equal(result.order.organization,'047ab4e2-e4b8-11f1-0a80-1f37000a92f0');assert.equal(locked,false);
assert.throws(()=>lib.move(app,{order:id,from:A,to:B}),e=>e.status===409);assert.equal(puts.length,1);
row=original();row.attributes[0].value.name='Самовывоз';assert.throws(()=>lib.move(app,{order:id,from:A,to:B}),e=>e.status===400);assert.equal(puts.length,1);
row=original();row.deliveryPlannedMoment='2026-11-28 12:00:00';assert.throws(()=>lib.move(app,{order:id,from:A,to:B}),e=>e.status===400);
row=original();row.demands=[{}];assert.throws(()=>lib.move(app,{order:id,from:A,to:B}),e=>e.status===400);
row=original();row.store=ref('store','belgorod');assert.throws(()=>lib.move(app,{order:id,from:A,to:B}),e=>e.status===400);
row=original();rows[0].status='cancelled';assert.throws(()=>lib.move(app,{order:id,from:A,to:B}),e=>e.status===400);
rows[0].status='confirmed';locked=true;assert.throws(()=>lib.move(app,{order:id,from:A,to:B}),e=>e.status===409);locked=false;
assert.throws(()=>lib.move(app,{order:id,from:A,to:'arbitrary'}),e=>e.status===400);
assert.equal(puts.length,1);
let routes={},auth=[];const hook={__hooks:'hooks',$app:app,$apis:{requireAuth:s=>{auth.push(s);return ()=>{};}},routerAdd:(m,p,f)=>routes[m]=f,require:p=>p.endsWith('/shop.js')?{can:()=>false}:lib};vm.runInNewContext(fs.readFileSync(process.argv[3]||require('node:path').join(__dirname,'../pb_hooks/mother-warehouses.pb.js'),'utf8'),hook);let response;routes.POST({json:(status,body)=>response={status,body}});assert.equal(response.status,403);assert.equal(auth.length,2);assert.equal(puts.length,1);
console.log('PASS: existing-document atomic warehouse + organization PUT, confirmed move, stale drag and simultaneous manager conflicts, pickup/date/cancel/foreign-store/shipped exclusions, allowlisted destinations, authenticated role checks');


row=original();row.store=ref('store',B);rows[0].status='confirmed';let fixed=lib.move(app,{order:id,from:B,to:B});assert.equal(fixed.order.organization,'047ab4e2-e4b8-11f1-0a80-1f37000a92f0');assert.equal(puts.length,2);lib.move(app,{order:id,from:B,to:B});assert.equal(puts.length,2);console.log('PASS: legacy transferred order organization repaired in place; same-target retry is idempotent');
