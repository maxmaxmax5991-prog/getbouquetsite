migrate((app)=>{
 const shop=require(`${__hooks}/lib/shop.js`),ms=require(`${__hooks}/lib/ms.js`),s=shop.settings(app);
 const log=x=>console.log('stock-20261118 '+JSON.stringify(x));
 const o=app.findFirstRecordByFilter('orders','number = {:n}',{n:8363});
 const mid=String(o.get('ms_id')||'');
 if(!mid){log({event:'order8363-final-no-id'});return;}
 const read=ms.ms(s,'GET','/entity/customerorder/'+mid+'?expand=positions.assortment,state');
 if(!read.ok){log({event:'order8363-final-read-error',error:read.error});return;}
 const old='a743dd2d-df61-11f1-0a80-0c1600182cb3', target='3084610d-e31f-11f1-0a80-0b1d0019fc68';
 const rows=(read.data.positions||{}).rows||[];
 const rose=rows.filter(x=>x.assortment&&(x.assortment.id===old||x.assortment.id===target));
 if(read.data.name!=='8363'||rose.length!==1||rose[0].quantity!==31||Math.round(read.data.sum)!==Math.round(+o.get('total')*100)){log({event:'order8363-final-guard-failed'});return;}
 if(rose[0].assortment.id!==target){
  const positions=rows.map(x=>{
   const v={};['id','quantity','price','discount','vat','vatEnabled','reserve','pack'].forEach(k=>{if(x[k]!==undefined)v[k]=x[k];});
   v.assortment={meta:x.assortment.meta};
   if(x.id===rose[0].id)v.assortment={meta:{href:'https://api.moysklad.ru/api/remap/1.2/entity/product/'+target,type:'product',mediaType:'application/json'}};
   return v;
  });
  const write=ms.ms(s,'PUT','/entity/customerorder/'+mid,{positions,applicable:true});
  if(!write.ok){log({event:'order8363-final-write-error',error:write.error});return;}
 }
 const check=ms.ms(s,'GET','/entity/customerorder/'+mid+'?expand=positions.assortment,state');
 const ps=check.ok?((check.data.positions||{}).rows||[]):[];
 const ok=check.ok&&check.data.applicable&&Math.round(check.data.sum)===Math.round(read.data.sum)&&ps.some(x=>x.assortment&&x.assortment.id===target&&x.quantity===31)&&!ps.some(x=>x.assortment&&x.assortment.id===old);
 if(ok)app.db().newQuery("UPDATE orders SET ms_error = '' WHERE id = {:id}").bind({id:o.id}).execute();
 log({event:'order8363-final-verified',ok,ms_id:mid,error:check.error,order:check.ok?{name:check.data.name,applicable:check.data.applicable,state:check.data.state&&check.data.state.name,sum:check.data.sum,positions:ps.map(x=>({name:x.assortment&&x.assortment.name,quantity:x.quantity,price:x.price}))}:null});
},(app)=>{});