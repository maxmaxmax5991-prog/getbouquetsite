#!/usr/bin/env python3
"""Read-only MoySklad -> atomic dated sales snapshot. Never alters ordinary inventory."""
import sqlite3,json,urllib.request,urllib.parse,gzip,re,pathlib,datetime,time,os,sys,fcntl
DAY='2026-11-29';STORE_ID='3d520ee3-76c1-11f0-0a80-142900354c8e';STORE_NAME='Москва 01 - Маленковская 14, к1 (Ласфлор)';BASE='https://api.moysklad.ru/api/remap/1.2'
STORE_IDS=(STORE_ID,'36029ea4-e4b8-11f1-0a80-0c290009e4f4')
STORE_NAMES={STORE_ID:STORE_NAME,STORE_IDS[1]:'Москва 02 - 1я Рыбинская 1, с4 (Гет Букет)'}
SELECTED=['INST Venikoff','VK Venikoff','INST GB','INST GB LP','VK GB','VK Fl','INST FLOW','INST BELCV','INST 31','Телеграм Venikoff','Телеграмм','WhatsApp','MAX','Ева Venikoff','Ева ГБ','Ева Ген.Дир','Личный акк ген.дир','Яковлев МА','Стафф Магазина','Вх. звонок','Розница','Витрина','Канал Готовые букеты','Юрлица']
def norm(s):return re.sub(r'[^a-zа-я0-9]','',str(s).lower().replace('ё','е').replace('аваланш','аваланж'))
def flower_key(s):
 s=re.sub(r'\d+',' ',str(s).lower().replace('ё','е'));s=re.sub(r'\b(?:лф|росс|роза|розы|куст|кустовая|кустовая\.|см)\b',' ',s);s=re.sub(r'\d+',' ',s);return norm(s)
def classify(order):
 state=(order.get('state')or{}).get('name','').lower().replace('ё','е')
 attrs={a['name']:(a.get('value')or{}).get('name','') for a in order.get('attributes',[]) if isinstance(a.get('value'),dict)}
 pickup=norm(attrs.get('Способ доставки'))==norm('Самовывоз')
 paid=('оплачен' in state and not re.search(r'не\s*оплачен',state))or(order.get('sum',0)>0 and order.get('payedSum',0)>=order['sum'])
 cancelled='отмен' in state or bool(order.get('deleted'))
 return {'counted':not cancelled and (pickup or paid),'pickup':pickup,'paid':paid,'state':(order.get('state')or{}).get('name',''),'reason':'Отменён' if cancelled else '' if pickup or paid else 'Неоплаченная доставка'}
def delivery_details(order):
 attrs={a['name']:a.get('value')for a in order.get('attributes',[]) if isinstance(a.get('value'),str)}
 raw=attrs.get('Время доставки','');times=re.findall(r'(?<!\d)([0-2]?\d):([0-5]\d)',raw);times=[h.zfill(2)+':'+m for h,m in times]
 interval='–'.join(times[:2]) if times else str(order.get('deliveryPlannedMoment',''))[11:16]
 if interval=='00:00':interval=''
 full=order.get('shipmentAddressFull')or{};parts=[str(full.get(k)or'').strip() for k in ['city','street','house','block']];address=', '.join(p for p in parts if p)
 if not full.get('street') or not full.get('house'):
  address=str(order.get('shipmentAddress')or', '.join(p for p in [str(full.get('city')or''),str(full.get('addInfo')or'')]if p));address=re.split(r'\b(?:кв\.?|квартира|подъезд|этаж|домофон|получатель|телефон)\b',address,1,flags=re.I)[0].strip(' ,;')
 address=re.sub(r'\+?[78][\s()\-]*\d(?:[\s()\-]*\d){9}', '',address).strip(' ,;')
 return {'interval':interval,'interval_raw':raw,'address':address}
