var should = require('should')
var path = require('path')
const uuid = require('uuid').v4
var axios = require('axios')
var ScriptsManagerWithThreads = require('../lib/manager-threads.js')
var ScriptsManagerWithHttpServer = require('../lib/manager-servers.js')
var ScriptsManagerWithProcesses = require('../lib/manager-processes.js')
var ScriptManagerInProcess = require('../lib/in-process.js')

describe('scripts manager', function () {
  describe('threads', function () {
    const scriptsManager = new ScriptsManagerWithThreads({
      numberOfWorkers: 2
    })

    beforeEach(function (done) {
      scriptsManager.ensureStarted(done)
    })

    afterEach(function () {
      scriptsManager.kill()
    })

    common(scriptsManager)
    commonForSafeExecution(scriptsManager)

    it('should handle concurrent tasks that are about to initialize the same thread (using reservation api)', function (done) {
      const scriptsManager2 = new ScriptsManagerWithThreads({ numberOfWorkers: 1 })

      scriptsManager2.ensureStarted((err) => {
        if (err) {
          return done(err)
        }

        const taskId = uuid()

        const reservation = scriptsManager2.reserveForTask(taskId)

        const run = async () => {
          return new Promise((resolve, reject) => {
            scriptsManager2.execute({ foo: 'foo' }, {
              taskId,
              timeout: 200,
              execModulePath: path.join(__dirname, 'scripts', 'script.js')
            }, (err, res) => {
              if (err) {
                return reject(err)
              }

              resolve(res)
            })
          })
        }

        Promise.all([run(), run()]).then(() => {
          done()
        }).catch((err) => done(err)).finally(() => {
          reservation.release()
          scriptsManager2.kill()
        })
      })
    })

    it('should not stuck in deadlocks (using reservation api)', function (done) {
      const scriptsManager2 = new ScriptsManagerWithThreads({ numberOfWorkers: 1 })
      let isDone = false

      scriptsManager2.ensureStarted((err) => {
        if (err) {
          return done(err)
        }

        const taskId = uuid()

        const reservation = scriptsManager2.reserveForTask(taskId)

        const callback = function (str, cb) {
          scriptsManager2.execute({ foo: 'foo' }, {
            taskId,
            execModulePath: path.join(__dirname, 'scripts', 'script.js'),
            timeout: 100
          }, (err, res) => {
            if (err) {
              if (isDone) {
                return
              }

              reservation.release()
              scriptsManager2.kill()
              isDone = true
              return done(err)
            }

            cb(null, { ...res, str })
          })
        }

        scriptsManager2.execute({
          useCallback: true
        }, {
          taskId,
          execModulePath: path.join(__dirname, 'scripts', 'callback.js'),
          callback: callback
        }, (err, res) => {
          if (err) {
            if (isDone) {
              return
            }

            isDone = true
            reservation.release()
            scriptsManager2.kill()
            return done(err)
          }

          try {
            should(res.test).be.ok()
            res.test.foo.should.be.eql('foo')
            res.test.str.should.be.eql('test')
            done()
          } catch (e) {
            done(e)
          } finally {
            reservation.release()
            scriptsManager2.kill()
          }
        })
      })
    })

    it('should handle serialization error when sending message', function (done) {
      scriptsManager.execute({
        foo: new Proxy({ value: 'foo' }, {})
      }, {
        execModulePath: path.join(__dirname, 'scripts', 'script.js')
      }, function (err) {
        if (err) {
          if (!err.message.includes('could not be cloned')) {
            return done(new Error(`Error was no the one expected. Got error message: ${err.message}`))
          }

          return done()
        } else {
          done(new Error('It should have failed'))
        }
      })
    })

    it('should handle serialization error when sending message (using reservation api)', function (done) {
      const scriptsManager2 = new ScriptsManagerWithThreads({ numberOfWorkers: 1 })

      scriptsManager2.ensureStarted((err) => {
        if (err) {
          return done(err)
        }

        const taskId = uuid()

        const reservation = scriptsManager2.reserveForTask(taskId)

        const run = async (value) => {
          return new Promise((resolve, reject) => {
            scriptsManager2.execute(value, {
              taskId,
              execModulePath: path.join(__dirname, 'scripts', 'script.js')
            }, function (err, resp) {
              if (err) {
                return reject(err)
              }

              resolve(resp)
            })
          })
        }

        run({
          foo: { value: 'foo' }
        }).then(async () => {
          return run({
            foo: new Proxy({ value: 'foo' }, {})
          }).then(() => {
            throw new Error('It should have failed')
          }, (err) => {
            if (!err.message.includes('could not be cloned')) {
              throw new Error(`Error was no the one expected. Got error message: ${err.message}`)
            }
          })
        }).then(() => {
          done()
        }).catch((err) => {
          done(err)
        }).finally(() => {
          reservation.release()
          scriptsManager2.kill()
        })
      })
    })

    it('should handle serialization error when sending message (callback)', function (done) {
      const callback = (value, cb) => {
        cb(null, value)
      }

      scriptsManager.execute({
        useProxyInCallback: true
      }, {
        execModulePath: path.join(__dirname, 'scripts', 'callbackSerializationError.js'),
        callback
      }, function (err) {
        if (err) {
          if (!err.message.includes('could not be cloned')) {
            return done(new Error(`Error was no the one expected. Got error message: ${err.message}`))
          }

          return done()
        } else {
          done(new Error('It should have failed'))
        }
      })
    })

    it('should handle serialization error when sending message (callback2)', function (done) {
      const callback = (value, cb) => {
        cb(null, new Proxy(value, {}))
      }

      scriptsManager.execute({
        foo: 'foo'
      }, {
        execModulePath: path.join(__dirname, 'scripts', 'callbackSerializationError.js'),
        callback
      }, function (err) {
        if (err) {
          if (!err.message.includes('could not be cloned')) {
            return done(new Error(`Error was no the one expected. Got error message: ${err.message}`))
          }

          return done()
        } else {
          done(new Error('It should have failed'))
        }
      })
    })

    it('should handle serialization error when sending message (response)', function (done) {
      const callback = (value, cb) => {
        cb(null, value)
      }

      scriptsManager.execute({
        useProxyInResponse: true
      }, {
        execModulePath: path.join(__dirname, 'scripts', 'callbackSerializationError.js'),
        callback
      }, function (err) {
        if (err) {
          if (!err.message.includes('could not be cloned')) {
            return done(new Error(`Error was no the one expected. Got error message: ${err.message}`))
          }

          return done()
        } else {
          done(new Error('It should have failed'))
        }
      })
    })

    it('should work after process recycles', function (done) {
      var scriptsManager2 = new ScriptsManagerWithThreads({ numberOfWorkers: 1 })

      scriptsManager2.ensureStarted(function () {
        scriptsManager2.execute({}, { execModulePath: path.join(__dirname, 'scripts', 'unexpectedError.js') }, function (err, res) {
          if (!err) {
            scriptsManager2.kill()
            return done(new Error('should have failed'))
          }

          // seems we need to wait a bit until it is restarted fully?
          setTimeout(function () {
            scriptsManager2.execute({}, { execModulePath: path.join(__dirname, 'scripts', 'script.js') }, function (err, res) {
              if (err) {
                scriptsManager2.kill()
                return done(err)
              }

              scriptsManager2.kill()
              done()
            })
          }, 100)
        })
      })
    })

    it('should be able to process high data volumes', function (done) {
      var data = { foo: 'foo', people: [] }

      for (var i = 0; i < 2000000; i++) {
        data.people.push(i)
      }

      scriptsManager.execute(data, { execModulePath: path.join(__dirname, 'scripts', 'script.js') }, function (err, res) {
        if (err) {
          return done(err)
        }

        res.foo.should.be.eql('foo')
        done()
      })
    })
  })

  describe('servers', function () {
    var scriptsManager = new ScriptsManagerWithHttpServer({ numberOfWorkers: 2 })

    beforeEach(function (done) {
      scriptsManager.ensureStarted(done)
    })

    afterEach(function () {
      scriptsManager.kill()
    })

    common(scriptsManager)
    commonForSafeExecution(scriptsManager)

    it('should not be able to process request directly to worker', function (done) {
      axios({
        method: 'post',
        url: 'http://localhost:' + scriptsManager.options.port,
        data: {
          options: {
            rid: 12,
            wcid: 'invalid',
            execModulePath: path.join(__dirname, 'scripts', 'script.js')
          }
        }
      }).then((response) => {
        done(new Error('Request should not be able to end successfully'))
      }).catch((err) => {
        if (err.response) {
          err.response.data.error.message.should.be.eql('Bad request')
          done()
        } else {
          done(err)
        }
      })
    })

    it('should work after process recycles', function (done) {
      var scriptsManager2 = new ScriptsManagerWithHttpServer({ numberOfWorkers: 1 })

      scriptsManager2.ensureStarted(function () {
        scriptsManager2.execute({}, { execModulePath: path.join(__dirname, 'scripts', 'unexpectedError.js') }, function (err, res) {
          if (!err) {
            scriptsManager2.kill()
            return done(new Error('should have failed'))
          }

          // seems we need to wait a bit until it is restarted fully?
          setTimeout(function () {
            scriptsManager2.execute({}, { execModulePath: path.join(__dirname, 'scripts', 'script.js') }, function (err, res) {
              if (err) {
                scriptsManager2.kill()
                return done(err)
              }

              scriptsManager2.kill()
              done()
            })
          }, 200)
        })
      })
    })

    it('should be able to set up on custom port', function (done) {
      var scriptsManager2 = new ScriptsManagerWithHttpServer({ numberOfWorkers: 1, portLeftBoundary: 10000, portRightBoundary: 11000 })

      scriptsManager2.start(function (err) {
        if (err) {
          return done(err)
        }

        scriptsManager2.execute({ foo: 'foo' }, { execModulePath: path.join(__dirname, 'scripts', 'script.js') }, function (err, res) {
          scriptsManager2.kill()

          if (err) {
            return done(err)
          }

          scriptsManager2.options.port.should.be.within(10000, 11000)
          res.foo.should.be.eql('foo')
          done()
        })
      })
    })

    it('should be able to process high data volumes', function (done) {
      var data = { foo: 'foo', people: [] }

      for (var i = 0; i < 2000000; i++) {
        data.people.push(i)
      }

      scriptsManager.execute(data, { execModulePath: path.join(__dirname, 'scripts', 'script.js') }, function (err, res) {
        if (err) {
          return done(err)
        }

        res.foo.should.be.eql('foo')
        done()
      })
    })
  })

  describe('servers with custom settings', function () {
    it('should fail when input exceeds the inputRequestLimit', function (done) {
      var scriptsManager = new ScriptsManagerWithHttpServer({ numberOfWorkers: 2, inputRequestLimit: 5 })

      scriptsManager.ensureStarted(function (err) {
        if (err) {
          return done(err)
        }

        scriptsManager.execute('foooooo', { execModulePath: path.join(__dirname, 'scripts', 'script.js') }, function (err, res) {
          scriptsManager.kill()

          if (err) {
            return done()
          }

          done(new Error('It should have dailed'))
        })
      })
    })

    it('should not fail when input is shorter the inputRequestLimit', function (done) {
      var scriptsManager = new ScriptsManagerWithHttpServer({ numberOfWorkers: 2, inputRequestLimit: 500 })

      scriptsManager.ensureStarted(function (err) {
        if (err) {
          return done(err)
        }

        scriptsManager.execute('foooooo', { execModulePath: path.join(__dirname, 'scripts', 'script.js') }, function (err, res) {
          scriptsManager.kill()

          if (err) {
            return done(err)
          }

          done()
        })
      })
    })

    it('should be able to expose gc through args to dedicated process', function (done) {
      var scriptsManager = new ScriptsManagerWithHttpServer({ numberOfWorkers: 2, strategy: 'dedicated-process', inputRequestLimit: 500, forkOptions: { execArgv: ['--expose-gc'] } })

      scriptsManager.ensureStarted(function (err) {
        if (err) {
          return done(err)
        }

        scriptsManager.execute({ foo: 'foo' }, { execModulePath: path.join(__dirname, 'scripts', 'gc.js') }, function (err, res) {
          scriptsManager.kill()

          if (err) {
            return done(err)
          }

          res.foo.should.be.eql('foo')
          done()
        })
      })
    })

    it('should be able to expose gc through args to http server', function (done) {
      var scriptsManager = new ScriptsManagerWithHttpServer({ numberOfWorkers: 2, strategy: 'http-server', inputRequestLimit: 500, forkOptions: { execArgv: ['--expose-gc'] } })

      scriptsManager.ensureStarted(function (err) {
        if (err) {
          return done(err)
        }

        scriptsManager.execute({ foo: 'foo' }, { execModulePath: path.join(__dirname, 'scripts', 'gc.js') }, function (err, res) {
          scriptsManager.kill()

          if (err) {
            return done(err)
          }

          res.foo.should.be.eql('foo')
          done()
        })
      })
    })
  })

  describe('processes', function () {
    var scriptsManager = new ScriptsManagerWithProcesses({ numberOfWorkers: 2 })

    beforeEach(function (done) {
      scriptsManager.ensureStarted(done)
    })

    afterEach(function () {
      scriptsManager.kill()
    })

    common(scriptsManager)
    commonForSafeExecution(scriptsManager)
  })

  describe('in process', function () {
    var scriptsManager = new ScriptManagerInProcess({})

    beforeEach(function (done) {
      scriptsManager.ensureStarted(done)
    })

    afterEach(function () {
      scriptsManager.kill()
    })

    common(scriptsManager)

    it('should handle timeouts', function (done) {
      var timeouted = false

      scriptsManager.execute({ foo: 'foo' },
        {
          execModulePath: path.join(__dirname, 'scripts', 'timeout.js'),
          timeout: 10
        }, function (err) {
          if (err) {
            timeouted = true
            done()
          }
        })

      setTimeout(function () {
        if (!timeouted) {
          done(new Error('It should timeout'))
        }
      }, 500)
    })
  })

  function commonForSafeExecution (scriptsManager) {
    it('should handle timeouts', function (done) {
      var timeouted = false

      scriptsManager.execute({ foo: 'foo' },
        {
          execModulePath: path.join(__dirname, 'scripts', 'timeout.js'),
          timeout: 10
        }, function () {
          timeouted = true
          done()
        })

      setTimeout(function () {
        if (!timeouted) {
          done(new Error('It should timeout'))
        }
      }, 500)
    })

    it('should handle unexpected error', function (done) {
      scriptsManager.execute({ foo: 'foo' }, { execModulePath: path.join(__dirname, 'scripts', 'unexpectedError.js') }, function (err, res) {
        if (err) {
          if (!err.message.includes('j is not defined')) {
            return done(new Error(`Error was no the one expected. Got error message: ${err.message}`))
          }

          return done()
        }

        done(new Error('There should be an error'))
      })
    })
  }

  function common (scriptsManager) {
    it('should be able to execute simple script', function (done) {
      scriptsManager.execute({ foo: 'foo' }, { execModulePath: path.join(__dirname, 'scripts', 'script.js') }, function (err, res) {
        if (err) {
          return done(err)
        }

        res.foo.should.be.eql('foo')
        done()
      })
    })

    it('should handle script error', function (done) {
      scriptsManager.execute({ foo: 'foo' }, { execModulePath: path.join(__dirname, 'scripts', 'error.js') }, function (err, res) {
        if (!err) {
          return done(new Error('It should have failed.'))
        }

        err.stack.should.containEql('error.js')
        done()
      })
    })

    it('should be able to handle date values', function (done) {
      scriptsManager.execute({
        date: new Date('2018-09-01')
      }, {
        execModulePath: path.join(__dirname, 'scripts', 'useDate.js')
      }, function (err, res) {
        if (err) {
          return done(err)
        }

        res.date.getTime().should.be.eql(res.dateInTime)
        done()
      })
    })

    it('should be able to handle date values (callback)', function (done) {
      var callback = function (newData, cb) {
        cb(null, Object.assign({}, newData, {
          internalDateInTime: newData.internalDate.getTime()
        }))
      }

      scriptsManager.execute({
        useCallback: true,
        date: new Date('2018-09-01')
      }, {
        execModulePath: path.join(__dirname, 'scripts', 'useDate.js'),
        callback: callback
      }, function (err, res) {
        if (err) {
          return done(err)
        }

        res.date.should.be.Date()
        res.date.getTime().should.be.eql(res.dateInTime)
        res.internalDate.should.be.Date()
        res.internalDate.getTime().should.be.eql(res.internalDateInTime)
        done()
      })
    })

    it('should be able to handle buffer values', function (done) {
      scriptsManager.execute({
        buf: Buffer.from('hello')
      }, {
        execModulePath: path.join(__dirname, 'scripts', 'useBuffer.js')
      }, function (err, res) {
        if (err) {
          return done(err)
        }

        should(res.buf.buffer != null).be.true()
        res.bufInText.should.be.eql('hello')
        should(res.responseBuf.buffer != null).be.true()
        Buffer.from(res.responseBuf).toString().should.be.eql('hello world')
        done()
      })
    })

    it('should be able to handle buffer values (callback)', function (done) {
      var callback = function (newData, cb) {
        cb(null, Object.assign({}, newData, {
          receivedBufInText: Buffer.from(newData.receivedBuf).toString()
        }))
      }

      scriptsManager.execute({
        useCallback: true,
        buf: Buffer.from('hello')
      }, {
        execModulePath: path.join(__dirname, 'scripts', 'useBuffer.js'),
        callback: callback
      }, function (err, res) {
        if (err) {
          return done(err)
        }

        should(res.buf.buffer != null).be.true()
        res.bufInText.should.be.eql('hello')
        should(res.responseBuf.buffer != null).be.true()
        Buffer.from(res.responseBuf).toString().should.be.eql('hello world')
        should(res.receivedBuf.buffer != null).be.true()
        res.receivedBufInText.should.be.eql('secret message')
        done()
      })
    })

    it('should be able to callback to the caller', function (done) {
      function callback (str, cb) {
        cb(null, str + 'aaa')
      }

      scriptsManager.execute({}, {
        execModulePath: path.join(__dirname, 'scripts', 'callback.js'),
        callback: callback
      }, function (err, res) {
        if (err) {
          return done(err)
        }

        res.test.should.be.eql('testaaa')

        done()
      })
    })

    it('should be able to callback error to the caller', function (done) {
      function callback (str, cb) {
        cb(null, str + 'aaa')
      }

      scriptsManager.execute({}, {
        execModulePath: path.join(__dirname, 'scripts', 'callbackError.js'),
        callback: callback
      }, function (err, res) {
        if (err) {
          return done()
        }

        done(new Error('It should have failed'))
      })
    })

    it('should be able to handle parallel callback calls', function (done) {
      var callback = function (name, cb) {
        cb(null, 'hi ' + name)
      }

      scriptsManager.execute({
        name: 'Boris'
      }, {
        execModulePath: path.join(__dirname, 'scripts', 'parallelCallbackCalls.js'),
        callback: callback
      }, function (err, res) {
        if (err) {
          return done(err)
        }

        res[0].should.be.eql('hi Boris Matos')
        res[1].should.be.eql('hi Boris Morillo')

        done()
      })
    })

    it('should be able to customize message when timeout error', function (done) {
      scriptsManager.execute({ foo: 'foo' }, {
        execModulePath: path.join(__dirname, 'scripts', 'timeout.js'),
        timeout: 10,
        timeoutErrorMessage: 'Timeout testing case'
      }, function (err) {
        err.message.should.be.eql('Timeout testing case')
        done()
      })
    })

    it('should not call callback after timeout error', function (done) {
      var resolved = 0

      function callback (str, cb) {
        setTimeout(() => {
          cb(null, str + '(callback executed)')
        }, 400)
      }

      scriptsManager.execute({}, {
        execModulePath: path.join(__dirname, 'scripts', 'callback.js'),
        timeout: 200,
        callback: callback
      }, function (err, res) {
        if (resolved > 0) {
          resolved++
          return
        }

        if (resolved === 0) {
          err.message.should.containEql('Timeout')
        }

        resolved++

        setTimeout(() => {
          resolved.should.be.eql(1)
          done()
        }, 1000)
      })
    })

    it('should not break when callback is called after script ends execution', function (done) {
      const callback = (str, cb) => {
        cb()
      }

      scriptsManager.execute({}, {
        execModulePath: path.join(__dirname, 'scripts', 'callbackAfterEnd.js'),
        callback: callback
      }, (err, res) => {
        if (err) {
          return done(err)
        }

        res.ok.should.be.True()
        setTimeout(() => { done() }, 500)
      })
    })

    it('should be able to differenciate between error and data with error property', function (done) {
      scriptsManager.execute({ foo: 'foo' }, { execModulePath: path.join(__dirname, 'scripts', 'okWithErrorProperty.js') }, function (err, res) {
        if (err) {
          return done(new Error('script should not fail with error'))
        }

        res.error.message.should.be.eql('custom')
        res.error.stack.should.be.eql('custom stack')

        done()
      })
    })

    it('should be able to process parallel requests', function (done) {
      function callback (str, cb) {
        setTimeout(function () {
          cb(null, str + 'aaa')
        }, 10)
      }

      var doneCounter = []

      for (var i = 0; i < 20; i++) {
        scriptsManager.execute({}, {
          execModulePath: path.join(__dirname, 'scripts', 'callback.js'),
          callback: callback
        }, function (err, res) {
          if (err) {
            return done(err)
          }

          res.test.should.be.eql('testaaa')
          doneCounter++

          if (doneCounter === 20) {
            done()
          }
        })
      }
    })

    it('should be able to execute script with giant input data', function (done) {
      var foo = 'xxx'

      for (var i = 0; i < 1000000; i++) {
        foo += 'yyyyyyyyyyyyy'
      }

      scriptsManager.execute({
        foo: foo
      }, {
        execModulePath: path.join(__dirname, 'scripts', 'script.js'),
        timeout: 20000
      }, function (err, res) {
        if (err) {
          return done(err)
        }

        res.foo.should.be.eql(foo)
        done()
      })
    })
  }
})
