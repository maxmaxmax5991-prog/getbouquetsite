migrate((app) => {
 const shop=require(`${__hooks}/lib/shop.js`);
 const ids=['j3fkt9x2pihfu0s','j1s8m2a658b2hhx','r1xwkv30e1cr7i9'];
 ids.forEach(id=>app.db().newQuery("UPDATE products SET fresh_date = {:d} WHERE id = {:id}").bind({d:'2026-11-18',id}).execute());
 const all=app.findRecordsByFilter('products',"id != ''",'',1000,0);
 const matches=all.filter(p=>/легр|al[eé]gr|allegr|прин|перси|princ|persi/i.test(String(p.get('name'))+' '+String(p.get('ms_name'))+' '+JSON.stringify(shop.jget(p,'ms_pick')))).map(p=>({id:p.id,name:p.get('name'),active:p.get('active'),ms_name:p.get('ms_name'),lengths:shop.jget(p,'lengths')}));
 console.log('stock-20261118 '+JSON.stringify({event:'fresh-final',ids,missingSortCandidates:matches}));
}, (app)=>{});