migrate((app)=>{
 const shop=require(`${__hooks}/lib/shop.js`);
 const p=app.findRecordById('products','oghyzgr5n0kdnc1'), stock=shop.stockOf(p);
 const before=+stock['40']||0, total=(+p.get('batch_total')||0)+800;stock['40']=before+800;
 app.db().newQuery('UPDATE products SET stock = {:s}, batch_total = {:t}, batch_note = {:n} WHERE id = {:id}').bind({s:JSON.stringify(stock),t:total,n:'Привезли для вас '+total.toLocaleString('ru-RU')+' роз Мисти Баблз',id:p.id}).execute();
 console.log('stock-20261118 '+JSON.stringify({event:'misti-add800',before,after:stock['40'],total}));
 const ms=require(`${__hooks}/lib/ms.js`),s=shop.settings(app);
 const o=app.findFirstRecordByFilter('orders','number = {:n}',{n:8363});
 if(o.get('ms_id')){
  const r=ms.ms(s,'GET','/entity/customerorder/'+o.get('ms_id')+'?expand=payments');
  console.log('stock-20261118 '+JSON.stringify({event:'order8363-payment-verified',ok:r.ok,error:r.error,payment_id:o.get('ms_payment_id'),sum:r.ok?r.data.sum:null,payedSum:r.ok?r.data.payedSum:null,payments:r.ok?(r.data.payments||[]).map(x=>({linkedSum:x.linkedSum,type:x.meta&&x.meta.type,href:x.meta&&x.meta.href})):[]}));
 }
},(app)=>{});