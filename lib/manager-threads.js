const path = require('path')
const uuid = require('uuid').v4
const EventEmitter = require('events')
const { MessageChannel } = require('worker_threads')
const Piscina = require('piscina')
const convertUint8ArrayProperties = require('./convertUint8ArrayProperties')

const ScriptsManager = module.exports = function (options) {
  this.options = options
  this.options.timeout = this.options.timeout || 10000
  this.options.numberOfWorkers = this.options.numberOfWorkers || 1
  this.requestsMap = new Map()
  this.taskReservationMap = new Map()

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

ScriptsManager.prototype.reserveForTask = function (taskId) {
  if (this.taskReservationMap.has(taskId)) {
    throw new Error(`Worker task reservation for "${taskId}" has already been created`)
  }

  const release = () => {
    const reservation = this.taskReservationMap.get(taskId)

    if (!reservation) {
      throw new Error(`Worker task reservation for "${taskId}" has already been released`)
    }

    if (reservation.release) {
      reservation.release()
    }

    this.taskReservationMap.delete(taskId)
  }

  this.taskReservationMap.set(taskId, {})

  return { release }
}

ScriptsManager.prototype.execute = function (inputs, options, cb) {
  const timeoutValue = options.timeout || this.options.timeout
  let callback

  if (options && options.callback) {
    callback = options.callback
    delete options.callback
  }

  let reuseWorkerMode = false
  let taskId
  let abortEmitter

  if (options && options.taskId != null) {
    if (!this.taskReservationMap.has(options.taskId)) {
      throw new Error(`Worker task reservation for "${options.taskId}" does not exists`)
    }

    taskId = options.taskId

    if (this.taskReservationMap.get(taskId).started) {
      reuseWorkerMode = true
    }
  }

  const reqOptions = {
    rid: uuid(),
    isDone: false,
    callback,
    finish: (err, result) => {
      reqOptions.isDone = true
      this.requestsMap.delete(reqOptions.rid)
      cb(err, result)
    }
  }

  const body = {
    inputs,
    options
  }

  let runTask

  const reuseWorker = (taskPayload, currentExecution) => {
    const reservation = this.taskReservationMap.get(taskId)

    reqOptions.execution = currentExecution

    this.requestsMap.set(reqOptions.rid, reqOptions)

    // we send the message in next tick because we want the function to remain sync and
    // just return the execution promise, in case of any error when sending we just propagate
    // that to the execution promise
    process.nextTick(() => {
      try {
        reservation.workerPort.postMessage({
          rid: reqOptions.rid,
          action: 'execute',
          data: taskPayload
        })
      } catch (e) {
        // usually error about some value could not be cloned
        currentExecution.reject(e)
      }
    })

    return currentExecution.promise
  }

  if (reuseWorkerMode) {
    runTask = async (taskPayload) => {
      const execution = {}

      execution.promise = new Promise((resolve, reject) => {
        execution.resolve = resolve
        execution.reject = reject
      })

      return reuseWorker(taskPayload, execution)
    }
  } else {
    abortEmitter = new EventEmitter()

    runTask = async (taskPayload) => {
      const execution = {}

      execution.promise = new Promise((resolve, reject) => {
        execution.resolve = resolve
        execution.reject = reject
      })

      // we create a message channel to be able to communicate with the same choosen
      // worker later
      let ready = false
      const { port1: workerPort, port2: managerPort } = new MessageChannel()

      workerPort.on('message', (payload) => {
        const { action } = payload

        switch (action) {
          case 'ready': {
            // we will receive here notification that worker started correctly
            ready = true

            if (taskId != null) {
              const reservation = this.taskReservationMap.get(taskId)

              const release = () => {
                workerPort.postMessage({ action: 'release' })
                workerPort.close()
              }

              if (!reservation) {
                try {
                  // we dont care about an error here
                  release()
                } catch (e) {}

                const error = new Error(`Worker task reservation for "${taskId}" has already been released`)

                reservation.starting.reject(error)
                return execution.reject(error)
              }

              reservation.started = true
              reservation.workerPort = workerPort
              reservation.release = release
              reservation.starting.resolve()
            }

            reqOptions.execution = execution

            this.requestsMap.set(reqOptions.rid, reqOptions)

            try {
              workerPort.postMessage({
                rid: reqOptions.rid,
                action: 'execute',
                data: taskPayload
              })
            } catch (e) {
              // usually error about some value could not be cloned
              execution.reject(e)
            }

            break
          }

          case 'callback': {
            // we will receive here the intention to run the callback
            const currentRequest = this.requestsMap.get(payload.rid)

            if (!currentRequest || currentRequest.isDone) {
              return
            }

            try {
              convertUint8ArrayProperties(payload.data)
            } catch (e) {
              return currentRequest.execution.reject(e)
            }

            payload.data.push((...args) => {
              if (currentRequest.isDone) {
                return
              }

              if (args.length && args[0]) {
                args[0] = args[0].message
              }

              try {
                workerPort.postMessage({
                  rid: payload.rid,
                  cid: payload.cid,
                  action: 'callback-response',
                  data: args
                })
              } catch (e) {
                // usually error about some value could not be cloned
                currentRequest.execution.reject(e)
              }
            })

            currentRequest.callback.apply(this, payload.data)

            break
          }

          case 'execute-response': {
            const currentRequest = this.requestsMap.get(payload.rid)

            if (!currentRequest || currentRequest.isDone) {
              return
            }

            try {
              convertUint8ArrayProperties(payload.data)
            } catch (e) {
              return currentRequest.execution.reject(e)
            }

            currentRequest.execution.resolve(payload.data)

            break
          }

          default:
            break
        }
      })

      let shouldContinueToWorkerManager = true

      if (taskId != null) {
        const reservation = this.taskReservationMap.get(taskId)

        if (reservation.starting != null) {
          shouldContinueToWorkerManager = false

          reservation.starting.promise.then(() => {
            reuseWorker(taskPayload, execution)
          }, (startErr) => {
            execution.reject(startErr)
          })
        } else {
          reservation.starting = {}

          reservation.starting.promise = new Promise((resolve, reject) => {
            reservation.starting.resolve = resolve
            reservation.starting.reject = reject
          })
        }
      }

      if (shouldContinueToWorkerManager) {
        this.workerManager.runTask({
          waitForTaskRelease: taskId != null,
          managerPort
        }, [managerPort], abortEmitter).catch((err) => {
          if (!ready) {
            execution.reject(err)
          }
        })
      }

      return execution.promise
    }
  }

  if (timeoutValue !== -1) {
    reqOptions.timeoutRef = setTimeout(() => {
      if (reqOptions.isDone) {
        return
      }

      if (abortEmitter) {
        abortEmitter.emit('abort')
      }

      const timeoutError = new Error()

      timeoutError.weak = true
      timeoutError.message = options.timeoutErrorMessage || 'Timeout error during executing script'

      reqOptions.finish(timeoutError)
    }, timeoutValue)
  }

  runTask(body).then((result) => {
    if (reqOptions.isDone) {
      return
    }

    if (reqOptions.timeoutRef) {
      clearTimeout(reqOptions.timeoutRef)
    }

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
