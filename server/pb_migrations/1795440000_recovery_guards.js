migrate((app)=>{
  app.db().newQuery("CREATE TABLE IF NOT EXISTS checkout_requests (request_key TEXT PRIMARY KEY,body_hash TEXT NOT NULL,order_id TEXT NOT NULL,created TEXT NOT NULL)").execute();
  app.db().newQuery("CREATE TABLE IF NOT EXISTS recovery_operations (operation_key TEXT PRIMARY KEY,kind TEXT NOT NULL,state TEXT NOT NULL,detail TEXT NOT NULL DEFAULT '',created TEXT NOT NULL)").execute();
  app.db().newQuery("CREATE TABLE IF NOT EXISTS payment_callback_inbox (invoice TEXT PRIMARY KEY,received_at TEXT NOT NULL,attempts INTEGER NOT NULL DEFAULT 1,processed_at TEXT NOT NULL DEFAULT '')").execute();
  app.db().newQuery("CREATE TABLE IF NOT EXISTS receipt_jobs (order_id TEXT PRIMARY KEY,state TEXT NOT NULL DEFAULT 'pending',created TEXT NOT NULL,detail TEXT NOT NULL DEFAULT '')").execute();
},(app)=>{
  app.db().newQuery("DROP TABLE IF EXISTS receipt_jobs").execute();
  app.db().newQuery("DROP TABLE IF EXISTS payment_callback_inbox").execute();
  app.db().newQuery("DROP TABLE IF EXISTS checkout_requests").execute();
  app.db().newQuery("DROP TABLE IF EXISTS recovery_operations").execute();
});
