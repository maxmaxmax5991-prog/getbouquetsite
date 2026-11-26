const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const target=process.argv[2]||path.join(__dirname,'../pb_hooks/lib/occasion.js');
const ctx={module:{exports:{}}};vm.runInNewContext(fs.readFileSync(target,'utf8'),ctx);
const {aggregate,DAY}=ctx.module.exports;
const products=[{id:'rose',name:'Example rose',mothers_day:true,prices_51:{50:5100}},{id:'free',name:'Untracked',no_stock:true}];
const movements=[{product_id:'rose',length:50,quantity:204,cost_kop:408000}];
const order=(id,extra={})=>({id,date:DAY,status:'new',delivery_type:'delivery',payment_status:'paid',items:[{id:'rose',label:'50-51',qty:1}],...extra});
const orders=[order('paid'),order('pickup',{delivery_type:'pickup',payment_status:'unpaid'}),order('unpaid',{payment_status:'unpaid'}),order('cancelled',{status:'cancelled'}),order('other',{date:'2026-11-28'}),order('basket',{items:[{kind:'basket',qty:2,parts:[{id:'rose',len:50,n:10}]}]}),order('untracked',{items:[{id:'free',label:'60-101',qty:1}]})];
const r=aggregate(orders,movements,products);
assert.equal(r.total.reserved,204);assert.equal(r.total.booked,122);assert.equal(r.total.free,82);assert.equal(r.total.percent,59.8);assert.equal(r.total.shortage,0);assert.equal(r.total.purchase_cost,4080);assert.equal(r.total.retail_value,20400);assert.equal(r.total.bouquets_51,4);assert.equal(r.counted_orders,4);
const topped=aggregate(orders,[...movements,{product_id:'rose',length:50,quantity:51,cost_kop:null}],products);assert.equal(topped.total.booked,122);assert.equal(topped.total.free,133);assert.equal(topped.total.purchase_cost_missing,1);
const short=aggregate([order('large',{items:[{id:'rose',label:'50-301',qty:1}]})],movements,products);assert.equal(short.total.free,-97);assert.equal(short.total.shortage,97);
console.log('PASS: paid deliveries + all pickups; baskets; exclusions; reserve topups; shortage; valuation and cost completeness');
const dept=aggregate(orders,movements,products,[{document:'department-order',product_id:'rose',length:50,quantity:90},{document:'department-order',product_id:'free',length:60,quantity:20}]);
assert.equal(dept.total.booked,212);assert.equal(dept.total.site_booked,122);assert.equal(dept.total.sales_booked,90);assert.equal(dept.total.free,-8);assert.equal(dept.total.shortage,8);
console.log('PASS: site + department share reserve, channel breakdown and joint shortage');


{
const {reconcileSite,aggregate}=ctx.module.exports;
const order=(id,extra={})=>({id,number:id,ms_id:'ms'+id,date:'2026-11-29',interval:'10:00',status:'confirmed',delivery_type:'pickup',payment_status:'unpaid',total:100,items:[{id:'rose',label:'50-51',qty:2}],...extra});
const projection=(o,extra={})=>({site_id:o.id,ms_id:o.ms_id,date:o.date,cancelled:false,pickup:true,paid:false,interval:o.interval,local_date:o.date,local_interval:o.interval,local_delivery_type:o.delivery_type,...extra});
const a=order('a'),b=order('b'),d=order('d'),e=order('e'),f=order('f',{status:'cancelled'}),g=order('g',{date:'2026-11-28'}),h=order('h',{delivery_type:'delivery'}),i=order('i',{delivery_type:'delivery'}),j=order('j');
const projections=[projection(a,{cancelled:true}),projection(b,{date:'2026-11-28'}),projection(d,{ms_id:'unrelated',cancelled:true}),projection(e,{local_date:'2026-11-28',date:'2026-11-28'}),projection(f),projection(g,{date:'2026-11-29'}),projection(h,{pickup:false,paid:true}),projection(i,{pickup:false}),projection(j,{pickup:false})];
const out=reconcileSite([a,b,d,e,f,g,h,i,j],{site_orders:projections});
assert.deepEqual(Array.from(out.orders,x=>x.id),['d','e','g','h']);
assert.equal(out.orders.find(x=>x.id==='h').payment_status,'paid');
assert.equal(a.status,'confirmed','report projection must not mutate original');
const r=aggregate(out.orders,[{product_id:'rose',length:50,quantity:1000}],[{id:'rose',name:'rose'}]);assert.equal(r.counted_orders,4);assert.equal(r.total.booked,408);assert.equal(r.total.free,592);
assert.equal(reconcileSite([a],{}).orders.length,1,'old snapshot retains site data');
assert.equal(out.issues.length,4);
console.log('PASS: cancellations in either system, moved dates both directions, linked-document validation, fresh local edits, paid deliveries, unpaid pickup, shared stem booking, immutable source records');

}
