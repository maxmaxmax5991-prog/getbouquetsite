/// <reference path="../pb_data/types.d.ts" />
// Только диагностические числа остатка Мисти; без персональных данных.
onRecordUpdateRequest((e) => {
  if (e.record.id === "oghyzgr5n0kdnc1") {
    try {
      const body = e.requestInfo().body || {};
      if (body.stock !== undefined) console.log("misti-stock-audit " + JSON.stringify({
        event: "api-stock-write", old: e.record.original().get("stock"), next: e.record.get("stock"),
        at: new Date().toISOString() }));
    } catch (err) { console.log("misti-stock-audit request audit error"); }
  }
  e.next();
}, "products");
onRecordAfterUpdateSuccess((e) => {
  if (e.record.id === "oghyzgr5n0kdnc1") {
    try {
      const old = e.record.original().getString("stock"), next = e.record.getString("stock");
      if (old !== next) console.log("misti-stock-audit " + JSON.stringify({
        event: "record-stock-write", old, next, at: new Date().toISOString() }));
    } catch (err) { console.log("misti-stock-audit record audit error"); }
  }
  e.next();
}, "products");
