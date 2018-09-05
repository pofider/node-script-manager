module.exports = function (inputs, callbackResponse, done) {
  inputs.bufInText = inputs.buf.toString()
  inputs.responseBuf = Buffer.from(inputs.bufInText + ' world')

  if (inputs.useCallback) {
    callbackResponse({
      receivedBuf: Buffer.from('secret message')
    }, function (err, resp) {
      done(err, Object.assign({}, inputs, resp))
    })
  } else {
    done(null, inputs)
  }
}
