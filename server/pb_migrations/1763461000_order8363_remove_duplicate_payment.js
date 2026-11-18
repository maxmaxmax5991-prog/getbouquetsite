migrate((app)=>{
 const shop=require(`${__hooks}/lib/shop.js`),ms=require(`${__hooks}/lib/ms.js`),s=shop.settings(app);
 const log=x=>console.log('stock-20261118 '+JSON.stringify(x));
 const o=app.findFirstRecordByFilter('orders','number = {:n}',{n:8363}),mid=String(o.get('ms_id'));
 const duplicate='3193b8ac-e31f-11f1-0a80-0fbf001aff99',original='3d64824e-e315-11f1-0a80-0fbc0005a66d';
 const order=ms.ms(s,'GET','/entity/customerorder/'+mid+'?expand=payments');
 if(!order.ok){log({event:'order8363-dedup-read-error',error:order.error});return;}
 const payments=Array.isArray(order.data.payments)?order.data.payments:[];
 const matching=id=>payments.find(x=>String(x.meta&&x.meta.href||'').endsWith('/'+id)&&x.linkedSum===606900);
 if(matching(duplicate)){
  if(!matching(original)||order.data.payedSum!==1213800||order.data.sum!==606900||String(o.get('ms_payment_id'))!==duplicate){log({event:'order8363-dedup-guard-failed'});return;}
  const doc=ms.ms(s,'GET','/entity/paymentin/'+duplicate);
  if(!doc.ok||doc.data.sum!==606900||!(doc.data.operations||[]).some(x=>String(x.meta&&x.meta.href||'').endsWith('/'+mid)&&x.linkedSum===606900)){log({event:'order8363-dedup-document-mismatch'});return;}
  const removed=$http.send({url:'https://api.moysklad.ru/api/remap/1.2/entity/paymentin/'+duplicate,method:'DELETE',headers:{Authorization:'Bearer '+s.get('ms_token')},timeout:40});
  if(removed.statusCode!==200&&removed.statusCode!==204){log({event:'order8363-dedup-delete-error',status:removed.statusCode});return;}
 }
 const check=ms.ms(s,'GET','/entity/customerorder/'+mid+'?expand=payments');
 const refs=check.ok&&Array.isArray(check.data.payments)?check.data.payments:[];
 const ok=check.ok&&check.data.sum===606900&&check.data.payedSum===606900&&refs.length===1&&String(refs[0].meta.href).endsWith('/'+original);
 if(ok)app.db().newQuery('UPDATE orders SET ms_payment_id = {:v} WHERE id = {:id}').bind({v:original,id:o.id}).execute();
 log({event:'order8363-payment-final',ok,sum:check.ok?check.data.sum:null,payedSum:check.ok?check.data.payedSum:null,payments:refs.length,error:check.error});
},(app)=>{});