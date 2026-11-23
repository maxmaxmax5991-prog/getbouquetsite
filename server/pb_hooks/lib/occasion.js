const DAY='2026-11-29';
function aggregate(orders,movements,products) {
 const names={},meta={};products.forEach(p=>{names[p.id]=p.name;meta[p.id]=p;});
 const rows={};
 const row=(id,length,name)=>{
  const key=id+'|'+(+length);
  if(!rows[key])rows[key]={id,name:names[id]||name||id,length:+length,reserved:0,booked:0,has_reserve:false,orders:[],purchase_cost_kop:0,purchase_cost_missing:0};
  return rows[key];
 };
 movements.forEach(m=>{const r=row(m.product_id,m.length);r.reserved+=+m.quantity;r.has_reserve=true;if(m.cost_kop===null||m.cost_kop===undefined)r.purchase_cost_missing++;else r.purchase_cost_kop+=+m.cost_kop;});
 let counted=0;
 orders.forEach(o=>{
  if(String(o.date).slice(0,10)!==DAY || o.status==='cancelled' || (o.delivery_type!=='pickup' && o.payment_status!=='paid'))return;
  counted++;
  let items=o.items||[];if(typeof items==='string'){try{items=JSON.parse(items);}catch(_){items=[];}}
  const add=(p,length,n,name)=>{if(!p||!(+length>0)||!(n>0))return;const r=row(p,length,name);r.booked+=n;if(r.orders.indexOf(o.id)<0)r.orders.push(o.id);};
  items.forEach(it=>{
   const quantity=it.qty===undefined?1:+it.qty;if(!(quantity>0))return;
   if(Array.isArray(it.parts)&&it.parts.length){it.parts.forEach(p=>add(p.id,p.len,(+p.n||+p.cnt||0)*quantity,p.name));return;}
   const label=String(it.label||'').match(/^(\d+)-(\d+)$/);
   if(label)add(it.id,label[1],+label[2]*quantity,it.name);
   else if(+it.stems>0 && (+it.len||+it.length)>0)add(it.id,+it.len||+it.length,+it.stems*quantity,it.name);
  });
 });
 const positions=Object.keys(rows).map(k=>{
  const r=rows[k];r.order_count=r.orders.length;delete r.orders;
  r.untracked=!!(meta[r.id] && meta[r.id].no_stock);
  r.free=r.has_reserve?r.reserved-r.booked:null;
  r.shortage=r.untracked&&!r.has_reserve?null:Math.max(0,r.booked-r.reserved);
  r.on_mother=!!(meta[r.id] && meta[r.id].mothers_day);
  r.has_photo=!!(meta[r.id] && meta[r.id].has_photo);
  r.price_51=meta[r.id] && (meta[r.id].prices_51||{})[r.length] || null;
  r.purchase_cost=r.has_reserve?r.purchase_cost_kop/100:null;
  r.retail_value=r.has_reserve&&r.price_51?r.reserved/51*r.price_51:null;
  r.free_retail_value=r.has_reserve&&r.price_51?Math.max(0,r.free)/51*r.price_51:null;
  r.bouquets_51=r.has_reserve?Math.floor(r.reserved/51):null;
  r.whole_bouquets_value=r.has_reserve&&r.price_51?r.bouquets_51*r.price_51:null;
  r.remainder_stems=r.has_reserve?r.reserved%51:null;
  r.percent=r.reserved>0?Math.round(r.booked/r.reserved*1000)/10:null;
  return r;
 }).sort((a,b)=>a.name.localeCompare(b.name,'ru')||a.length-b.length);
 const varieties={};positions.forEach(r=>{
  const v=varieties[r.id]||(varieties[r.id]={id:r.id,name:r.name,reserved:0,booked:0});
  if(r.has_reserve){v.reserved+=r.reserved;v.booked+=r.booked;}
 });
 const by_variety=Object.keys(varieties).map(k=>{const v=varieties[k];return {...v,free:v.reserved-v.booked,percent:v.reserved?Math.round(v.booked/v.reserved*1000)/10:null};}).filter(v=>v.reserved>0).sort((a,b)=>b.percent-a.percent||a.name.localeCompare(b.name,'ru'));
 const total=positions.filter(r=>r.has_reserve).reduce((a,r)=>({reserved:a.reserved+r.reserved,booked:a.booked+r.booked,free:a.free+r.free}),{reserved:0,booked:0,free:0});
 total.percent=total.reserved?Math.round(total.booked/total.reserved*10000)/100:0;
 total.purchase_cost_kop=positions.reduce((n,r)=>n+r.purchase_cost_kop,0);
 total.purchase_cost=total.purchase_cost_kop/100;
 total.purchase_cost_missing=positions.reduce((n,r)=>n+r.purchase_cost_missing,0);
 total.shortage=positions.reduce((n,r)=>n+(r.shortage||0),0);
 total.retail_value=positions.reduce((n,r)=>n+(r.retail_value||0),0);
 total.free_retail_value=positions.reduce((n,r)=>n+(r.free_retail_value||0),0);
 total.whole_bouquets_value=positions.reduce((n,r)=>n+(r.whole_bouquets_value||0),0);
 total.bouquets_51=positions.reduce((n,r)=>n+(r.bouquets_51||0),0);
 total.remainder_stems=positions.reduce((n,r)=>n+(r.remainder_stems||0),0);
 total.price_missing=positions.filter(r=>r.has_reserve&&!r.price_51).map(r=>({id:r.id,name:r.name,length:r.length}));
 return {day:DAY,counted_orders:counted,positions,by_variety,total};
}
function report(app) {
 const movements=arrayOf(new DynamicModel({id:'',day:'',product_id:'',length:0,quantity:0,source:'',source_name:'',source_row:0,created:'',actor:'',unit_cost_kop:-1,cost_kop:-1}));
 app.db().newQuery("SELECT id,day,product_id,length,quantity,source,source_name,source_row,created,actor,COALESCE(unit_cost_kop,-1) AS unit_cost_kop,COALESCE(cost_kop,-1) AS cost_kop FROM occasion_reserve_movements WHERE day={:d} ORDER BY created,id").bind({d:DAY}).all(movements);
 const orders=arrayOf(new DynamicModel({id:'',date:'',items:'',status:'',delivery_type:'',payment_status:''}));
 app.db().newQuery("SELECT id,date,items,status,delivery_type,payment_status FROM orders WHERE substr(date,1,10)={:d} AND status!='cancelled' AND (delivery_type='pickup' OR payment_status='paid')").bind({d:DAY}).all(orders);
 const shop=require(`${__hooks}/lib/shop.js`),settings=shop.settings(app);
 const products=app.findRecordsByFilter('products','id != ""','name',1000,0).map(p=>{
  const prices_51={};shop.variantsOf(p,settings).filter(v=>+v.cnt===51).forEach(v=>prices_51[+v.len]=+v.price);
  return {id:p.id,name:p.get('name'),no_stock:!!p.get('no_stock'),mothers_day:!!p.get('mothers_day'),has_photo:(p.get('photo')||[]).length>0,prices_51};
 });
 const decode=v=>JSON.parse(JSON.stringify(v));
 const moves=decode(movements).map(m=>({...m,unit_cost_kop:m.unit_cost_kop<0?null:m.unit_cost_kop,cost_kop:m.cost_kop<0?null:m.cost_kop}));
 return {...aggregate(decode(orders),moves,products),movements:moves,updated_at:new Date().toISOString()};
}
module.exports={DAY,aggregate,report};
