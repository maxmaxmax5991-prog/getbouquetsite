routerAdd('GET','/api/shop/mother-warehouses',(e)=>{
 const shop=require(`${__hooks}/lib/shop.js`);
 if(!shop.can(e,['owner','head','manager']))return e.json(403,{message:'Недостаточно прав.'});
 e.response.header().set('Cache-Control','no-store');
 try{return e.json(200,require(`${__hooks}/lib/mother-warehouses.js`).list($app));}catch(error){return e.json(error.status||502,{message:error.message||'Не удалось загрузить склады.'});}
},$apis.requireAuth('managers'));
routerAdd('POST','/api/shop/mother-warehouses',(e)=>{
 const shop=require(`${__hooks}/lib/shop.js`);
 if(!shop.can(e,['owner','head','manager']))return e.json(403,{message:'Недостаточно прав.'});
 e.response.header().set('Cache-Control','no-store');
 try{return e.json(200,require(`${__hooks}/lib/mother-warehouses.js`).move($app,e.requestInfo().body||{}));}catch(error){return e.json(error.status||502,{message:error.message||'Не удалось подтвердить перенос. Обновите список.'});}
},$apis.requireAuth('managers'));
