const PREFIX='Ошибка связи МС: ';
function owned(s,o,row,ms){
 if(!row)return false;
 const id=r=>String(r&&r.meta&&r.meta.href||'').split('/').pop();
 if([String(s.get('ms_store_id')),'36029ea4-e4b8-11f1-0a80-0c290009e4f4'].indexOf(id(row.store))<0)return false;
 if([String(s.get('ms_org_id')),'047ab4e2-e4b8-11f1-0a80-1f37000a92f0'].indexOf(id(row.organization))<0)return false;
 return ms.ownsLinkedOrder(s,{id:o.id,get:k=>o[k]},row);
}
function saveState(app,value){app.db().newQuery('INSERT INTO watchdog_state(key,value,at) VALUES ({:key},{:value},{:at}) ON CONFLICT(key) DO UPDATE SET value=excluded.value,at=excluded.at').bind({key:'ms-links:audit',value:JSON.stringify(value),at:new Date().toISOString()}).execute();}
function state(app){const row=new DynamicModel({value:''});try{app.db().newQuery("SELECT value FROM watchdog_state WHERE key='ms-links:audit'").one(row);return JSON.parse(row.value);}catch(_){return {checked_at:null,checked:0,issues:[],error:'Сверка ещё не выполнена.'};}}
function run(app){
 const shop=require(`${__hooks}/lib/shop.js`),ms=require(`${__hooks}/lib/ms.js`),err=require(`${__hooks}/lib/err.js`),s=shop.settings(app);
 if(!s.get('ms_enabled')||!s.get('ms_token'))return {checked:0,issues:[],error:'Интеграция выключена.'};
 if(!shop.claim(app,'ms-links-audit','audit'))return {...state(app),running:true};
 try{
  const today=shop.moscowToday(),since=new Date(Date.now()-14*86400000).toISOString().replace('T',' ').slice(0,19);
  const rows=arrayOf(new DynamicModel({id:'',number:0,ms_id:'',ms_error:'',created:''}));
  app.db().newQuery("SELECT id,number,ms_id,ms_error,created FROM orders WHERE status NOT IN ('cancelled','done') AND (date >= {:today} OR created >= {:since}) AND (ms_id!='' OR delivery_type='pickup' OR payment_status='paid')").bind({today,since}).all(rows);
  const orders=JSON.parse(JSON.stringify(rows)),ids=[...new Set(orders.map(o=>o.ms_id).filter(Boolean))],docs={};
  for(let i=0;i<ids.length;i+=50){
   const batch=ids.slice(i,i+50),r=ms.ms(s,'GET','/entity/customerorder?filter='+encodeURIComponent(batch.map(id=>'id='+id).join(';'))+'&limit=100');
   if(!r.ok)throw new Error(r.error||'МойСклад не ответил.');
   if((r.data.meta&&r.data.meta.size||0)>100)throw new Error('Склад вернул неполную выборку идентификаторов.');
   const expected={};batch.forEach(id=>expected[id]=true);
   (r.data.rows||[]).forEach(row=>{if(!expected[row.id])throw new Error('Склад вернул документ вне запроса.');docs[row.id]=row;});
  }
  const issues=[],previous={};(state(app).issues||[]).forEach(o=>previous[o.id]=o.reason);
  for(const o of orders){
   if(!o.ms_id&&Date.now()-Date.parse(o.created)<120000)continue;
   const row=docs[o.ms_id],ok=!!o.ms_id&&owned(s,o,row,ms);
   if(ok){
    if(String(o.ms_error||'').startsWith(PREFIX))app.db().newQuery("UPDATE orders SET ms_error='' WHERE id={:id} AND ms_id={:mid} AND ms_error={:error}").bind({id:o.id,mid:o.ms_id,error:o.ms_error}).execute();
    continue;
   }
   const reason=!o.ms_id?(o.ms_error&&!String(o.ms_error).startsWith(PREFIX)?o.ms_error:'документ ещё не связан с заказом.'):!row?'связанный документ не найден в МойСкладе.':'номер совпал с чужим документом; передача заказа не подтверждена.';
   const message=PREFIX+reason;
   issues.push({number:o.number,id:o.id,reason,ms_id:o.ms_id});
   if(o.ms_id&&o.ms_error!==message){
    app.db().newQuery('UPDATE orders SET ms_error={:error} WHERE id={:id} AND ms_id={:mid}').bind({id:o.id,mid:o.ms_id,error:message}).execute();
   }
   if(previous[o.id]!==reason){
    err.note(app,'МойСклад','Заказ №'+o.number+': '+reason,'Проверка действующих заказов всех дат');
   }
  }
  const result={checked_at:new Date().toISOString(),checked:orders.length,issues,error:''};saveState(app,result);return result;
 }catch(error){const result={...state(app),error:String(error.message||error),attempted_at:new Date().toISOString()};saveState(app,result);err.note(app,'МойСклад',result.error,'Не удалось выполнить полную сверку связей');return result;}
 finally{shop.unclaim(app,'ms-links-audit','audit');}
}
module.exports={PREFIX,owned,run,state};
