function rowsFor(r,view){
 const states=new Map((r.department?.site_orders||[]).map(o=>[o.site_id,o]));
 const done=new Set(['Ожидает отправку','Готов к самовывозу','Отправлен','Отгружен','Доставлен']);
 const rows=(r.site_orders||[]).map(o=>{
  const m=states.get(o.id),verified=m&&m.ms_id===o.ms_id;
  return {id:o.id,store_id:verified?(m.store_id||''):'',source:'site',pickup:o.delivery_type==='pickup',interval:o.interval||'Без времени',ready:verified?done.has(m.state):['photo','delivering','done'].includes(o.status)};
 }).concat((r.department?.documents||[]).filter(o=>o.counted).map(o=>({id:'ms:'+o.id,store_id:o.store_id||'',source:'department',pickup:o.pickup,interval:o.interval||'Без времени',ready:done.has(o.state)})));
 return rows.filter(o=>view==='all'||o.source===view);
}


function summary(r,view){
 const rows=rowsFor(r,view),stores=[{id:'3d520ee3-76c1-11f0-0a80-142900354c8e',name:'Москва 01'},{id:'36029ea4-e4b8-11f1-0a80-0c290009e4f4',name:'Москва 02'}];
 const labels=['До 13:00','13:00–18:00','18:00–22:00'],count=rows=>{const ready=rows.filter(o=>o.ready).length;return{total:rows.length,ready,percent:rows.length?Math.round(ready/rows.length*1000)/10:0};};
 const band=o=>{const ts=String(o.interval||'').match(/\d{1,2}:[0-5]\d/g)||[];if(!ts.length)return -1;const t=ts[ts.length-1].split(':').map(Number),m=t[0]*60+t[1];return m<=780?0:m<=1080?1:m<=1320?2:-1;};
 return {day:'2026-11-29',updated_at:r.updated_at,synced_at:r.department?.updated_at,stale:!!(r.department?.stale||r.department?.last_error),total:count(rows),unknown_store:rows.filter(o=>!stores.some(s=>s.id===o.store_id)).length,stores:stores.map(s=>{const os=rows.filter(o=>o.store_id===s.id);return{name:s.name,...count(os),delivery:count(os.filter(o=>!o.pickup)),pickup:count(os.filter(o=>o.pickup)),bands:labels.map((label,i)=>({label,...count(os.filter(o=>band(o)===i)),delivery:count(os.filter(o=>band(o)===i&&!o.pickup)),pickup:count(os.filter(o=>band(o)===i&&o.pickup))})),unknown_time:os.filter(o=>band(o)<0).length};})};
}
module.exports={summary};
