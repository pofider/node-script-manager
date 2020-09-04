var should = require('should')
var path = require('path')
var axios = require('axios')
var ScriptsManager = require('../lib/manager-servers.js')
var ScriptsManagerWithProcesses = require('../lib/manager-processes.js')
var ScriptManagerInProcess = require('../lib/in-process.js')

describe('scripts manager', function () {
  describe('servers', function () {
    var scriptsManager = new ScriptsManager({ numberOfWorkers: 2 })

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
      var scriptsManager2 = new ScriptsManager({ numberOfWorkers: 1 })

      scriptsManager2.ensureStarted(function () {
        scriptsManager2.execute({}, { execModulePath: path.join(__dirname, 'scripts', 'unexpectedError.js') }, function (err, res) {
          if (!err) {
            scriptsManager2.kill()
            done(new Error('should have failed'))
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

    it('should be able to set up on custom port', function (done) {
      var scriptsManager2 = new ScriptsManager({ numberOfWorkers: 1, portLeftBoundary: 10000, portRightBoundary: 11000 })

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
      var scriptsManager = new ScriptsManager({ numberOfWorkers: 2, inputRequestLimit: 5 })

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
      var scriptsManager = new ScriptsManager({ numberOfWorkers: 2, inputRequestLimit: 500 })

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
      var scriptsManager = new ScriptsManager({ numberOfWorkers: 2, strategy: 'dedicated-process', inputRequestLimit: 500, forkOptions: { execArgv: ['--expose-gc'] } })

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
      var scriptsManager = new ScriptsManager({ numberOfWorkers: 2, strategy: 'http-server', inputRequestLimit: 500, forkOptions: { execArgv: ['--expose-gc'] } })

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

        should(Buffer.isBuffer(res.buf)).be.true()
        res.bufInText.should.be.eql('hello')
        should(Buffer.isBuffer(res.responseBuf)).be.true()
        res.responseBuf.toString().should.be.eql('hello world')
        done()
      })
    })

    it('should be able to handle buffer values (callback)', function (done) {
      var callback = function (newData, cb) {
        cb(null, Object.assign({}, newData, {
          receivedBufInText: newData.receivedBuf.toString()
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

        should(Buffer.isBuffer(res.buf)).be.true()
        res.bufInText.should.be.eql('hello')
        should(Buffer.isBuffer(res.responseBuf)).be.true()
        res.responseBuf.toString().should.be.eql('hello world')
        should(Buffer.isBuffer(res.receivedBuf)).be.true()
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
