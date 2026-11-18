migrate((app)=>{
 const shop=require(`${__hooks}/lib/shop.js`), id='fruttibablz001';
 const p=app.findRecordById('products',id), settings=shop.settings(app), tables=shop.priceTables(settings);
 const old=tables.find(t=>t.id===p.get('price_table'));
 if(!old)throw Error('Frutti price table missing');
 const c=app.findCollectionByNameOrId('products');
 if(!c.fields.getByName('batch_len')) {c.fields.add(new Field({name:'batch_len',type:'number'}));app.save(c);}
 const pt=JSON.parse(JSON.stringify(old));pt.id='frutti-party-20261118';pt.name='Фрутти Баблз — партия 3000';
 pt.counts=Array.from(new Set((pt.counts||[]).concat([25,51,101]))).sort((a,b)=>a-b);pt.def_count=25;
 pt.prices['40']={'25':2990,'51':5990,'101':10990};
 const ti=tables.findIndex(t=>t.id===pt.id);if(ti>=0)tables[ti]=pt;else tables.push(pt);
 app.db().newQuery('UPDATE settings SET price_tables = {:v} WHERE id = {:id}').bind({v:JSON.stringify(tables),id:settings.id}).execute();
 const stock=shop.stockOf(p);stock['40']=3000;
 app.db().newQuery(`UPDATE products SET stock = {:s}, batch_len = 40, batch_total = 3000,
 batch_note = 'Привезли для вас 3 000 роз Фрутти Баблз', batch_prev_table = {:prev}, price_table = {:pt}, active = true WHERE id = {:id}`)
 .bind({s:JSON.stringify(stock),prev:p.get('batch_prev_table')||p.get('price_table'),pt:pt.id,id}).execute();
 const b=app.findFirstRecordByFilter('brands','domain = {:d}',{d:'venikoff.net'});
 const pins=shop.jget(b,'tile_pins')||[];
 app.db().newQuery('UPDATE brands SET tile_pins = {:v} WHERE id = {:id}').bind({v:JSON.stringify([id].concat(pins.filter(x=>String(x)!==id))),id:b.id}).execute();
 const d=app.findFirstRecordByFilter('drops','date = {:d}',{d:'2026-11-18'});
 const lots=shop.jget(d,'lots')||[];
 lots.forEach(l=>{if(l.product===id){l.retired=true;l.left=0;}});
 app.db().newQuery("UPDATE drops SET lots = {:v}, cnt = 101, price = 5990, old_price = 0, note = '101 одноголовая роза — суперцена' WHERE id = {:id}").bind({v:JSON.stringify(lots),id:d.id}).execute();
 console.log('stock-20261118 '+JSON.stringify({event:'frutti-party',stock,prices:pt.prices['40'],total:3000}));
},(app)=>{});
