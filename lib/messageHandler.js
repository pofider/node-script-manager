var serializator = require('serializator')

module.exports.serialize = function (data) {
  return serializator.serialize(data)
}

module.exports.parse = function (dataStr) {
  return serializator.parse(dataStr)
}
