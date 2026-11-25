// Public availability contains only saleable product IDs, lengths and free stems.
routerAdd("GET","/api/shop/mother-stock",(e)=>{
 const occasion=require(`${__hooks}/lib/occasion.js`);
 const brand=require(`${__hooks}/lib/brand.js`).byHost($app,e);
 const allowed={};
 $app.findRecordsByFilter("products","active=true && mothers_day=true","",1000,0).forEach(p=>{
  const own=p.get("brands")||[];
  if((p.get("photo")||[]).length && (!brand||!own.length||own.indexOf(brand.id)>=0))allowed[p.id]=true;
 });
 const r=occasion.report($app);
 e.response.header().set("Cache-Control","no-store");
 return e.json(200,{day:r.day,updated_at:r.updated_at,department_stale:!!r.department.stale,
  items:r.positions.filter(p=>allowed[p.id]&&p.has_reserve).map(p=>({id:p.id,length:p.length,free:Math.max(0,p.free)}))});
});
