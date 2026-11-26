cronAdd('ms-link-audit','*/5 * * * *',()=>{try{require(`${__hooks}/lib/ms-link-audit.js`).run($app);}catch(e){console.log('ms-link-audit',e);}});
routerAdd('GET','/api/shop/ms-link-audit',(e)=>{
 const shop=require(`${__hooks}/lib/shop.js`);if(!shop.can(e,['owner','head','manager']))return e.json(403,{message:'Недостаточно прав.'});
 e.response.header().set('Cache-Control','no-store');return e.json(200,require(`${__hooks}/lib/ms-link-audit.js`).state($app));
},$apis.requireAuth('managers'));
routerAdd('POST','/api/shop/ms-link-audit',(e)=>{
 const shop=require(`${__hooks}/lib/shop.js`);if(!shop.can(e,['owner','head']))return e.json(403,{message:'Недостаточно прав.'});
 e.response.header().set('Cache-Control','no-store');return e.json(200,require(`${__hooks}/lib/ms-link-audit.js`).run($app));
},$apis.requireAuth('managers'));
