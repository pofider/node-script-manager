module.exports = function (inputs, callerCallback, done) {
  callerCallback({
    foo: inputs.useProxyInCallback === true ? new Proxy({ value: 'foo' }, {}) : { value: 'foo' }
  }, function (err, resp) {
    done(err, inputs.useProxyInResponse === true ? new Proxy(resp, {}) : resp)
  })
}