def geocode_cached(address,key,cache):
 if not address or not key:return {'lat':0,'lon':0,'geo_error':'Адрес не указан' if not address else 'Геокодирование не настроено'}
 digest=__import__('hashlib').sha256(address.encode()).hexdigest();old=cache.get(digest)
 if old and old.get('expires',0)>time.time():return old['result']
 query=address if re.search(r'моск|город|область|химки|мытищи|красногорск|балашиха',address,re.I) else 'Москва, '+address
 result={'lat':0,'lon':0,'geo_error':'Адрес требует уточнения'}
 try:
  url='https://geocode-maps.yandex.ru/1.x/?'+urllib.parse.urlencode({'apikey':key,'format':'json','results':1,'lang':'ru_RU','ll':'37.6173,55.7558','spn':'1.2,0.8','geocode':query})
  with urllib.request.urlopen(url,timeout=12)as response:data=json.load(response)
  rows=data['response']['GeoObjectCollection']['featureMember']
  if rows:
   obj=rows[0]['GeoObject'];meta=obj.get('metaDataProperty',{}).get('GeocoderMetaData',{});lon,lat=map(float,obj['Point']['pos'].split())
   if meta.get('precision')in['exact','number','near']and meta.get('kind')=='house'and abs(lat)<=90 and abs(lon)<=180:result={'lat':lat,'lon':lon,'geo_error':''}
 except Exception:result={'lat':0,'lon':0,'geo_error':'Не удалось определить координаты'}
 cache[digest]={'expires':time.time()+(7*86400 if result['lat']else 3600),'result':result};return result

class Client:
 def __init__(self,token):self.token=token
 def get(self,path):
  assert path.startswith('/entity/'),path
  req=urllib.request.Request(BASE+path,headers={'Authorization':'Bearer '+self.token,'Accept-Encoding':'gzip'})
  with urllib.request.urlopen(req,timeout=35) as response:
   data=response.read();return json.loads(gzip.decompress(data) if response.headers.get('Content-Encoding')=='gzip' else data)
 def all(self,path,params=None):
  params=dict(params or {});rows=[];offset=0
  while True:
   x=self.get(path+'?'+urllib.parse.urlencode({**params,'limit':100,'offset':offset}));batch=x.get('rows',[]);rows+=batch
   if len(rows)>=x.get('meta',{}).get('size',len(rows))or not batch:return rows
   offset+=len(batch)
   if offset>20000:raise RuntimeError('Unexpectedly large collection')
def site_sync_id(record_id):
 h=__import__('hashlib').sha256(('venikoff:customerorder:'+record_id).encode()).hexdigest()
 return h[:8]+'-'+h[8:12]+'-5'+h[13:16]+'-8'+h[17:20]+'-'+h[20:32]
def owns_site_document(order,site,organization):
 ref=lambda key:(order.get(key)or{}).get('meta',{}).get('href','').rstrip('/').split('/')[-1]
 if ref('store')not in STORE_IDS or ref('organization')!=organization:return False
 if order.get('syncId')==site_sync_id(site['id']):return True
 return bool(re.search(r'Заказ №'+re.escape(str(site['number']))+r' с сайта venikoff\.net(?:\s|$)',order.get('description')or''))
def reconcile_site_orders(client,db,orders):
 sites={r['ms_id']:dict(r)for r in db.execute("select id,number,ms_id,date,status,delivery_type,interval from orders where ms_id!=''")}
 organization=db.execute('select ms_org_id from settings limit 1').fetchone()[0]
 by_id={o['id']:o for o in orders};projections=[];issues=[]
 for mid,site in sites.items():
  if mid not in by_id and str(site['date'])[:10]!=DAY:continue
  order=by_id.get(mid)
  if order is None:
   order=client.get('/entity/customerorder/'+mid+'?expand=state,salesChannel')
  if not owns_site_document(order,site,organization):
   issues.append({'site_id':site['id'],'number':site['number'],'ms_id':mid,'reason':'Связанный документ не подтверждён: другой склад, организация или заказ.'});continue
  cl=classify(order);details=delivery_details(order)
  projections.append({'site_id':site['id'],'number':site['number'],'ms_id':mid,'date':str(order.get('deliveryPlannedMoment')or'')[:10],
   'cancelled':not cl['counted']and cl['reason']=='Отменён','pickup':cl['pickup'],'paid':cl['paid'],'state':cl['state'],
   'interval':details['interval'],'local_date':site['date'],'local_delivery_type':site['delivery_type'],'local_interval':site['interval']})
 return projections,issues

