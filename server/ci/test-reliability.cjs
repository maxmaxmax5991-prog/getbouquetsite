const fs=require('fs'),vm=require('vm'),assert=require('assert'),path=require('path');
const base=path.resolve(__dirname,'../pb_hooks');
function load(name,mocks,extra={}){const box={module:{exports:{}},exports:{},__hooks:'/hooks',console,require:p=>mocks[p.split('/').pop()],...extra};vm.runInNewContext(fs.readFileSync(path.join(base,name),'utf8'),box);return box.module.exports;}
let sent=[];
const shop={settings:()=>({}),brandOfOrder:()=>null,invoiceOf:o=>o.get('invoice')};
const pay=load('lib/pay.js',{'shop.js':shop},{$http:{send:o=>{sent.push(o);return{statusCode:200,json:{Success:true,Model:{Id:'receipt-1'}}}}}});
const s={get:k=>({cp_public_id:'merchant',cp_secret:'secret'}[k]||'')};
pay.cp(s,'/kkt/receipt',{},null,'stable-key');assert.equal(sent[0].headers['X-Request-ID'],'stable-key');
let model={TransactionId:123,Status:'Completed',Amount:700,Currency:'RUB',InvoiceId:'v1d1',CreatedDateIso:'2026-11-23T10:01:00Z'};
const extra={get:k=>({invoice:'v1d1',sum:700,created:'2026-11-23 10:00:00Z'}[k])};
const p2=load('lib/pay.js',{'shop.js':{...shop,settings:()=>s}},{$http:{send:()=>({statusCode:200,json:{Success:true,Model:model}})}});
assert(p2.verifyExtra({}, {},extra));for(const patch of [{Amount:699},{Status:'Declined'},{TestMode:true},{InvoiceId:'v2d1'},{Currency:'USD'},{TransactionId:0},{CreatedDateIso:'2026-11-22T00:00:00Z'}]){let original=model;model={...model,...patch};assert(!p2.verifyExtra({}, {},extra),JSON.stringify(patch));model=original;}
let claimed=new Set(),unknown=[],calls=0;
const app={db:()=>({newQuery:sql=>({bind:v=>({execute:()=>{if(sql.startsWith('INSERT INTO order_notified')){if(claimed.has(v.id))throw Error('duplicate');claimed.add(v.id)}if(sql.startsWith('INSERT INTO recovery_operations'))unknown.push(v);}})})})};
const receiptShop={jget:()=>[{name:'Test',qty:1,sum:5990}],invoiceOf:()=> 'v1'};
const rec={id:'order1',get:k=>({phone:'79991234567',total:5990,delivery_price:0}[k]||'')};
const receiptSettings={get:k=>({kkt_on:true,org_inn:'1234567890'}[k]||'')};
const receipts=load('lib/receipt.js',{'shop.js':receiptShop,'pay.js':{cp:()=>{calls++;return{ok:false,error:'timeout'}}}});
assert.equal(receipts.пробить(app,receiptSettings,rec,null).ok,false);assert(claimed.has('order1'));assert.equal(unknown.length,1);assert(receipts.пробить(app,receiptSettings,rec,null).повтор);assert.equal(calls,1);
let freshPaid={id:'order2',get:k=>({payment_status:'paid'}[k]||'')};let notified=0;
const stale={id:'order2',get:k=>({payment_method:'card',payment_status:'unpaid',total:5990,number:1,created:'2026-11-23 10:00:00Z'}[k]||'')};
const p3=load('lib/pay.js',{'shop.js':{...shop,settings:()=>s,claim:()=>true}},{$http:{send:()=>({statusCode:200,json:{Success:true,Model:{TransactionId:1,Amount:5990,Status:'Completed',CreatedDateIso:'2026-11-23T10:01:00Z'}}})}});
assert.equal(p3.checkOrder({findRecordById:()=>freshPaid},stale),false);
console.log('PASS: stable provider key, bank verification of extras (7 rejected invalid states), uncertain fiscal result held without retries, stale paid object does not repeat effects');
// Replay callback must not trust a forged supplementary-payment notification.
let routes={},bankVerified=false,extraSaved=0;
let order={id:'o',get:k=>({invoice:'v1'}[k]||'')},ex={id:'ex',get:k=>({invoice:'v1d1',sum:700,paid_at:''}[k]||''),set:()=>{}};
const fakeApp={db:()=>({newQuery:()=>({bind:()=>({execute:()=>{}})})}),findFirstRecordByFilter:(name)=>name==='orders'?order:ex,findRecordById:()=>ex,save:()=>extraSaved++};
const box={module:{exports:{}},__hooks:'/hooks',console,$app:fakeApp,$apis:{requireAuth:()=>()=>{}},cronAdd:()=>{},routerAdd:(method,url,fn)=>routes[url]=fn,require:p=>p.endsWith('/shop.js')?{claim:()=>true}:p.endsWith('/pay.js')?{verifyExtra:()=>bankVerified}:{}};
vm.runInNewContext(fs.readFileSync(path.join(base,'pay.pb.js'),'utf8'),box);
const callback=routes['/api/cloudpayments/callback'];let response;
callback({requestInfo:()=>({body:{InvoiceId:'v1d1'}}),json:(status,body)=>response={status,body}});assert.equal(response.status,503);assert.equal(extraSaved,0);
console.log('PASS: unverified supplementary callback cannot mark an extra paid');
const msSource=fs.readFileSync(path.join(base,'lib/ms.js'),'utf8');const fn=msSource.slice(msSource.indexOf('function syncId('),msSource.indexOf('\nconst meta'));
let crypto=require('crypto');let ctx={$security:{sha256:s=>crypto.createHash('sha256').update(s).digest('hex')}};vm.createContext(ctx);vm.runInContext(fn,ctx);
const one=ctx.syncId('customerorder','abc');assert.equal(one,ctx.syncId('customerorder','abc'));assert.notEqual(one,ctx.syncId('paymentin','abc'));assert.match(one,/^[a-f0-9]{8}-[a-f0-9]{4}-5[a-f0-9]{3}-8[a-f0-9]{3}-[a-f0-9]{12}$/);
console.log('PASS: provider syncId stable per operation and distinct across operation kinds');

