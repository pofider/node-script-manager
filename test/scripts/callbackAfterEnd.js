module.exports = function (inputs, callerCallback, done) {
  setTimeout(() => {
    callerCallback('test', () => {})
  }, 100)

  done(null, { ok: true })
}
