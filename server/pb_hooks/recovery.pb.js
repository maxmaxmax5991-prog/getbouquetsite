// Only jobs queued by NEW payment confirmations are processed. No historical fiscal backfill.
cronAdd("recovery-receipts", "* * * * *", () => {
 const rows=arrayOf(new DynamicModel({order_id:''}));
 $app.db().newQuery("SELECT order_id FROM receipt_jobs WHERE state='pending' ORDER BY created LIMIT 5").all(rows);
 const shop=require(`${__hooks}/lib/shop.js`),receipt=require(`${__hooks}/lib/receipt.js`);
 rows.forEach(row=>{
  try {
   const o=$app.findRecordById('orders',row.order_id);
   if(o.get('payment_status')!=='paid')return;
   const r=receipt.пробить($app,shop.settings($app),o,shop.brandOfOrder($app,o));
   if(!r.ok) $app.db().newQuery("UPDATE receipt_jobs SET state='review',detail={:d} WHERE order_id={:id} AND state='pending'").bind({id:o.id,d:String(r.error || (r.повтор ? 'Receipt already claimed; reconcile before retry' : 'Fiscal configuration requires review')).slice(0,500)}).execute();
  } catch(err){console.log('receipt recovery job failed',row.order_id,String(err));}
 });
});
routerAdd('GET','/api/shop/recovery-status',(e)=>{
 const shop=require(`${__hooks}/lib/shop.js`);
 if(!shop.can(e,['owner']))return e.json(403,{message:'Только владелец.'});
 const counts=new DynamicModel({receipts_pending:0,receipts_review:0,callbacks_pending:0});
 $app.db().newQuery("SELECT (SELECT COUNT(*) FROM receipt_jobs WHERE state='pending') AS receipts_pending,(SELECT COUNT(*) FROM receipt_jobs WHERE state IN ('unknown','review')) AS receipts_review,(SELECT COUNT(*) FROM payment_callback_inbox WHERE processed_at='') AS callbacks_pending").one(counts);
 const receipts=arrayOf(new DynamicModel({order_id:'',state:'',detail:'',created:''}));
 $app.db().newQuery("SELECT order_id,state,detail,created FROM receipt_jobs WHERE state IN ('pending','unknown','review') ORDER BY created DESC LIMIT 50").all(receipts);
 return e.json(200,{counts,receipts});
},$apis.requireAuth('managers'));
