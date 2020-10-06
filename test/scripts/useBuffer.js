module.exports = function (inputs, callbackResponse, done) {
  inputs.bufInText = inputs.buf.toString()
  inputs.responseBuf = Buffer.from(inputs.bufInText + ' world')

  const isBufferInside = Buffer.isBuffer(inputs.buf)

  if (inputs.useCallback) {
    callbackResponse({
      isBufferInside,
      receivedBuf: Buffer.from('secret message')
    }, function (err, resp) {
      done(err, Object.assign({}, inputs, resp))
    })
  } else {
    done(null, Object.assign({}, inputs, { isBufferInside }))
  }
}
