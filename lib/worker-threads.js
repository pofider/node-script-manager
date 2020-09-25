const uuid = require('uuid').v4

const callbackRequests = {}

function callback (managerPort, rid, ...args) {
  const cid = uuid()

  callbackRequests[rid] = callbackRequests[rid] || {}
  callbackRequests[rid].cbs = callbackRequests[rid].cbs || {}

  if (!callbackRequests[rid].responseHandler) {
    callbackRequests[rid].responseHandler = (resPayload) => {
      if (resPayload.params.length && resPayload.params[0]) {
        resPayload.params[0] = new Error(resPayload.params[0])
      }
      const cb = callbackRequests[rid].cbs[resPayload.cid]

      delete callbackRequests[rid].cbs[resPayload.cid]

      // eslint-disable-next-line standard/no-callback-literal
      cb(...resPayload.params)

      if (Object.keys(callbackRequests[rid].cbs).length === 0) {
        delete callbackRequests[rid]
      }
    }
  }

  callbackRequests[rid].cbs[cid] = args[args.length - 1]

  args.pop()

  managerPort.postMessage({
    rid,
    cid,
    data: args.sort()
  })
}

module.exports = async function workerThreadExecute ({ rid, data, managerPort }) {
  const { inputs, options } = data

  managerPort.on('message', (payload) => {
    // we will receive here the response of callback execution
    const { rid, cid } = payload

    callbackRequests[rid].responseHandler({
      cid,
      params: payload.data
    })
  })

  const result = await new Promise((resolve) => {
    try {
      require(options.execModulePath)(inputs, callback.bind(undefined, managerPort, rid), (err, result) => {
        const response = { rid }

        if (err) {
          response.error = {
            message: err.message,
            stack: err.stack
          }
        } else {
          response.data = result
        }

        resolve(response)
      })
    } catch (e) {
      const response = {
        rid,
        error: {
          message: e.message,
          stack: e.stack
        }
      }

      resolve(response)
    }
  })

  managerPort.close()

  return result
}
