#!/usr/bin/env python3
"""One shared Moscow forecast, cached >=3h; no visitor location or credentials."""
import datetime,gzip,json,os,pathlib,random,time,urllib.request,urllib.error
CACHE=pathlib.Path(os.getenv('VENIKOFF_WEATHER_CACHE','/opt/venikoff/backups/weather'));PUBLIC=pathlib.Path(os.getenv('VENIKOFF_WEATHER_PUBLIC','/opt/venikoff/site/weather-moscow.json'))
URL='https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=55.7558&lon=37.6173'
def atomic(path,obj):
 path.parent.mkdir(parents=True,exist_ok=True);temp=path.with_suffix('.tmp');temp.write_text(json.dumps(obj,ensure_ascii=False));temp.chmod(0o644);temp.replace(path)
def current(data,now):
 rows=(data or {}).get('properties',{}).get('timeseries',[])
 for row in rows:
  at=datetime.datetime.fromisoformat(row['time'].replace('Z','+00:00')).timestamp()
  if at<=now<at+3600:
   code=row.get('data',{}).get('next_1_hours',{}).get('summary',{}).get('symbol_code','')
   return {'snow':bool(code and ('snow' in code or 'sleet' in code)),'symbol':code,'forecast_time':row['time']}
 return {'snow':False,'symbol':'','forecast_time':None}
def main():
 now=time.time();CACHE.mkdir(parents=True,exist_ok=True);statepath=CACHE/'state.json'
 try:state=json.loads(statepath.read_text())
 except (OSError,ValueError):state={}
 if now>=state.get('next_fetch',0):
  headers={'User-Agent':'venikoff.net-weather/1.0 https://venikoff.net/','Accept-Encoding':'gzip'}
  if state.get('last_modified'):headers['If-Modified-Since']=state['last_modified']
  state['next_fetch']=now+3*3600+random.randint(60,240)
  try:
   with urllib.request.urlopen(urllib.request.Request(URL,headers=headers),timeout=12) as response:
    payload=response.read();payload=gzip.decompress(payload) if response.headers.get('Content-Encoding')=='gzip' else payload
    data=json.loads(payload);assert data.get('properties',{}).get('timeseries')
    state.update(data=data,fetched_at=now,last_modified=response.headers.get('Last-Modified',''))
    expires=response.headers.get('Expires')
    if expires:
     import email.utils
     state['next_fetch']=max(state['next_fetch'],email.utils.parsedate_to_datetime(expires).timestamp())
  except urllib.error.HTTPError as e:
   if e.code==304:state['fetched_at']=now
   else:print('Weather upstream HTTP',e.code)
  except Exception as e:print('Weather upstream unavailable:',type(e).__name__)
  atomic(statepath,state)
 fresh=now-state.get('fetched_at',0)<8*3600
 result=current(state.get('data'),now) if fresh else {'snow':False,'symbol':'','forecast_time':None}
 result.update(updated_at=int(now),valid_until=int(now+20*60),source='MET Norway',kind='current-hour forecast',city='Москва')
 atomic(PUBLIC,result);print(json.dumps({'snow':result['snow'],'symbol':result['symbol'],'fresh':fresh}))
if __name__=='__main__':main()
