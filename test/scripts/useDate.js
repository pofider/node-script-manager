module.exports = function (inputs, callbackResponse, done) {
  inputs.dateInTime = inputs.date.getTime()

  if (inputs.useCallback) {
    callbackResponse({
      internalDate: new Date('2018-09-02')
    }, function (err, resp) {
      done(err, Object.assign({}, inputs, resp))
    })
  } else {
    done(null, inputs)
  }
}
