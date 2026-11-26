import runpy,sqlite3,tempfile,pathlib,os,sys
x=runpy.run_path(sys.argv[1] if len(sys.argv)>1 else str(pathlib.Path(__file__).resolve().parents[1]/'bin/sync-mother-sales.py'));A=x['STORE_ID'];B=x['STORE_IDS'][1];BASE=x['BASE']
db=sqlite3.connect(':memory:');db.row_factory=sqlite3.Row;db.executescript('create table products(id,name,ms_name,ms_pick,no_stock,lengths);create table orders(id,number,ms_id,date,status,delivery_type,interval);create table settings(ms_org_id,ymaps_key);insert into settings values("org","");')
db.execute('insert into products values(?,?,?,?,?,?)',('rose','Мисти Баблз','','{}',0,'[40,50]'))
def order(mid,store):return {'id':mid,'name':mid,'store':{'meta':{'href':BASE+'/entity/store/'+store}},'deliveryPlannedMoment':'2026-11-29 09:00:00','salesChannel':{'id':'telegram','name':'Телеграм Venikoff'},'state':{'name':'Принят, Оплачен'},'attributes':[{'name':'Способ доставки','value':{'name':'Доставка'}}],'sum':100,'payedSum':100,'positions':{'rows':[{'quantity':51,'assortment':{'id':'rose-ms','name':'ЛФ-Роза куст Мисти Баблз 50см','meta':{'type':'product'}}}]}}
class Client:
 moved=False
 def all(self,path,params=None):
  if path=='/entity/saleschannel':return [{'id':'telegram','name':'Телеграм Venikoff'}]
  if path=='/entity/customerorder':
   rows=[order('first',B if self.moved else A),order('second',B)];return [o for o in rows if o['store']['meta']['href']in params['filter']]
  raise AssertionError(path)
with tempfile.TemporaryDirectory()as tmp:
 os.environ['VENIKOFF_COMPONENTS_CACHE']=str(pathlib.Path(tmp)/'components.json');c=Client();before=x['build'](c,db);c.moved=True;after=x['build'](c,db)
 assert len(before['documents'])==len(after['documents'])==2
 assert sum(i['quantity']for i in before['items'])==sum(i['quantity']for i in after['items'])==102
 assert {d['store_id']for d in after['documents']}=={B}
site={'id':'website','number':100};o=order('site',B);o['organization']={'meta':{'href':BASE+'/entity/organization/org'}};o['syncId']=x['site_sync_id']('website')
assert x['owns_site_document'](o,site,'org')
print('PASS: both Moscow stores counted once, moved delivery retains all booked stems, verified website link remains valid on Moscow 02')


o['organization']={'meta':{'href':BASE+'/entity/organization/047ab4e2-e4b8-11f1-0a80-1f37000a92f0'}}
assert x['owns_site_document'](o,site,'org')
print('PASS: verified website document retained after fulfillment organization changes to Moscow 02')