def build(client,db):
 products=[dict(r) for r in db.execute('select id,name,ms_name,ms_pick,no_stock,lengths from products')];bindings={};names={};productmeta={}
 for p in products:
  productmeta[p['id']]={'id':p['id'],'name':p['name'],'no_stock':bool(p['no_stock'])}
  try:lengths=json.loads(p['lengths']or'null')
  except ValueError:lengths=None
  if lengths:names.setdefault(flower_key(p['name']),[]).append(p)
  try:mp=json.loads(p['ms_pick']or'{}')
  except ValueError:mp={}
  for label,b in mp.items():
   if not isinstance(b,dict)or not b.get('id'):continue
   bits=str(label).split('-');length=int(bits[0]) if bits[0].isdigit() else 0;count=int(bits[1]) if len(bits)>1 and bits[1].isdigit() and b.get('whole') else 1
   bindings.setdefault(b['id'],[]).append((p,length,count))
 channels=client.all('/entity/saleschannel');selected=[c for c in channels if norm(c['name'])in{norm(n) for n in SELECTED}];channelids={c['id'] for c in selected}
 orders_by_id={}
 for store_id in STORE_IDS:
  for order in client.all('/entity/customerorder',{'filter':'store='+BASE+'/entity/store/'+store_id+';deliveryPlannedMoment>='+DAY+' 00:00:00;deliveryPlannedMoment<2026-11-30 00:00:00','expand':'salesChannel,state,positions.assortment','order':'updated,asc'}):
   orders_by_id[order['id']]=order
 orders=list(orders_by_id.values())
 site_orders,site_issues=reconcile_site_orders(client,db,orders)
 siteids={r[0] for r in db.execute("select ms_id from orders where ms_id!=''")};docs=[];items=[];externalmeta={};issues=[];bundles={};duplicates=0
 cache=pathlib.Path(os.getenv('VENIKOFF_COMPONENTS_CACHE','/opt/venikoff/backups/mother-reserve-20261129/sales-components-cache.json'))
 try:stored=json.loads(cache.read_text())
 except (OSError,ValueError):stored={}
 geopath=cache.with_name('sales-geocoding-cache.json')
 try:geodata=json.loads(geopath.read_text())
 except (OSError,ValueError):geodata={}
 try:geokey=db.execute('select ymaps_key from settings limit 1').fetchone()[0]
 except (sqlite3.Error,TypeError):geokey=''
 def components(a):
  aid=a['id'];old=stored.get(aid)
  if old and time.time()-old['at']<3600:return old['rows']
  rows=client.all('/entity/bundle/'+aid+'/components',{'expand':'assortment'});stored[aid]={'at':time.time(),'rows':rows};return rows
 def add(a,qty,doc,stack=(),untracked_hint=False):
  if not qty or qty<0:raise RuntimeError('Invalid flower quantity')
  typ=(a.get('meta')or{}).get('type');aid=a.get('id');name=a.get('name','')
  if not aid or not name:raise RuntimeError('Assortment missing; cannot publish partial snapshot')
  if typ=='service':return
  candidates=bindings.get(aid,[]);unique={(p['id'],length,count):(p,length,count)for p,length,count in candidates}
  mapped=next(iter(unique.values())) if len(unique)==1 else None
  if typ=='bundle' and not(mapped and mapped[2]>1):
   if aid in stack or len(stack)>5:raise RuntimeError('Cyclic or excessive bundle nesting')
   for component in components(a):add(component['assortment'],qty*float(component['quantity']),doc,stack+(aid,),untracked_hint or bool(re.search('француз|гортензи|эквадор',name,re.I)))
   return
  if not mapped and not re.search(r'роз[аы]|\bроз\b|гортензи|альстромер|эустом|тюльпан|хризантем|пион',name,re.I):return
  lengthmatch=re.search(r'(?:^|\D)(40|50|60|70|80|90|100|110|120)(?:\s*см)?\s*$',name,re.I);length=int(lengthmatch[1])if lengthmatch else 0
  if not mapped:
   exact=names.get(flower_key(name),[])
   if len(exact)==1:mapped=(exact[0],length,1)
  untracked=untracked_hint or bool(re.search('француз|гортензи|эквадор',name,re.I))
  if mapped:
   p,L,mult=mapped;pid=p['id'];length=L or length;qty*=mult;display=p['name'];untracked=untracked or bool(p['no_stock'])
  else:pid='ms:'+aid;display=name
  if not mapped:
   externalmeta[pid]={'id':pid,'name':display,'no_stock':untracked};issues.append({'document':doc['id'],'number':doc['number'],'name':name,'quantity':qty,'length':length,'untracked':untracked})
  items.append({'document':doc['id'],'product_id':pid,'length':length,'quantity':qty,'name':display,'source_name':name,'channel':doc['channel'],'untracked':untracked})
 for order in orders:
  if (order.get('store')or{}).get('meta',{}).get('href','').rstrip('/').split('/')[-1]not in STORE_IDS:continue
  ch=order.get('salesChannel')or{}
  if order['id'] in siteids:duplicates+=1;continue
  if ch.get('id')not in channelids:continue
  if str(order.get('deliveryPlannedMoment',''))[:10]!=DAY:raise RuntimeError('Upstream returned incorrect planned day')
  cl=classify(order);doc={'store_id':(order.get('store')or{}).get('meta',{}).get('href','').split('/')[-1],'id':order['id'],'number':order['name'],'channel':ch.get('name',''),'channel_id':ch.get('id'),'date':order['deliveryPlannedMoment'],'total':float(order.get('sum',0))/100,**cl,**delivery_details(order)};docs.append(doc)
  if not cl['counted']:continue
  if not cl['pickup']:doc.update(geocode_cached(doc['address'],geokey,geodata))
  else:doc.update(lat=0,lon=0,geo_error='')
  positions=order.get('positions')or{};rows=positions.get('rows',[])
  if positions.get('meta',{}).get('size',0)>len(rows):rows=client.all('/entity/customerorder/'+order['id']+'/positions',{'expand':'assortment'})
  for pos in rows:add(pos['assortment'],float(pos['quantity']),doc)
 gtemp=geopath.with_suffix('.tmp');gtemp.write_text(json.dumps(geodata,ensure_ascii=False));gtemp.chmod(0o600);gtemp.replace(geopath)
 temp=cache.with_suffix('.tmp');temp.write_text(json.dumps(stored,ensure_ascii=False));temp.chmod(0o600);temp.replace(cache)
 return {'day':DAY,'site_orders':site_orders,'site_issues':site_issues,'store':{'id':STORE_ID,'name':'Москва 01 + Москва 02'},'stores':[{'id':sid,'name':STORE_NAMES[sid]}for sid in STORE_IDS],'documents':docs,'items':items,'products':list(externalmeta.values()),'unmatched':issues,'channels':[{'id':c['id'],'name':c['name']}for c in selected],'excluded_site':duplicates,'updated_at':datetime.datetime.now(datetime.timezone.utc).isoformat()}
