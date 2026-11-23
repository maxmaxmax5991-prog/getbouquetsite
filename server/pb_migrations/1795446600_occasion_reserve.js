migrate((app)=>{
 app.db().newQuery("CREATE TABLE IF NOT EXISTS occasion_reserve_movements (id TEXT PRIMARY KEY, day TEXT NOT NULL, product_id TEXT NOT NULL, length INTEGER NOT NULL CHECK(length>0), quantity INTEGER NOT NULL CHECK(quantity>0), source TEXT NOT NULL, source_name TEXT NOT NULL DEFAULT '', source_row INTEGER NOT NULL DEFAULT 0, created TEXT NOT NULL, actor TEXT NOT NULL DEFAULT '', unit_cost_kop INTEGER CHECK(unit_cost_kop IS NULL OR unit_cost_kop>=0), cost_kop INTEGER CHECK(cost_kop IS NULL OR cost_kop>=0))").execute();
 app.db().newQuery("CREATE UNIQUE INDEX IF NOT EXISTS occasion_reserve_source_row ON occasion_reserve_movements(day,source,source_row) WHERE source_row>0").execute();
 app.db().newQuery("CREATE INDEX IF NOT EXISTS occasion_reserve_position ON occasion_reserve_movements(day,product_id,length)").execute();
},(app)=>{app.db().newQuery('DROP TABLE IF EXISTS occasion_reserve_movements').execute();});
