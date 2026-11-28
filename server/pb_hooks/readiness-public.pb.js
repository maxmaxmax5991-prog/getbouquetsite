routerAdd('GET','/api/shop/mother-readiness-public',(e)=>{
 e.response.header().set('Cache-Control','no-store');e.response.header().set('X-Robots-Tag','noindex, nofollow, noarchive');e.response.header().set('Referrer-Policy','no-referrer');
 const key=String(e.request.url.query().get('key')||'');if(!/^[A-Za-z0-9_-]{43}$/.test(key))return e.json(404,{message:'Ссылка недействительна'});
 const links=arrayOf(new DynamicModel({day:'',expires:''}));$app.db().newQuery('SELECT day,expires FROM occasion_public_links WHERE token_hash={:hash}').bind({hash:$security.sha256('readiness:'+key)}).all(links);
 if(!links.length||links[0].day!=='2026-11-29'||Date.parse(links[0].expires)<=Date.now())return e.json(404,{message:'Ссылка недействительна или истекла'});
 const requested=String(e.request.url.query().get('source')||'all'),view=['all','site','department'].includes(requested)?requested:'all';
 return e.json(200,require(`${__hooks}/lib/readiness-public.js`).summary(require(`${__hooks}/lib/occasion.js`).report($app),view));
});
