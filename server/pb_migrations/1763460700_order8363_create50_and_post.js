migrate((app)=>{
 const shop=require(`${__hooks}/lib/shop.js`), ms=require(`${__hooks}/lib/ms.js`), s=shop.settings(app);
 const log=x=>console.log('stock-20261118 '+JSON.stringify(x));
 const o=app.findFirstRecordByFilter('orders','number = {:n}',{n:8363});
 if(o.get('payment_status')!=='paid'){log({event:'order8363-wait-payment'});return;}
 const p=app.findRecordById('products','fruttibablz001');
 const found=ms.ms(s,'GET','/entity/assortment?filter='+encodeURIComponent('name~Фрут')+'&limit=100');
 if(!found.ok){log({event:'order8363-search-error',error:found.error});return;}
 const rows=(found.data.rows||[]).filter(r=>!r.archived);
 log({event:'order8363-frutti-candidates',rows:rows.map(r=>({id:r.id,name:r.name,type:r.meta.type}))});
 const picks=shop.jget(p,'ms_pick')||{};
 const chosen={};
 [40,50].forEach(len=>{
  const candidates=rows.filter(r=>r.meta.type==='product' && /фрут/i.test(r.name) && /роз/i.test(r.name) && !/букет|\d+\s*шт/i.test(r.name) && new RegExp('(^|[^0-9])'+len+'\\s*(см|$)','i').test(r.name));
  if(candidates.length===1){const r=candidates[0];chosen[len]=r;picks[len]={id:r.id,type:'product',name:r.name,whole:false};}
 });
 if(!chosen[40]){log({event:'order8363-missing40'});return;}
 if(!chosen[50]){
  const key='venikoff-frutti-bubbles-50';
  const prior=ms.ms(s,'GET','/entity/product?filter='+encodeURIComponent('externalCode='+key)+'&limit=2');
  if(!prior.ok){log({event:'order8363-create-precheck-error',error:prior.error});return;}
  const existing=prior.data.rows||[];
  if(existing.length>1){log({event:'order8363-duplicate50'});return;}
  let product=existing[0];
  if(!product){
   const base=ms.ms(s,'GET','/entity/product/'+chosen[40].id);
   if(!base.ok){log({event:'order8363-base-error',error:base.error});return;}
   const body={name:'ЛФ - Роза Фрутти Бабблс 50см',externalCode:key,description:'Роза Фрутти Бабблс, длина 50 см. Учёт поштучно: один стебель.'};
   if(base.data.uom&&base.data.uom.meta)body.uom={meta:base.data.uom.meta};
   if(base.data.productFolder&&base.data.productFolder.meta)body.productFolder={meta:base.data.productFolder.meta};
   const created=ms.ms(s,'POST','/entity/product',body);
   if(!created.ok){log({event:'order8363-create50-error',error:created.error});return;}
   product=created.data;
   log({event:'order8363-created50',id:product.id,name:product.name});
  }
  if(!product||product.archived||!/Фрутти.*50\s*см/i.test(product.name)){log({event:'order8363-invalid50'});return;}
  chosen[50]=product;picks['50']={id:product.id,type:'product',name:product.name,whole:false};
 }

 app.db().newQuery('UPDATE products SET ms_pick = {:v} WHERE id = {:id}').bind({v:JSON.stringify(picks),id:p.id}).execute();
 log({event:'order8363-bindings-fixed',picks});
 const items=shop.jget(o,'items')||[];
 if(items.length!==1||items[0].id!==p.id||items[0].label!=='50-31'||+items[0].qty!==1){log({event:'order8363-items-changed'});return;}
 const pos=ms.positionsFor(app,s,o);
 if(!pos.ok){log({event:'order8363-positions-error',error:pos.error});return;}
 const frutti=pos.positions.filter(x=>String(x.assortment.meta.href).endsWith('/'+chosen[50].id));
 const sum=pos.positions.reduce((n,x)=>n+x.quantity*x.price,0);
 if(frutti.length!==1||frutti[0].quantity!==31||Math.abs(sum-Math.round(+o.get('total')*100))>1){log({event:'order8363-check-failed',frutti:frutti.map(x=>({quantity:x.quantity,price:x.price})),sum,totalKop:Math.round(+o.get('total')*100)});return;}
 const existed=!!o.get('ms_id');
 if(existed){const result=ms.syncPositions(app,o);if(!result.ok){log({event:'order8363-sync-error',error:result.error});return;}}
 const sent=ms.pushOrder(app,o);
 if(!sent.ok){log({event:'order8363-send-error',error:sent.error});return;}
 const paid=ms.markPaid(app,o);
 let payment={ok:!!o.get('ms_payment_id')};if(!o.get('ms_payment_id'))payment=ms.addPayment(app,o);
 const applied=ms.ms(s,'PUT','/entity/customerorder/'+sent.id,{applicable:true});
 const check=ms.ms(s,'GET','/entity/customerorder/'+sent.id+'?expand=positions.assortment,state');
 if(check.ok)app.db().newQuery("UPDATE orders SET ms_error = '' WHERE id = {:id}").bind({id:o.id}).execute();
 log({event:'order8363-result',sent:sent.ok,paid:paid.ok,payment:payment.ok,applied:applied.ok,ms_id:sent.id,verified:check.ok,error:check.error||applied.error||payment.error||paid.error,order:check.ok?{name:check.data.name,applicable:check.data.applicable,state:check.data.state&&check.data.state.name,sum:check.data.sum,positions:((check.data.positions||{}).rows||[]).map(x=>({name:x.assortment&&x.assortment.name,quantity:x.quantity,price:x.price}))}:null});
},(app)=>{});