import runpy,sqlite3,tempfile,pathlib,os,json,sys
worker=sys.argv[1] if len(sys.argv)>1 else str(pathlib.Path(__file__).with_name('sync-mother-sales.py'))
x=runpy.run_path(worker)
def order(id,**kw):
 return {'id':id,'name':id,'store':{'meta':{'href':x['BASE']+'/entity/store/'+x['STORE_ID']}},'deliveryPlannedMoment':'2026-11-29 09:00:00','salesChannel':{'id':'telegram','name':'Телеграм Venikoff'},'state':{'name':'Принят, Оплачен'},'attributes':[{'name':'Способ доставки','value':{'name':'Доставка'}}],'sum':100,'payedSum':0,'positions':{'meta':{'size':1},'rows':[{'quantity':51,'assortment':{'id':'rose-ms','name':'ЛФ-Роза куст Мисти Баблз 50см','meta':{'type':'product'}}}]},**kw}
assert x['flower_key']('ЛФ-Роза куст Мисти Баблз 50см')==x['flower_key']('Мисти Баблз')
assert x['classify'](order('paid'))['counted'];assert not x['classify'](order('unpaid',state={'name':'Принят, Не оплачен'}))['counted']
pick=order('pickup',state={'name':'Принят, Не оплачен'},attributes=[{'name':'Способ доставки','value':{'name':'Самовывоз'}}]);assert x['classify'](pick)['counted']
assert not x['classify']({**pick,'state':{'name':'Отменён'}})['counted']
class Fake:
 def all(self,path,params=None):
  if path=='/entity/saleschannel':return [{'id':'telegram','name':'Телеграм  Venikoff'},{'id':'site','name':'Сайт веников'}]
  if path=='/entity/customerorder':return [order('site'),order('paid'),pick,order('unpaid',state={'name':'Принят, Не оплачен'}),order('wrongstore',store={'meta':{'href':x['BASE']+'/entity/store/other'} }),order('excludedchannel',salesChannel={'id':'site','name':'Сайт веников'}),order('french',positions={'rows':[{'quantity':2,'assortment':{'id':'bundle','name':'13 французских роз','meta':{'type':'bundle'}}}]})]
  if path=='/entity/bundle/bundle/components':return [{'quantity':13,'assortment':{'id':'french-rose','name':'ЛФ-Роза Мондиаль 60см','meta':{'type':'product'}}},{'quantity':1,'assortment':{'id':'wrap','name':'Упаковка','meta':{'type':'product'}}}]
  raise AssertionError(path)
db=sqlite3.connect(':memory:');db.row_factory=sqlite3.Row;db.executescript('create table products(id,name,ms_name,ms_pick,no_stock,lengths);create table orders(id,number,ms_id,date,status,delivery_type,interval);create table settings(ms_org_id);insert into settings values("org");');db.execute('insert into products values(?,?,?,?,?,?)',('rose','Мисти Баблз','','{}',0,'[40,50]'));db.execute('insert into orders values(?,?,?,?,?,?,?)',('site',1,'site','2026-11-29','confirmed','pickup','10:00'))
with tempfile.TemporaryDirectory()as tmp:
 os.environ['VENIKOFF_COMPONENTS_CACHE']=str(pathlib.Path(tmp)/'components.json')
 a=x['build'](Fake(),db);b=x['build'](Fake(),db)
 assert a['items']==b['items'];assert len(a['documents'])==4;assert sum(d['counted']for d in a['documents'])==3;assert a['excluded_site']==1
 roses=[p for p in a['items']if p['product_id']=='rose'];assert sum(p['quantity']for p in roses)==102
 french=[p for p in a['items']if p['product_id']=='ms:french-rose'];assert french[0]['quantity']==26 and french[0]['untracked'];assert len(a['items'])==3
print('PASS: channel filtering, paid deliveries, all pickups, cancellation, site dedupe, stable snapshots, stem mapping and recursive bundle quantities')

# Regression: only verified website documents affect the shared report.
import types
m=types.SimpleNamespace(**x)
db=sqlite3.connect(':memory:');db.row_factory=sqlite3.Row;db.executescript('create table orders(id,number,ms_id,date,status,delivery_type,interval);create table settings(ms_org_id);insert into settings values("org");')
def doc(mid,number,**changes):
 return dict({'id':mid,'name':str(number),'store':{'meta':{'href':m.BASE+'/entity/store/'+m.STORE_ID}},'organization':{'meta':{'href':m.BASE+'/entity/organization/org'}},'description':f'Заказ №{number} с сайта venikoff.net\n','deliveryPlannedMoment':'2026-11-29 10:00:00','state':{'name':'Принят, Не оплачен'},'attributes':[{'name':'Способ доставки','value':{'name':'Самовывоз'}}]},**changes)
for n in range(1,5):db.execute('insert into orders values(?,?,?,?,?,?,?)',(str(n),n,'ms'+str(n),'2026-11-29','confirmed','pickup','10:00'))
docs=[doc('ms1',1,state={'name':'Отменен'}),doc('ms2',2,store={'meta':{'href':m.BASE+'/entity/store/other'}}),doc('ms3',3,description='Другой заказ')]
class Client:
 def get(self,path):assert path.startswith('/entity/customerorder/ms4?');return doc('ms4',4,deliveryPlannedMoment='2026-11-28 12:00:00')
rows,issues=m.reconcile_site_orders(Client(),db,docs)
assert len(rows)==2 and len(issues)==2
assert rows[0]['cancelled'] and rows[1]['date']=='2026-11-28'
assert m.owns_site_document(doc('ms3',3,description='',syncId=m.site_sync_id('3')),{'id':'3','number':3},'org')
assert not m.owns_site_document(doc('ms3',3,description='Заказ №33 с сайта venikoff.net'),{'id':'3','number':3},'org')
print('PASS: verified site identity, foreign store and numeric collision rejected, cancellation, missing-from-day moved order fetched read-only')
