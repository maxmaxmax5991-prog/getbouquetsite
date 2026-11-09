// Пример может показывать не корзину, а форму: сердце, букву или слово.
// Храним в тех же примерах — у них уже есть загрузка снимка, порядок и
// рубильник «на сайте», заводить вторую такую же коллекцию незачем.
migrate((app) => {
  const c = app.findCollectionByNameOrId("basket_samples");
  c.fields.add(new TextField({ name: "shape", max: 10 }));
  app.save(c);
}, (app) => {
  const c = app.findCollectionByNameOrId("basket_samples");
  c.fields.removeByName("shape");
  app.save(c);
});
