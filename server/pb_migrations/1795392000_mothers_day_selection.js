migrate((app) => {
  const collection = app.findCollectionByNameOrId('products');
  if (!collection.fields.getByName('mothers_day')) {
    collection.fields.add(new BoolField({name:'mothers_day',required:false}));
    app.save(collection);
  }
}, (app) => {
  const collection = app.findCollectionByNameOrId('products');
  const field = collection.fields.getByName('mothers_day');
  if (field) { collection.fields.removeById(field.id); app.save(collection); }
});
