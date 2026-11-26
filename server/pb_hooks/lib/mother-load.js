const normalSlot=value=>{
 const times=String(value||'').match(/\b\d{1,2}:\d{2}\b/g)||[];
 return times.length?times.slice(0,2).map(t=>t.padStart(5,'0')).join('–'):String(value||'').trim()||'Без времени';
};
const empty=()=>({count:0,paid:0,unpaid:0,new:0,accepted:0});
function aggregate(orders,stores){
 const unique={};orders.forEach(o=>unique[o.id]=o);
 const rows=Object.keys(unique).map(id=>unique[id]),delivery={},pickup={};
 const summary=stores.map(s=>({...s,total:0,deliveries:0,pickups:0,paid_deliveries:0,unpaid_deliveries:0,unpaid_pickups:0,new_deliveries:0,accepted_deliveries:0}));
 rows.forEach(o=>{
  const s=summary.find(s=>s.id===o.store);if(!s)return;
  const isPickup=o.delivery_type==='pickup',isNew=/^новый$/i.test(String(o.state||'').trim()),accepted=/^принят(?:,|\s|$)/i.test(String(o.state||''));
  s.total++;if(isPickup){s.pickups++;if(!o.paid)s.unpaid_pickups++;}else{s.deliveries++;s[o.paid?'paid_deliveries':'unpaid_deliveries']++;if(isNew)s.new_deliveries++;if(accepted)s.accepted_deliveries++;}
  const interval=normalSlot(o.interval),table=isPickup?pickup:delivery;
  if(!table[interval]){table[interval]={interval,total:0,stores:{}};stores.forEach(s=>table[interval].stores[s.id]=empty());}
  const row=table[interval];row.total++;const cell=row.stores[s.id];cell.count++;cell[o.paid?'paid':'unpaid']++;if(isNew)cell.new++;if(accepted)cell.accepted++;
 });
 const time=s=>{const m=s.match(/^(\d\d):(\d\d)/);return m?+m[1]*60+ +m[2]:9999;};
 const sorted=table=>Object.keys(table).map(k=>table[k]).sort((a,b)=>time(a.interval)-time(b.interval)||a.interval.localeCompare(b.interval,'ru'));
 const total=summary.reduce((a,s)=>{for(const k of Object.keys(a))a[k]+=s[k];return a;},{total:0,deliveries:0,pickups:0,paid_deliveries:0,unpaid_deliveries:0,unpaid_pickups:0,new_deliveries:0,accepted_deliveries:0});
 summary.forEach(s=>s.share=total.total?Math.round(s.total/total.total*1000)/10:0);
 return {stores:summary,total,delivery_slots:sorted(delivery),pickup_slots:sorted(pickup)};
}
function report(app){const data=require(`${__hooks}/lib/mother-warehouses.js`).list(app,true);return {day:data.day,updated_at:data.updated_at,...aggregate(data.orders,data.stores)};}
module.exports={normalSlot,aggregate,report};
