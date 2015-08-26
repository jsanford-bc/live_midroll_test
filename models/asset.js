var Datastore = require('nedb');
var db = new Datastore({ filename: 'db/assets.db', autoload: true });

var Asset = {};

Asset.create = function(options, cb) {
  var createTimestamp = Date.now();
  var newAsset = {
    _id: options.id,
    url: options.url,
    created_at: createTimestamp,
    updated_at: createTimestamp,
    state: 'new'
  };

  db.insert(newAsset, cb);
};

Asset.findById = function(id, cb) {
  db.findOne({ _id: id }, cb);
};

Asset.update = function(id, update, cb) {
  update.updated_at = Date.now();
  db.update({ _id: id }, { $set: update }, {});
  Asset.findById(id, cb);
};

module.exports = Asset;
