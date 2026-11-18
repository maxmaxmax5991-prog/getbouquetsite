migrate((app)=>{
 const shop=require(`${__hooks}/lib/shop.js`),ms=require(`${__hooks}/lib/ms.js`),s=shop.settings(app);
 const seen={},rows=[];
 ['Баб','Фру','Трут'].forEach(term=>{
  const r=ms.ms(s,'GET','/entity/assortment?filter='+encodeURIComponent('name~'+term)+'&limit=100');
  if(!r.ok){console.log('stock-20261118 '+JSON.stringify({event:'order8363-search2-error',term,error:r.error}));return;}
  (r.data.rows||[]).forEach(x=>{if(!seen[x.id]){seen[x.id]=true;rows.push({id:x.id,name:x.name,type:x.meta.type,archived:x.archived});}});
 });
 console.log('stock-20261118 '+JSON.stringify({event:'order8363-search2',rows}));
},(app)=>{});