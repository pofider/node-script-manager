var uuid = require('uuid').v4
var messageHandler = require('./messageHandler')

process.on('uncaughtException', function (err) {
  process.send(messageHandler.serialize({
    error: err.message,
    errorStack: err.stack
  }), () => {})

  process.exit()
})

var cbs = {}

function callback () {
  var cid = uuid()

  cbs[cid] = arguments[arguments.length - 1]

  var args = Array.prototype.slice.call(arguments)
  args.pop()

  process.send(messageHandler.serialize({
    action: 'callback',
    cid: cid,
    pid: process.pid,
    params: args.sort()
  }), () => {})
}

function sendAndExit (m) {
  // we check for the amount of arguments that `process.send` supports
  // to provide support for older versions (<=4.x.x) of node that doesn't support a callback
  if (process.send.length <= 2) {
    process.send(messageHandler.serialize(m), () => {})

    setTimeout(function () {
      process.exit()
    }, 5000)
  } else {
    // since other arguments in `process.send` are optional a call with two arguments
    // works in the rest of versions
    process.send(messageHandler.serialize(m), function () {
      process.exit()
    })
  }
}

process.on('message', function (rawM) {
  var m = messageHandler.parse(rawM)

  if (m.action === 'callback-response') {
    if (m.params.length) {
      if (m.params[0]) {
        m.params[0] = new Error(m.params[0])
      }
    }

    var cb = cbs[m.cid]

    delete cbs[m.cid]

    return cb.apply(this, m.params)
  }

  require(m.options.execModulePath)(m.inputs, callback, function (err, val) {
    if (err) {
      sendAndExit({
        error: err.message,
        errorStack: err.stack
      })
    } else {
      sendAndExit({
        action: 'process-response',
        value: val
      })
    }
  })
})
