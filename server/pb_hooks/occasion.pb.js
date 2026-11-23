routerAdd('GET','/api/shop/mother-reserve',(e)=>{
 const shop=require(`${__hooks}/lib/shop.js`);
 if(!shop.can(e,['owner','head','manager']))return e.json(403,{message:'Недостаточно прав.'});
 const report=require(`${__hooks}/lib/occasion.js`).report($app);report.can_view_cost=shop.can(e,['owner','head']);
 if(!report.can_view_cost){report.total.purchase_cost=null;delete report.total.purchase_cost_kop;report.positions.forEach(r=>{delete r.purchase_cost;delete r.purchase_cost_kop;});report.movements.forEach(r=>{delete r.unit_cost_kop;delete r.cost_kop;});}
 e.response.header().set('Cache-Control','no-store');
 return e.json(200,report);
},$apis.requireAuth('managers'));
routerAdd('POST','/api/shop/mother-reserve',(e)=>{
 const shop=require(`${__hooks}/lib/shop.js`),occasion=require(`${__hooks}/lib/occasion.js`);
 if(!shop.can(e,['owner','head']))return e.json(403,{message:'Пополнить резерв может владелец или управляющий.'});
 const b=e.requestInfo().body||{},quantity=+b.quantity,length=+b.length,source=String(b.source||'').trim().slice(0,160),key=String(b.key||'');
 if(!Number.isInteger(quantity)||quantity<1||quantity>100000||!Number.isInteger(length)||length<10||length>200||!source||!/^[a-zA-Z0-9_-]{24,100}$/.test(key))return e.json(400,{message:'Укажите сорт, длину, целое количество и основание пополнения.'});
 let product;try{product=$app.findRecordById('products',String(b.product||''));}catch(_){return e.json(400,{message:'Сорт не найден.'});}
 const cost=b.unit_cost===null||b.unit_cost===undefined||b.unit_cost===''?null:+b.unit_cost;
 if(cost!==null&&(!Number.isFinite(cost)||cost<0||cost>100000||Math.abs(cost*100-Math.round(cost*100))>.00001))return e.json(400,{message:'Закупочная цена — в рублях за стебель, не более двух знаков после запятой.'});
 const costKop=cost===null?null:Math.round(cost*100);
 const id=$security.sha256('occasion-topup:'+key),day=occasion.DAY;
 $app.runInTransaction(app=>{
  const old=arrayOf(new DynamicModel({product_id:'',length:0,quantity:0,source:'',unit_cost_kop:-1}));
  app.db().newQuery('SELECT product_id,length,quantity,source,COALESCE(unit_cost_kop,-1) AS unit_cost_kop FROM occasion_reserve_movements WHERE id={:id}').bind({id}).all(old);
  if(old.length){if(old[0].product_id!==product.id||old[0].length!==length||old[0].quantity!==quantity||old[0].source!==source||(old[0].unit_cost_kop<0?null:old[0].unit_cost_kop)!==costKop)throw new BadRequestError('Это пополнение уже записано с другими данными. Обновите страницу.');return;}
  app.db().newQuery('INSERT INTO occasion_reserve_movements (id,day,product_id,length,quantity,source,created,actor,unit_cost_kop,cost_kop) VALUES ({:id},{:day},{:pid},{:len},{:qty},{:source},{:at},{:actor},{:cost},{:totalCost})').bind({id,day,pid:product.id,len:length,qty:quantity,source,at:new Date().toISOString(),actor:e.auth.id,cost:costKop,totalCost:costKop===null?null:costKop*quantity}).execute();
 });
 return e.json(200,{ok:true,report:occasion.report($app)});
},$apis.requireAuth('managers'));
routerAdd('GET','/api/shop/mother-map',(e)=>{
 const shop=require(`${__hooks}/lib/shop.js`);
 if(!shop.can(e,['owner','head','manager']))return e.json(403,{message:'Недостаточно прав.'});
 e.response.header().set('Cache-Control','no-store');
 const rows=arrayOf(new DynamicModel({id:'',number:0,interval:'',address:'',lat:0.1,lon:0.1,delivery_type:'',payment_status:'',status:'',unknown_address:false}));
 $app.db().newQuery("SELECT id,number,interval,address,lat,lon,delivery_type,payment_status,status,unknown_address FROM orders WHERE substr(date,1,10)='2026-11-29' AND status!='cancelled' AND (delivery_type='pickup' OR payment_status='paid') ORDER BY interval,number").all(rows);
 const department=require(`${__hooks}/lib/occasion.js`).departmentReport($app);
 const mapOrders=JSON.parse(JSON.stringify(rows)).map(o=>({...o,source:'site'})).concat(department.documents.filter(d=>d.counted).map(d=>({id:'ms:'+d.id,number:d.number,source:'department',channel:d.channel,interval:d.interval||'',address:d.address||'',lat:+d.lat||0,lon:+d.lon||0,delivery_type:d.pickup?'pickup':'delivery',payment_status:d.paid?'paid':'unpaid',status:'new',unknown_address:!d.address&&!d.pickup,geo_error:d.geo_error||''})));
 const s=shop.settings($app),lat=+s.get('origin_lat')||0,lon=+s.get('origin_lon')||0;
 return e.json(200,{day:'2026-11-29',orders:mapOrders,department_updated_at:department.updated_at,pickup:{lat,lon,address:String(s.get('pickup_address')||s.get('origin_address')||'Точка самовывоза')},updated_at:new Date().toISOString()});
},$apis.requireAuth('managers'));
routerAdd('GET','/api/shop/mother-free',(e)=>{
 e.response.header().set('Cache-Control','no-store');e.response.header().set('X-Robots-Tag','noindex, nofollow, noarchive');e.response.header().set('Referrer-Policy','no-referrer');
 const key=String(e.request.url.query().get('key')||'');if(!/^[A-Za-z0-9_-]{43}$/.test(key))return e.json(404,{message:'Ссылка недействительна.'});
 const rows=arrayOf(new DynamicModel({day:'',expires:''}));$app.db().newQuery('SELECT day,expires FROM occasion_public_links WHERE token_hash={:hash}').bind({hash:$security.sha256(key)}).all(rows);
 if(!rows.length||rows[0].day!=='2026-11-29'||Date.parse(rows[0].expires)<=Date.now())return e.json(404,{message:'Ссылка недействительна или срок её действия истёк.'});
 const r=require(`${__hooks}/lib/occasion.js`).report($app),t=r.total;
 return e.json(200,{day:r.day,updated_at:r.updated_at,sales_updated_at:r.department.updated_at,sales_stale:r.department.stale||!!r.department.last_error,total:{reserved:t.reserved,booked:t.booked,free:t.free,shortage:t.shortage,percent:t.percent},positions:r.positions.filter(p=>p.has_reserve||p.shortage>0).map(p=>({name:p.name,length:p.length,reserved:p.has_reserve?p.reserved:0,booked:p.booked,free:p.has_reserve?p.free:-p.booked,shortage:p.shortage||0,has_reserve:p.has_reserve}))});
});
