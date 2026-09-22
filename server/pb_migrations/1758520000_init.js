/// <reference path="../pb_data/types.d.ts" />
// Схема магазина venikoff.net: разделы, товары, доставка, заказы, настройки, менеджеры.
migrate((app) => {
  const MANAGER = '@request.auth.collectionName = "managers"';

  const managers = new Collection({
    type: "auth",
    name: "managers",
    listRule: MANAGER, viewRule: MANAGER, createRule: null, updateRule: "id = @request.auth.id", deleteRule: null,
    fields: [{ name: "name", type: "text" }],
    passwordAuth: { enabled: true, identityFields: ["email"] },
  });
  app.save(managers);

  const categories = new Collection({
    type: "base",
    name: "categories",
    listRule: "", viewRule: "", createRule: MANAGER, updateRule: MANAGER, deleteRule: MANAGER,
    fields: [
      { name: "name", type: "text", required: true },
      { name: "slug", type: "text", required: true, pattern: "^[a-z0-9-]+$" },
      { name: "sort", type: "number" },
      { name: "addon", type: "bool" },   // открытки, игрушки — «Добавить к букету»
      { name: "active", type: "bool" },
    ],
    indexes: ["CREATE UNIQUE INDEX idx_categories_slug ON categories (slug)"],
  });
  app.save(categories);

  const products = new Collection({
    type: "base",
    name: "products",
    listRule: `active = true || ${MANAGER}`, viewRule: `active = true || ${MANAGER}`,
    createRule: MANAGER, updateRule: MANAGER, deleteRule: MANAGER,
    fields: [
      { name: "name", type: "text", required: true },
      { name: "category", type: "relation", collectionId: categories.id, maxSelect: 1, required: true },
      { name: "price", type: "number", required: true, min: 0 },
      { name: "bonus", type: "number", min: 0 },
      { name: "photo", type: "file", maxSelect: 5, maxSize: 15 * 1024 * 1024, mimeTypes: ["image/jpeg", "image/png", "image/webp"], thumbs: ["560x0", "160x160"] },
      { name: "cutout", type: "file", maxSelect: 1, maxSize: 15 * 1024 * 1024, mimeTypes: ["image/png", "image/webp"] },
      { name: "variants", type: "json" },    // [{label:"25", price:2189, estimated:false, photo:"file.jpg"}] — кнопки размеров
      { name: "badge", type: "select", maxSelect: 1, values: ["sale", "author", "hit", "new"] },
      { name: "description", type: "text", max: 2000 },
      { name: "active", type: "bool" },
      { name: "popular", type: "bool" },
      { name: "featured", type: "bool" },   // в карусели на главной
      { name: "mood", type: "text" },       // подпись в карусели
      { name: "tint", type: "text" },
      { name: "sort", type: "number" },
      { name: "legacy_id", type: "text" },
      { name: "created", type: "autodate", onCreate: true },
      { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
    ],
  });
  app.save(products);

  const zones = new Collection({
    type: "base",
    name: "delivery_zones",
    listRule: "", viewRule: "", createRule: MANAGER, updateRule: MANAGER, deleteRule: MANAGER,
    fields: [
      { name: "name", type: "text", required: true },
      { name: "price", type: "number", min: 0 },
      { name: "free_from", type: "number", min: 0 },   // бесплатно от суммы, 0 — никогда
      { name: "sort", type: "number" },
      { name: "active", type: "bool" },
    ],
  });
  app.save(zones);

  const intervals = new Collection({
    type: "base",
    name: "delivery_intervals",
    listRule: "", viewRule: "", createRule: MANAGER, updateRule: MANAGER, deleteRule: MANAGER,
    fields: [
      { name: "start", type: "text", required: true, pattern: "^\\d{2}:\\d{2}$" },
      { name: "end", type: "text", required: true, pattern: "^\\d{2}:\\d{2}$" },
      { name: "extra", type: "number", min: 0 },   // доплата за интервал (например, ночной)
      { name: "sort", type: "number" },
      { name: "active", type: "bool" },
    ],
  });
  app.save(intervals);

  const settings = new Collection({
    type: "base",
    name: "settings",
    listRule: MANAGER, viewRule: MANAGER, createRule: null, updateRule: MANAGER, deleteRule: null,
    fields: [
      { name: "phone", type: "text" },
      { name: "site_url", type: "text" },
      { name: "min_order", type: "number", min: 0 },
      { name: "lead_hours", type: "number", min: 0 },     // за сколько часов до начала интервала принимаем заказ
      { name: "days_ahead", type: "number", min: 1 },     // на сколько дней вперёд можно выбрать дату
      { name: "closed_dates", type: "json" },             // ["2026-12-31", ...]
      { name: "accepting", type: "bool" },                // приём заказов включён
      { name: "notice", type: "text" },                   // объявление на сайте
      { name: "tg_token", type: "text" },
      { name: "tg_admins", type: "text" },                // ID в Телеграме через запятую
      { name: "tg_secret", type: "text" },
      { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
    ],
  });
  app.save(settings);

  const orders = new Collection({
    type: "base",
    name: "orders",
    listRule: MANAGER, viewRule: MANAGER, createRule: "", updateRule: MANAGER, deleteRule: MANAGER,
    fields: [
      { name: "number", type: "number" },
      { name: "status", type: "select", maxSelect: 1, values: ["new", "confirmed", "assembling", "photo", "delivering", "done", "cancelled"] },
      { name: "items", type: "json" },
      { name: "items_sum", type: "number" },
      { name: "delivery_price", type: "number" },
      { name: "total", type: "number" },
      { name: "bonus", type: "number" },
      { name: "name", type: "text", required: true, max: 120 },
      { name: "phone", type: "text", required: true, max: 40 },
      { name: "recipient", type: "text", max: 200 },
      { name: "address", type: "text", required: true, max: 400 },
      { name: "zone", type: "relation", collectionId: zones.id, maxSelect: 1 },
      { name: "date", type: "text", required: true, pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
      { name: "interval", type: "text", max: 40 },
      { name: "note", type: "text", max: 1000 },
      { name: "comment", type: "text", max: 2000 },       // внутренний комментарий менеджера
      { name: "created", type: "autodate", onCreate: true },
      { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
    ],
  });
  app.save(orders);

  // Начальные данные
  const s = new Record(settings);
  s.set("phone", "");
  s.set("min_order", 0);
  s.set("lead_hours", 2);
  s.set("days_ahead", 14);
  s.set("closed_dates", []);
  s.set("accepting", true);
  s.set("tg_secret", $security.randomString(32));
  app.save(s);

  [["В пределах МКАД", 0, 0], ["До 5 км за МКАД", 500, 0], ["5–15 км за МКАД", 900, 0]].forEach(([name, price, free], i) => {
    const r = new Record(zones);
    r.set("name", name); r.set("price", price); r.set("free_from", free); r.set("sort", i); r.set("active", true);
    app.save(r);
  });
  [["09:00", "12:00"], ["12:00", "15:00"], ["15:00", "18:00"], ["18:00", "21:00"]].forEach(([a, b], i) => {
    const r = new Record(intervals);
    r.set("start", a); r.set("end", b); r.set("extra", 0); r.set("sort", i); r.set("active", true);
    app.save(r);
  });
  [["roses", "Розы"], ["mono", "Монобукеты"], ["boxes", "Коробочки и композиции"], ["baskets", "Корзины"],
   ["stems", "Поштучно"], ["cards", "Открытки", true], ["toys", "Игрушки", true]].forEach(([slug, name, addon], i) => {
    const r = new Record(categories);
    r.set("slug", slug); r.set("name", name); r.set("sort", i); r.set("addon", !!addon); r.set("active", true);
    app.save(r);
  });

  // Ежедневная резервная копия в 04:00, храним 14 штук
  const st = app.settings();
  st.backups.cron = "0 4 * * *";
  st.backups.cronMaxKeep = 14;
  st.meta.appName = "venikoff.net";
  app.save(st);
}, (app) => {
  ["orders", "settings", "delivery_intervals", "delivery_zones", "products", "categories", "managers"].forEach((n) => {
    try { app.delete(app.findCollectionByNameOrId(n)); } catch (_) {}
  });
});
