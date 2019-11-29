module.exports = function (inputs, callerCallback, done) {
  done(null, {
    error: {
      message: 'custom',
      stack: 'custom stack'
    }
  })
}