// Pickup totals must match the bouquet price even when it is not divisible by stems.
{
 const record=o=>({get:k=>o[k],getString:k=>typeof o[k]==='string'?o[k]:JSON.stringify(o[k])});
 const fakeProduct=record({ms_pick:{50:{id:'rose',type:'product'}},ms_mix:null,variants:[],is_express:false});
 const ms=load('lib/ms.js',{'shop.js':{jget:(o,k)=>o.get(k)}});
 const app={findRecordById:()=>fakeProduct};
 for(const [n,qty,price]of [[51,1,3990],[51,2,2990],[101,1,5490],[7,1,3500],[25,2,3990]]){
  const result=ms.positionsFor(app,record({}),record({items:[{id:'rose',label:'50-'+n,price,qty}],delivery_price:0}));
  assert(result.ok);assert.equal(result.positions.reduce((a,p)=>a+p.quantity,0),n*qty);
  assert.equal(Math.round(result.positions.reduce((a,p)=>a+p.quantity*p.price,0)),price*qty*100);
 }
 console.log('PASS: exact pickup totals for 7/25/51/101 stems and multiple bouquets');
}

// Only Mother’s Day deliveries use Moscow 02; all other dates and pickups use Moscow 01.
{
 const ms=load("lib/ms.js",{"shop.js":{}});
 const record=data=>({get:k=>data[k]});
 for(const date of ["2026-11-26","2026-11-29","2027-01-01"]){
  for(const invoice of ["v9999","g9999"]){
   const d=ms.fulfillmentOf(record({delivery_type:"delivery",date,invoice}));
   assert.equal(d.store,date==="2026-11-29"?"36029ea4-e4b8-11f1-0a80-0c290009e4f4":"3d520ee3-76c1-11f0-0a80-142900354c8e");assert.equal(d.organization,date==="2026-11-29"?"047ab4e2-e4b8-11f1-0a80-1f37000a92f0":"281efedb-76c1-11f0-0a80-0fdb00366fa7");
   const p=ms.fulfillmentOf(record({delivery_type:"pickup",date,invoice}));
   assert.equal(p.store,"3d520ee3-76c1-11f0-0a80-142900354c8e");assert.equal(p.organization,"281efedb-76c1-11f0-0a80-0fdb00366fa7");
  }
 }
 console.log("PASS: only November 29 deliveries route to Moscow 02; other dates and every pickup remain on Moscow 01, both brands");
}

