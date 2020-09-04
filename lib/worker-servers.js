/*!
 * Copyright(c) 2014 Jan Blaha
 *
 * http server cluster listening on dedicated work and executing specified tasks
 */

var cluster = require('cluster')
// eslint-disable-next-line
var domain = require('domain')
var uuid = require('uuid').v4
var messageHandler = require('./messageHandler')

var workers = []
var currentRequests = {}
var port
var host
var inputRequestLimit
var callbackRequests = {}

var workersClusterId = process.env.SCRIPT_MANAGER_WORKERS_CLUSTER_ID
delete process.env.SCRIPT_MANAGER_WORKERS_CLUSTER_ID

if (cluster.isMaster) {
  var isRunning = false

  cluster.on('fork', function (worker) {
    worker.pid = worker.process.pid
    worker.isRunning = false
    workers.push(worker)

    worker.process.on('message', function (rawM) {
      var m = messageHandler.parse(rawM)

      if (m.action === 'register') {
        var worker = workers.find(w => w.pid === m.pid)

        // maybe worker was recycled before it started? unlikely, but to be sure we don't crash the master
        if (worker) {
          currentRequests[m.rid] = worker

          process.send(messageHandler.serialize({
            action: 'register',
            rid: m.rid
          }))
        }
      }

      if (m.action === 'completed') {
        delete currentRequests[m.rid]
      }

      if (m.action === 'callback') {
        process.send(messageHandler.serialize(m))
      }
    })

    worker.on('exit', function (w, code, signal) {
      workers = workers.filter(w => w.pid !== worker.pid)

      var keysToDelete = []

      for (var key in currentRequests) {
        if (currentRequests[key].pid === worker.pid) {
          keysToDelete.push(key)
        }
      }

      keysToDelete.forEach(function (k) {
        delete currentRequests[k]
      })

      cluster.fork(Object.assign({}, process.env, {
        SCRIPT_MANAGER_WORKERS_CLUSTER_ID: workersClusterId
      }))
    })

    worker.send(messageHandler.serialize({
      action: 'start',
      port: port,
      host: host,
      inputRequestLimit: inputRequestLimit
    }))
  })

  cluster.on('listening', function (worker) {
    if (isRunning) {
      return
    }

    worker.isRunning = true

    if (!workers.find(w => w.isRunning === false)) {
      isRunning = true

      process.send(messageHandler.serialize({
        action: 'running'
      }))
    }
  })

  process.on('message', function (rawM) {
    var m = messageHandler.parse(rawM)
    var worker

    if (m.action === 'kill') {
      worker = currentRequests[m.rid]

      if (worker) {
        worker.process.kill('SIGKILL')
      }
    }

    if (m.action === 'start') {
      port = m.port
      host = m.host
      inputRequestLimit = m.inputRequestLimit

      for (var i = 0; i < m.numberOfWorkers; i++) {
        cluster.fork(Object.assign({}, process.env, {
          SCRIPT_MANAGER_WORKERS_CLUSTER_ID: workersClusterId
        }))
      }
    }

    if (m.action === 'callback-response') {
      worker = currentRequests[m.rid]

      // worker could be recycled in the meantime
      if (worker) {
        worker.send(messageHandler.serialize(m))
      }
    }
  })
}

if (!cluster.isMaster) {
  var startListening = function (port, host) {
    var server = require('http').createServer(function (req, res) {
      // NOTE: we're still using domains here intentionally,
      // we have tried to avoid its usage but unfortunately there is no other way to
      // ensure that we are handling all kind of errors that can occur in an external script,
      // but everything is ok because node.js will only remove domains when they found an alternative
      // and when that time comes, we just need to migrate to that alternative.
      var d = domain.create()

      d.on('error', function (er) {
        try {
          // make sure we close down within 30 seconds
          var killtimer = setTimeout(function () {
            process.exit(1)
          }, 30000)

          // But don't keep the process open just for that!
          killtimer.unref()

          // stop taking new requests.
          server.close()

          // Let the master know we're dead.  This will trigger a
          // 'disconnect' in the cluster master, and then it will fork
          // a new worker.
          if (cluster) {
            cluster.worker.disconnect()
          }

          error(res, er)
        } catch (er2) {
          // oh well, not much we can do at this point.
          console.error('Error sending 500!', er2.stack)
        }
      })

      d.add(req)
      d.add(res)
      d.req = req

      d.run(function () {
        processRequest(workersClusterId, req, res)
      })
    })

    server.timeout = 0
    server.listen(port, host)
  }

  process.on('message', function (rawM) {
    var m = messageHandler.parse(rawM)
    inputRequestLimit = m.inputRequestLimit

    if (m.action === 'start') {
      startListening(m.port, m.host)
    }

    if (m.action === 'callback-response') {
      callbackRequests[m.rid](m)
    }
  })
}

function error (res, err) {
  res.writeHead(500)

  res.end(messageHandler.serialize({
    error: {
      message: err.message,
      stack: err.stack
    }
  }))
}

function processRequest (workersClusterId, req, res) {
  var body = []
  var length = 0

  req.on('data', function (data) {
    body.push(data)
    length += data.length

    if (inputRequestLimit !== -1 && length > inputRequestLimit) {
      error(res, new Error('Input request exceeded inputRequestLimit'))
      res.destroy()
    }
  })

  req.on('end', function () {
    req.body = messageHandler.parse(Buffer.concat(body).toString())

    if (!req.body.options.wcid || req.body.options.wcid !== workersClusterId) {
      return error(res, new Error('Bad request'))
    }

    process.send(messageHandler.serialize({
      action: 'register',
      rid: req.body.options.rid,
      pid: process.pid
    }))

    try {
      var cbs = {}

      var callback = function () {
        var cid = uuid()

        cbs[cid] = arguments[arguments.length - 1]

        if (!callbackRequests[req.body.options.rid]) {
          callbackRequests[req.body.options.rid] = function (m) {
            if (m.params.length) {
              if (m.params[0]) {
                m.params[0] = new Error(m.params[0])
              }
            }

            var cb = cbs[m.cid]

            delete cbs[m.cid]

            cb.apply(this, m.params)

            if (Object.keys(cbs).length === 0) {
              delete callbackRequests[req.body.options.rid]
            }
          }
        }

        var args = Array.prototype.slice.call(arguments)

        args.pop()

        process.send(messageHandler.serialize({
          action: 'callback',
          cid: cid,
          rid: req.body.options.rid,
          pid: process.pid,
          params: args.sort()
        }))
      }

      require(req.body.options.execModulePath)(req.body.inputs, callback, function (err, val) {
        if (err) {
          return error(res, err)
        }

        try {
          res.end(messageHandler.serialize(val))
        } catch (eSerialize) {
          error(res, eSerialize)
        }
      })
    } catch (e) {
      error(res, e)
    }
  })
}
