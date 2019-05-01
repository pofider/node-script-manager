var util = require('util')

module.exports = function (inputs, callback, done) {
  var promises = []

  var callbackAsync = util.promisify(callback)

  promises.push(callbackAsync(`${inputs.name} Matos`))
  promises.push(callbackAsync(`${inputs.name} Morillo`))

  Promise.all(promises).then(function (result) {
    done(null, result)
  }).catch(done)
}
