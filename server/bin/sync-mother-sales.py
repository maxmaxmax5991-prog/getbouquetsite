#!/usr/bin/env python3
"""Read-only MoySklad -> atomic dated sales snapshot. Never alters ordinary inventory."""
import sqlite3,json,urllib.request,urllib.parse,gzip,re,pathlib,datetime,time,os,sys,fcntl
DAY='2026-11-29';BASE='https://api.moysklad.ru/api/remap/1.2'
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
 orders=client.all('/entity/customerorder',{'filter':'deliveryPlannedMoment>='+DAY+' 00:00:00;deliveryPlannedMoment<2026-11-30 00:00:00','expand':'salesChannel,state,positions.assortment','order':'updated,asc'})
 siteids={r[0] for r in db.execute("select ms_id from orders where ms_id!=''")};docs=[];items=[];externalmeta={};issues=[];bundles={};duplicates=0
 cache=pathlib.Path(os.getenv('VENIKOFF_COMPONENTS_CACHE','/opt/venikoff/backups/mother-reserve-20261129/sales-components-cache.json'))
 try:stored=json.loads(cache.read_text())
 except (OSError,ValueError):stored={}
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
  ch=order.get('salesChannel')or{}
  if order['id'] in siteids:duplicates+=1;continue
  if ch.get('id')not in channelids:continue
  if str(order.get('deliveryPlannedMoment',''))[:10]!=DAY:raise RuntimeError('Upstream returned incorrect planned day')
  cl=classify(order);doc={'id':order['id'],'number':order['name'],'channel':ch.get('name',''),'channel_id':ch.get('id'),'date':order['deliveryPlannedMoment'],**cl};docs.append(doc)
  if not cl['counted']:continue
  positions=order.get('positions')or{};rows=positions.get('rows',[])
  if positions.get('meta',{}).get('size',0)>len(rows):rows=client.all('/entity/customerorder/'+order['id']+'/positions',{'expand':'assortment'})
  for pos in rows:add(pos['assortment'],float(pos['quantity']),doc)
 temp=cache.with_suffix('.tmp');temp.write_text(json.dumps(stored,ensure_ascii=False));temp.chmod(0o600);temp.replace(cache)
 return {'day':DAY,'documents':docs,'items':items,'products':list(externalmeta.values()),'unmatched':issues,'channels':[{'id':c['id'],'name':c['name']}for c in selected],'excluded_site':duplicates,'updated_at':datetime.datetime.now(datetime.timezone.utc).isoformat()}
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
