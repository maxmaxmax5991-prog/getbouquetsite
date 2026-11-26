routerAdd('GET','/api/shop/mother-load',(e)=>{
 const shop=require(`${__hooks}/lib/shop.js`);if(!shop.can(e,['owner','head','manager']))return e.json(403,{message:'Недостаточно прав.'});
 e.response.header().set('Cache-Control','no-store');
 try{return e.json(200,require(`${__hooks}/lib/mother-load.js`).report($app));}catch(error){return e.json(error.status||502,{message:error.message||'Не удалось загрузить нагрузку по складам.'});}
},$apis.requireAuth('managers'));
