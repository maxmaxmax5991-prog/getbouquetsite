migrate((app)=>{
 const shop=require(`${__hooks}/lib/shop.js`);
 const b=app.findFirstRecordByFilter('brands','domain = {:d}',{d:'venikoff.net'});
 const top=['fruttibablz001','oghyzgr5n0kdnc1','lploh076pnut27y'];
 const pins=shop.jget(b,'tile_pins')||[];
 const next=top.concat(pins.filter(x=>top.indexOf(String(x))<0));
 app.db().newQuery('UPDATE brands SET tile_pins = {:v} WHERE id = {:id}').bind({v:JSON.stringify(next),id:b.id}).execute();
 console.log('stock-20261118 '+JSON.stringify({event:'party-tiles-first',pins:next}));
},(app)=>{});