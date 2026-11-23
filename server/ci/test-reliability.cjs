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
