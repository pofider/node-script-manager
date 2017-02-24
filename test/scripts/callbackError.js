module.exports = function (inputs, callerCallback, done) {
  callerCallback('test', function () {
    done(new Error('foo'))
  })
}
