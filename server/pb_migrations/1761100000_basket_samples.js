/// <reference path="../pb_data/types.d.ts" />
// Примеры собранных корзин: фотография + сколько роз + какой сорт.
//
// Зачем. Конструктор показывает числа, а человек покупает глазами: «251 роза»
// ему ничего не говорит, а снимок такой корзины — говорит всё. Владелец
// загружает фотографии своих работ, подписывает количеством и сортом, и
// покупатель может ткнуть в пример — конструктор выставится на него.
//
// Отдельная таблица, а не поле у корзины: примеров на одну корзину бывает
// несколько, и у каждого свой сорт и своё количество.
const OWNER = '@request.auth.collectionName = "managers" && @request.auth.role = "owner"';
migrate((app) => {
  try { app.findCollectionByNameOrId("basket_samples"); } catch (_) {
    app.save(new Collection({
      type: "base",
      name: "basket_samples",
      listRule: "", viewRule: "",                 // витрина показывает их всем
      createRule: OWNER, updateRule: OWNER, deleteRule: OWNER,
      fields: [
        { name: "photo", type: "file", maxSelect: 1, maxSize: 15 * 1024 * 1024,
          mimeTypes: ["image/jpeg", "image/png", "image/webp"], thumbs: ["560x0", "1120x0", "160x160"] },
        { name: "qty", type: "number", min: 1 },        // сколько стеблей на снимке
        { name: "product", type: "text", max: 40 },     // какой сорт
        { name: "name", type: "text", max: 120 },       // подпись, если нужна своя
        { name: "sort", type: "number" },
        { name: "active", type: "bool" },
        { name: "created", type: "autodate", onCreate: true },
        { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
      ],
    }));
  }
}, (app) => {
  try { app.delete(app.findCollectionByNameOrId("basket_samples")); } catch (_) {}
});
