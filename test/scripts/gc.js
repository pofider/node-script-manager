module.exports = function (inputs, callerCallback, done) {
  process.nextTick(function () {
    global.gc()
    done(null, inputs)
  })
}
