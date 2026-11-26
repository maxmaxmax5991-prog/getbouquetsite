const DAY='2026-11-29';
const STORES=[{id:'3d520ee3-76c1-11f0-0a80-142900354c8e',organization:'281efedb-76c1-11f0-0a80-0fdb00366fa7',title:'Москва 01',name:'Маленковская, 14к1'},{id:'36029ea4-e4b8-11f1-0a80-0c290009e4f4',organization:'047ab4e2-e4b8-11f1-0a80-1f37000a92f0',title:'Москва 02',name:'1-я Рыбинская, 1с4'}];
const BASE='https://api.moysklad.ru/api/remap/1.2';
const refId=r=>String(r&&r.meta&&r.meta.href||'').split('/').pop();
const allowed=id=>STORES.some(s=>s.id===id);
const allowedOrganization=id=>STORES.some(s=>s.organization===id);
const norm=s=>String(s||'').toLowerCase().replace(/ё/g,'е').replace(/[^а-яa-z0-9]/g,'');
function fail(status,message){const e=new Error(message);e.status=status;throw e;}
function checked(r){if(!r.ok)fail(502,r.error||'МойСклад не ответил. Изменения не подтверждены.');return r.data;}
function attrs(row){const a={};(row.attributes||[]).forEach(r=>a[r.name]=r.value&&typeof r.value==='object'?r.value.name:r.value);return a;}
function isDelivery(row){return norm(attrs(row)['Способ доставки'])===norm('Доставка');}
function cancelled(row){return !!row.deleted||/отмен|отклонен|возврат|утилизирован/i.test(row.state&&row.state.name||'');}
function validate(row,s){
 if(!allowed(refId(row.store))||!allowedOrganization(refId(row.organization)))fail(400,'Заказ относится к другому складу или организации.');
 if(String(row.deliveryPlannedMoment||'').slice(0,10)!==DAY)fail(400,'Перенос доступен только для доставок на 29 ноября.');
 if(!isDelivery(row))fail(400,'Здесь можно переносить только доставки. Самовывоз не изменён.');
 if(cancelled(row))fail(400,'Заказ отменён. Перенос недоступен.');
}
function view(row,site){
 const a=attrs(row),state=row.state&&row.state.name||'',paid=(+row.sum>0&&+row.payedSum>=+row.sum)||(/оплачен/i.test(state)&&!/не\s*оплачен/i.test(state));
 return {id:row.id,number:row.name,site_number:site?site.number:null,source:site?'site':'department',channel:row.salesChannel&&row.salesChannel.name||'',store:refId(row.store),organization:refId(row.organization),interval:String(a['Время доставки']||String(row.deliveryPlannedMoment||'').slice(11,16)),address:String(row.shipmentAddress||row.shipmentAddressFull&&row.shipmentAddressFull.addInfo||''),customer:String(row.agent&&row.agent.name||a['Имя покупателя']||''),total:(+row.sum||0)/100,paid,state,locked:(+row.shippedSum||0)>0||(row.demands||[]).length>0||/доставлен|выполнен|завершен/i.test(state)};
}
function siteLinks(app){const rows=arrayOf(new DynamicModel({ms_id:'',number:0,status:''}));app.db().newQuery("SELECT ms_id,number,status FROM orders WHERE ms_id!=''").all(rows);const result={};JSON.parse(JSON.stringify(rows)).forEach(o=>result[o.ms_id]=o);return result;}
function list(app){
 const shop=require(`${__hooks}/lib/shop.js`),ms=require(`${__hooks}/lib/ms.js`),s=shop.settings(app),sites=siteLinks(app),orders=[];
 for(const store of STORES){
  let offset=0;
  while(true){
   const filter='store='+BASE+'/entity/store/'+store.id+';deliveryPlannedMoment>='+DAY+' 00:00:00;deliveryPlannedMoment<2026-11-30 00:00:00';
   const data=checked(ms.ms(s,'GET','/entity/customerorder?filter='+encodeURIComponent(filter)+'&expand=state,salesChannel,agent&limit=100&offset='+offset));
   const rows=data.rows||[];
   rows.forEach(row=>{if(!isDelivery(row)||cancelled(row)||!allowedOrganization(refId(row.organization))||refId(row.store)!==store.id)return;const site=sites[row.id];if(site&&site.status==='cancelled')return;orders.push(view(row,site));});
   offset+=rows.length;if(!rows.length||offset>=(data.meta&&data.meta.size||0))break;if(offset>=3000)fail(502,'Слишком много заказов. Список не загружен полностью.');
  }
 }
 const unique={};orders.forEach(o=>unique[o.id]=o);
 return {day:DAY,stores:STORES,orders:Object.keys(unique).map(id=>unique[id]),updated_at:new Date().toISOString()};
}
function move(app,body){
 const id=String(body.order||''),from=String(body.from||''),to=String(body.to||'');
 if(!/^[a-f0-9-]{36}$/.test(id)||!allowed(from)||!allowed(to))fail(400,'Укажите заказ и другой склад: Москва 01 или Москва 02.');
 const shop=require(`${__hooks}/lib/shop.js`),ms=require(`${__hooks}/lib/ms.js`),s=shop.settings(app);
 if(!shop.claim(app,id,'mother-store'))fail(409,'Этот заказ уже переносится. Обновите список.');
 try{
  const row=checked(ms.ms(s,'GET','/entity/customerorder/'+id+'?expand=state,salesChannel,agent'));
  validate(row,s);
  if(body.require_accepted&&!/^принят(?:,|\\s|$)/i.test(String(row.state&&row.state.name||'')))fail(409,'Статус заказа изменился: он больше не принят. Перенос пропущен.');
  const site=siteLinks(app)[id];if(site&&site.status==='cancelled')fail(400,'Заказ отменён на сайте. Сначала согласуйте восстановление.');
  if(refId(row.store)!==from)fail(409,'Склад заказа уже изменился. Список будет обновлён.');
  if(view(row,site).locked)fail(400,'У заказа уже есть отгрузка или он завершён. Перенос требует проверки отгрузки в МойСкладе.');
  const target=STORES.find(s=>s.id===to);
  if(from===to&&refId(row.organization)===target.organization)return {ok:true,unchanged:true,order:view(row,site),updated_at:new Date().toISOString()};
  checked(ms.ms(s,'PUT','/entity/customerorder/'+id,{store:{meta:{href:BASE+'/entity/store/'+to,type:'store',mediaType:'application/json'}},organization:{meta:{href:BASE+'/entity/organization/'+target.organization,type:'organization',mediaType:'application/json'}}}));
  const after=checked(ms.ms(s,'GET','/entity/customerorder/'+id+'?expand=state,salesChannel,agent'));
  if(refId(after.store)!==to||refId(after.organization)!==target.organization)fail(502,'МойСклад не подтвердил склад и организацию. Обновите список перед повторной попыткой.');
  return {ok:true,order:view(after,site),updated_at:new Date().toISOString()};
 }finally{shop.unclaim(app,id,'mother-store');}
}
module.exports={DAY,STORES,list,move,isDelivery,validate,view};