def main():
 lock=open('/opt/venikoff/backups/mother-reserve-20261129/sales-sync.lock','a');fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
 db=sqlite3.connect('/opt/venikoff/pb/pb_data/data.db',timeout=30);db.row_factory=sqlite3.Row
 token=db.execute('select ms_token from settings limit 1').fetchone()[0]
 now=datetime.datetime.now(datetime.timezone.utc).isoformat()
 try:
  payload=build(Client(token),db)
  with db:
   db.execute("INSERT INTO occasion_sales_snapshots(day,payload,updated,last_error,attempted) VALUES(?,?,?,'',?) ON CONFLICT(day) DO UPDATE SET payload=excluded.payload,updated=excluded.updated,last_error='',attempted=excluded.attempted",(DAY,json.dumps(payload,ensure_ascii=False),now,now))
  print(json.dumps({'documents':len(payload['documents']),'counted':sum(d['counted']for d in payload['documents']),'items':len(payload['items']),'unmatched':len(payload['unmatched']),'excluded_site':payload['excluded_site']},ensure_ascii=False))
 except Exception as e:
  with db:db.execute('UPDATE occasion_sales_snapshots SET last_error=?,attempted=? WHERE day=?',('Не удалось получить полный состав заказов МоегоСклада. Сохранён последний успешный расчёт.',now,DAY))
  print('Sales snapshot NOT replaced:',type(e).__name__,str(e)[:200],file=sys.stderr);raise
if __name__=='__main__':main()


