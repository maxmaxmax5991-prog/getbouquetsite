// Checkout retries return the original order. The request key is an unguessable client secret.
function token(e) {
  const h=e.requestInfo().headers || {};
  return String(h.idempotency_key || h['idempotency-key'] || '');
}
function begin(app,e,brand) {
  const raw=token(e);
  if (!raw) return {key:''}; // Compatibility for already-open old clients.
  if (!/^[a-zA-Z0-9_-]{24,100}$/.test(raw)) throw new BadRequestError('Обновите страницу и повторите оформление.');
  const key=$security.sha256(String(brand || '')+':'+raw);
  const hash=$security.sha256(JSON.stringify(e.requestInfo().body || {}));
  let rows=arrayOf(new DynamicModel({body_hash:'',order_id:''}));
  app.db().newQuery('SELECT body_hash,order_id FROM checkout_requests WHERE request_key={:k}').bind({k:key}).all(rows);
  if (rows.length) {
    if (rows[0].body_hash!==hash) throw new BadRequestError('Состав заказа изменился. Повторите оформление.');
    if (!rows[0].order_id) throw new ApiError(409,'Заказ уже оформляется. Повторите через несколько секунд.');
    const o=app.findRecordById('orders',rows[0].order_id);
    return {key,replay:{id:o.id,number:o.get('number'),total:o.get('total'),tg_code:o.get('tg_code'),payment_method:o.get('payment_method'),payment_status:o.get('payment_status'),invoice:o.get('invoice')}};
  }
  app.db().newQuery('INSERT INTO checkout_requests (request_key,body_hash,order_id,created) VALUES ({:k},{:h},\'\',{:t})').bind({k:key,h:hash,t:new Date().toISOString()}).execute();
  return {key};
}
function finish(app,key,id) {
  if(key) app.db().newQuery('UPDATE checkout_requests SET order_id={:id} WHERE request_key={:k}').bind({id,k:key}).execute();
}
module.exports={begin,finish};
