migrate(app=>{
 app.db().newQuery("CREATE TABLE IF NOT EXISTS occasion_sales_snapshots (day TEXT PRIMARY KEY, payload TEXT NOT NULL, updated TEXT NOT NULL, last_error TEXT NOT NULL DEFAULT '', attempted TEXT NOT NULL DEFAULT '')").execute();
},app=>{app.db().newQuery('DROP TABLE IF EXISTS occasion_sales_snapshots').execute();});
