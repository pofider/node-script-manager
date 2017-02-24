module.exports = function (inputs, callerCallback, done) {
  callerCallback('test', function (err, resp) {
    done(err, { test: resp })
  })
}
