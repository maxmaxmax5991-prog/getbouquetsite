migrate((app)=>{
 const shop=require(`${__hooks}/lib/shop.js`), ms=require(`${__hooks}/lib/ms.js`), s=shop.settings(app);
 const log=x=>console.log('stock-20261118 '+JSON.stringify(x));
 let o;try{o=app.findFirstRecordByFilter('orders','number = {:n}',{n:8363});}catch(_){log({event:'order8363-not-found'});return;}
 const p=app.findRecordById('products','fruttibablz001');
 log({event:'order8363-preflight',order:o.id,number:o.get('number'),payment_status:o.get('payment_status'),status:o.get('status'),delivery_type:o.get('delivery_type'),ms_id:o.get('ms_id'),ms_error:o.get('ms_error'),items:(shop.jget(o,'items')||[]).map(i=>({id:i.id,name:i.name,label:i.label,qty:i.qty,price:i.price})),frutti:{ms_name:p.get('ms_name'),ms_pick:shop.jget(p,'ms_pick'),ms_ids:shop.jget(p,'ms_ids')}});
 const a=ms.ms(s,'GET','/entity/assortment?search='+encodeURIComponent('Фрутти')+'&limit=100');
 log({event:'order8363-assortment',ok:a.ok,error:a.error,rows:a.ok?(a.data.rows||[]).map(r=>({id:r.id,name:r.name,type:r.meta.type,archived:r.archived})):[]});
 if(o.get('ms_id')){const r=ms.ms(s,'GET','/entity/customerorder/'+o.get('ms_id')+'?expand=positions.assortment,state');log({event:'order8363-existing',ok:r.ok,error:r.error,data:r.ok?{id:r.data.id,name:r.data.name,applicable:r.data.applicable,state:r.data.state&&r.data.state.name,positions:((r.data.positions||{}).rows||[]).map(x=>({quantity:x.quantity,price:x.price,name:x.assortment&&x.assortment.name,id:x.assortment&&x.assortment.id}))}:null});}
},(app)=>{});
