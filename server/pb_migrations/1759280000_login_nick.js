/// <reference path="../pb_data/types.d.ts" />
// Вход сотрудника по нику, а не по почте: флористу заводить почту незачем.
// Почта остаётся необязательной — пригодится владельцу для восстановления.
migrate((app) => {
  const c = app.findCollectionByNameOrId("managers");
  if (!c.fields.getByName("nick")) {
    c.fields.add(new Field({ name: "nick", type: "text", max: 40, pattern: "^[a-zA-Z0-9_.-]{3,40}$" }));
  }
  const em = c.fields.getByName("email");
  if (em) em.required = false;
  c.passwordAuth = { enabled: true, identityFields: ["nick", "email"] };
  c.indexes = (c.indexes || []).filter((i) => String(i).indexOf("idx_managers_nick") < 0)
    .concat(["CREATE UNIQUE INDEX idx_managers_nick ON managers (nick) WHERE nick != ''"]);
  app.save(c);

  // у кого уже есть вход — ник из почты, чтобы не потерять доступ
  app.findRecordsByFilter("managers", "id != ''", "", 100, 0).forEach((m) => {
    if (m.get("nick")) return;
    const base = String(m.get("email") || "").split("@")[0].replace(/[^a-zA-Z0-9_.-]/g, "").slice(0, 40) || ("user" + m.id.slice(0, 6));
    m.set("nick", base);
    app.save(m);
  });
}, (app) => {
  const c = app.findCollectionByNameOrId("managers");
  c.passwordAuth = { enabled: true, identityFields: ["email"] };
  c.indexes = (c.indexes || []).filter((i) => String(i).indexOf("idx_managers_nick") < 0);
  c.fields.removeByName("nick");
  app.save(c);
});
