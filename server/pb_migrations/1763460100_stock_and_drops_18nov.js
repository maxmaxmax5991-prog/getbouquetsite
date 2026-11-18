migrate((app) => {
 const shop = require(`${__hooks}/lib/shop.js`);
 const all = app.findRecordsByFilter("products", "id != ''", "", 1000, 0);
 const cats = app.findRecordsByFilter("categories", "id != ''", "", 200, 0);
 const tables = shop.priceTables(shop.settings(app));
 const norm = x => String(x || '').toLowerCase().replace(/ё/g,'е').replace(/[^а-яa-z0-9]/g,'');
 const log = x => console.log('stock-20261118 ' + JSON.stringify(x));
 const cat = p => { const c = cats.find(c=>c.id===p.get('category')); return c ? String(c.get('slug')) : ''; };
 const foreign = p => /french|ecuador|hydrangea|kenya/.test(cat(p)) || /фридом|freedom/i.test(String(p.get('name'))) || /колумб|colombia|франц|эквадор/i.test(String((tables.find(t=>t.id===p.get('price_table'))||{}).name||''));
 const rows = [["Аваланж", {"50": 475, "60": 1320}], ["Алегрия", {"40": 1120}], ["Барбадос", {"70": 577}], ["Беларусь", {"40": 720, "50": 701}], ["Вайт Балунс", {"60": 200}], ["Викториан Пич", {"50": 1080}], ["Луна Трендсеттер", {"40": 167, "50": 520}], ["Корал Йо-Йо", {"40": 240, "50": 640, "60": 200}], ["Космик", {"40": 455}], ["Кейтлин", {"40": 289}], ["Кэти Грандмас", {"40": 335}], ["Лавендер Баблз", {"40": 859}], ["Леди Бомбастик", {"40": 600}], ["Маритим", {"60": 300}], ["Мисс Бомбастик", {"40": 1699}], ["Мисс Пигги", {"50": 120}], ["Наэли", {"80": 1140}], ["Перл Аваланж", {"40": 300, "50": 1547}], ["Пинк Аваланж", {"50": 683, "60": 799}], ["Пинк Дайменшн", {"50": 215}], ["Пич Аваланж", {"40": 699, "50": 3180, "60": 474}], ["Пич Дайменшн", {"40": 200}], ["Принс Перси", {"40": 420}], ["Ред Баблз", {"40": 120}], ["Ред Наоми", {"40": 480, "50": 240, "60": 600}], ["Свит Аваланж", {"40": 147, "50": 2574}], ["Скарлет Дайменшн", {"40": 289}], ["Спешл Дайменшен", {"40": 689, "50": 240}], ["Супер Сенсейшен", {"40": 80, "50": 1300, "60": 600}], ["Талея", {"40": 474, "50": 1395, "60": 90}], ["Таня", {"40": 320}], ["Фемке", {"40": 766}], ["Флиртинг Баблз", {"70": 160}], ["Фрутти Баблз", {"40": 2655, "50": 1680}], ["Черри Аваланж", {"60": 1579, "70": 467}], ["Эксклюзив Сенсейшен", {"40": 450, "50": 650}], ["Эльторо", {"40": 540}]];
 const mapped=[], unknown=[];
 rows.forEach(r=>{
  let ps=all.filter(p=>norm(p.get('name'))===norm(r[0]) && !p.get('is_express'));
  if(!ps.length && /Алегрия|Принс Перси/.test(r[0])) ps=all.filter(p=>!p.get('is_express') && (/Алегрия/.test(r[0]) ? /ал+[еэ]гр/i.test(String(p.get('name'))) : /прин[сц].*пер[сш]/i.test(String(p.get('name')))));
  if(r[0]==='Беларусь') ps=all.filter(p=>p.id==='lrmpdyb1r3xorap');
  if(r[0]==='Лавендер Баблз') ps=all.filter(p=>p.id==='8xa8wy8bi2verfx');
  if(ps.length!==1) unknown.push({name:r[0],candidates:ps.map(p=>({id:p.id,name:p.get('name')}))});
  else mapped.push({p:ps[0],stock:r[1]});
 });
 if(unknown.length) { log({event:'needs-mapping',unknown,nearby:all.filter(p=>/прин|ал+[еэ]гр/i.test(String(p.get('name')))).map(p=>({id:p.id,name:p.get('name'),active:p.get('active'),lengths:shop.jget(p,'lengths')}))}); }
 let changed=0; const unpriced=[];
 all.forEach(p=>{
  if(foreign(p)||p.get('no_stock')||+p.get('batch_total')>0||p.get('is_express')) return;
  if(['ktvi3c98sst6f3x','5y3bdrrvkz39r0l','umlixtyjgyxlo5f','bvewnsvg1wd7o90'].indexOf(p.id)>=0) return;
  const row=mapped.find(x=>x.p.id===p.id);
  if(!row && !p.get('active')) return;
  if(!/single|rozy/.test(cat(p))) return;
  const lengths=Array.from(new Set((shop.jget(p,'lengths')||[]).map(Number).concat(row?Object.keys(row.stock).map(Number):[]))).sort((a,b)=>a-b);
  const stock={}; lengths.forEach(l=>stock[l]=row?(row.stock[l]||0):0);
  const t=tables.find(t=>t.id===p.get('price_table'));
  if(row) Object.keys(row.stock).forEach(l=>{ if(!Object.values((t&&t.prices||{})[l]||{}).some(v=>+v>0)) unpriced.push({id:p.id,name:p.get('name'),len:l,qty:row.stock[l]}); });
  app.db().newQuery('UPDATE products SET stock = {:s}, lengths = {:l} WHERE id = {:id}').bind({s:JSON.stringify(stock),l:JSON.stringify(lengths),id:p.id}).execute();
  log({event:'stock',id:p.id,name:p.get('name'),stock}); changed++;
 });
 log({event:'complete',changed,unpriced});
 const collection=app.findCollectionByNameOrId('drops');
 if(!collection.fields.getByName('display_through')) { collection.fields.add(new Field({name:'display_through',type:'text',max:10})); app.save(collection); }
 const d=app.findFirstRecordByFilter('drops','date = {:d}',{d:'2026-11-18'});
 const lots=shop.jget(d,'lots') || [];
 const additions=[
 {key:'fruttibablz001:101',product:'fruttibablz001',cnt:101,price:10990,qty:20,left:20},
 {product:'dv7yttgtdop0bl2',cnt:101,price:5990,qty:5,left:5},
 {product:'pccrnsyw8mx1koy',cnt:101,price:5990,qty:3,left:3},
 {product:'xrumitkazb3ebhe',cnt:101,price:5990,qty:3,left:3},
 {product:'n3wu3ot0t4ali92',cnt:101,price:5990,qty:3,left:3},
 {product:'5pernjak957eifm',cnt:101,price:5990,qty:2,left:2}
 ];
 lots.forEach(l=>{if(l.product==='fruttibablz001'&&!l.key){l.cnt=51;l.price=5990;}});
 additions.forEach(l=>{if(!lots.some(x=>(x.key||x.product)===(l.key||l.product))) lots.push(l);});
 app.db().newQuery("UPDATE drops SET display_through = '2026-11-19', lots = {:v}, note = {:n} WHERE id = {:id}").bind({v:JSON.stringify(lots),n:'Дроп дня: Фрутти Баблз и одноголовые розы',id:d.id}).execute();
 log({event:'drop-expanded',lots});

}, (app) => {});
