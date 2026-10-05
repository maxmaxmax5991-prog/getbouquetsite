/// <reference path="../pb_data/types.d.ts" />
// Юридические сведения: продавец, политика обработки персональных данных,
// согласие на рассылку.
//
// Зачем. На сайте не было ничего из обязательного: ни политики (152-ФЗ требует
// публиковать её в свободном доступе), ни сведений о продавце (правила
// дистанционной продажи — наименование, ИНН, ОГРН, адрес), ни отдельного
// согласия на рекламную рассылку, хотя рассылки уже идут.
//
// Продавец один на обе витрины (решение владельца 05.10.2026), поэтому
// реквизиты лежат в общих настройках, а не у витрины.
migrate((app) => {
  const c = app.findCollectionByNameOrId("settings");
  const добавить = (f) => { if (!c.fields.getByName(f.name)) c.fields.add(new Field(f)); };
  добавить({ name: "org_name", type: "text", max: 300 });        // полное наименование
  добавить({ name: "org_short", type: "text", max: 120 });       // краткое, для подвала
  добавить({ name: "org_inn", type: "text", max: 20 });
  добавить({ name: "org_kpp", type: "text", max: 20 });
  добавить({ name: "org_ogrn", type: "text", max: 20 });
  добавить({ name: "org_addr_legal", type: "text", max: 300 });  // юридический адрес
  добавить({ name: "org_addr_fact", type: "text", max: 300 });   // фактический
  добавить({ name: "org_email", type: "text", max: 120 });       // для обращений по ПДн
  добавить({ name: "pd_person", type: "text", max: 200 });       // ответственный за обработку
  добавить({ name: "policy_date", type: "text", max: 20 });      // дата редакции политики
  добавить({ name: "policy_extra", type: "text", max: 20000 });  // правки юриста поверх шаблона
  app.save(c);

  // Заполняем тем, что владелец прислал. Запросом, мимо хуков: сохранение
  // записи настроек тянет за собой перенастройку ботов.
  try {
    app.db().newQuery(`UPDATE settings SET
      org_name = {:name}, org_short = {:short}, org_inn = {:inn}, org_kpp = {:kpp},
      org_addr_legal = {:legal}, org_addr_fact = {:fact}, policy_date = {:date}
      WHERE org_inn IS NULL OR org_inn = ''`)
      .bind({
        name: 'Общество с ограниченной ответственностью «УК ГЕТ БУКЕТ»',
        short: 'ООО «УК ГЕТ БУКЕТ»',
        inn: "3123484572",
        kpp: "312301001",
        legal: "308000, Белгородская область, г. Белгород, ул. 5 Августа, д. 31Б/1, офис 2",
        fact: "Москва, Маленковская улица, 14к1",
        date: "2026-10-05",
      }).execute();
  } catch (err) { console.log("реквизиты", err); }
}, (app) => {
  const c = app.findCollectionByNameOrId("settings");
  ["org_name", "org_short", "org_inn", "org_kpp", "org_ogrn", "org_addr_legal",
   "org_addr_fact", "org_email", "pd_person", "policy_date", "policy_extra"]
    .forEach((n) => c.fields.removeByName(n));
  app.save(c);
});