{
 const values={ms_enabled:true,ms_token:"fixture",ms_org_id:"281efedb-76c1-11f0-0a80-0fdb00366fa7",ms_store_id:"3d520ee3-76c1-11f0-0a80-142900354c8e",ms_state_paid:"paid",ms_state_unpaid:"unpaid",ms_channel:"Сайт",ms_channel_id:"site",ms_attrs_cache:{at:new Date().toISOString(),rows:[{id:"method",name:"Способ доставки",type:"customentity",customEntityMeta:{href:"https://api.moysklad.ru/api/remap/1.2/entity/customentity/method"}},{id:"payment",name:"Тип Оплаты",type:"customentity",customEntityMeta:{href:"https://api.moysklad.ru/api/remap/1.2/entity/customentity/payment"}}]},ms_dict_cache:{"method|доставка":"delivery","method|самовывоз":"pickup","payment|cloudpayments":"card"}};
 const record=data=>({id:data.id,get:k=>data[k]||"",getString:k=>typeof data[k]==="string"?data[k]:JSON.stringify(data[k]),set:(k,v)=>data[k]=v});
 const settings=record(values),product=record({ms_pick:{"40":{id:"rose",type:"product"}},category:"cat"}),bodies=[];
 const ms=load("lib/ms.js",{"shop.js":{settings:()=>settings,jget:(o,k)=>o.get(k),invoiceOf:o=>o.get("invoice"),rub:String,claim:()=>true,unclaim:()=>{}}},{$security:{sha256:s=>crypto.createHash("sha256").update(s).digest("hex")},$http:{send:req=>{if(req.method==="POST"){bodies.push(JSON.parse(req.body));return{statusCode:200,json:{id:"created-"+bodies.length}};}return{statusCode:200,json:{rows:[{id:"customer"}]}};}}});
 const app={findRecordById:(name)=>name==="products"?product:record({slug:"single"}),save:()=>{},db:()=>({newQuery:()=>({bind:()=>({execute:()=>{}})})})};
 for(const kind of ["delivery","pickup"]){const o=record({id:kind,invoice:"v-test",number:1,date:"2026-11-29",interval:"08:00–13:00",delivery_type:kind,payment_method:"card",payment_status:kind==="pickup"?"unpaid":"paid",phone:"79990000000",items:[{id:"rose",label:"40-25",qty:1,price:2490}],delivery_price:0});assert(ms.pushOrder(app,o).ok);}
 assert.equal(bodies.length,2);assert(bodies[0].store.meta.href.endsWith("/36029ea4-e4b8-11f1-0a80-0c290009e4f4"));assert(bodies[0].organization.meta.href.endsWith("/047ab4e2-e4b8-11f1-0a80-1f37000a92f0"));assert(bodies[1].store.meta.href.endsWith("/3d520ee3-76c1-11f0-0a80-142900354c8e"));assert(bodies[1].organization.meta.href.endsWith("/281efedb-76c1-11f0-0a80-0fdb00366fa7"));
 console.log("PASS: real pushOrder request body pairs delivery warehouse/organization 02 and pickup 01");
}
