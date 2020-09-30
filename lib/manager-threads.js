const path = require('path')
const uuid = require('uuid').v4
const EventEmitter = require('events')
const { MessageChannel } = require('worker_threads')
const Piscina = require('piscina')

const ScriptsManager = module.exports = function (options) {
  this.options = options
  this.options.timeout = this.options.timeout || 10000
  this.options.numberOfWorkers = this.options.numberOfWorkers || 1

  process.once('exit', () => {
    this.kill()
  })
}

ScriptsManager.prototype.start = function (cb) {
  this.workerManager = new Piscina({
    filename: path.join(__dirname, 'worker-threads.js'),
    minThreads: this.options.numberOfWorkers,
    maxThreads: this.options.numberOfWorkers,
    idleTimeout: Infinity
  })

  let workersPendingToBeOnline = this.workerManager.threads.length

  for (const worker of this.workerManager.threads) {
    worker.once('online', () => {
      workersPendingToBeOnline--

      if (workersPendingToBeOnline === 0) {
        this.isStarted = true
        cb()
      }
    })
  }
}

ScriptsManager.prototype.ensureStarted = function (cb) {
  if (this.isStarted) {
    return cb()
  }

  this.start(cb)
}

ScriptsManager.prototype.execute = function (inputs, options, cb) {
  const timeoutValue = options.timeout || this.options.timeout
  const rid = uuid()
  let callback

  if (options && options.callback) {
    callback = options.callback
    delete options.callback
  }

  // we create a message channel to be able to communicate with the same choosen
  // worker for this execution, this channel is used for callback execution of script manager
  const { port1: workerPort, port2: managerPort } = new MessageChannel()
  const abortEmitter = new EventEmitter()

  const reqOptions = {
    rid,
    isDone: false,
    callback,
    finish: (err, result) => {
      workerPort.close()
      cb(err, result)
    }
  }

  const body = {
    inputs,
    options
  }

  workerPort.on('message', (payload) => {
    // we will receive here the intention to run the callback
    const { rid, cid } = payload

    if (reqOptions.isDone) {
      return
    }

    payload.data.push((...args) => {
      if (reqOptions.isDone) {
        return
      }

      if (args.length && args[0]) {
        args[0] = args[0].message
      }

      workerPort.postMessage({
        rid,
        cid,
        data: args
      })
    })

    reqOptions.callback.apply(this, payload.data)
  })

  if (timeoutValue !== -1) {
    reqOptions.timeoutRef = setTimeout(() => {
      if (reqOptions.isDone) {
        return
      }

      reqOptions.isDone = true
      abortEmitter.emit('abort')

      const timeoutError = new Error()

      timeoutError.weak = true
      timeoutError.message = options.timeoutErrorMessage || 'Timeout error during executing script'

      reqOptions.finish(timeoutError)
    }, timeoutValue)
  }

  this.workerManager.runTask({
    rid,
    data: body,
    managerPort
  }, [managerPort], abortEmitter).then((result) => {
    if (reqOptions.isDone) {
      return
    }

    if (reqOptions.timeoutRef) {
      clearTimeout(reqOptions.timeoutRef)
    }

    reqOptions.isDone = true

    if (result.error) {
      const e = new Error()
      e.message = result.error.message
      e.stack = result.error.stack
      e.weak = true

      return reqOptions.finish(e)
    }

    reqOptions.finish(null, result.data)
  }).catch((err) => {
    if (reqOptions.isDone) {
      return
    }
    if (reqOptions.timeoutRef) {
      clearTimeout(reqOptions.timeoutRef)
    }

    reqOptions.finish(err)
  })
}

ScriptsManager.prototype.kill = function () {
  if (this.workerManager) {
    this.isStarted = false
    this.workerManager.destroy().catch((e) => {})
  }
}
