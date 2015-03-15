/*!
 * Copyright(c) 2014 Jan Blaha
 *
 * TaskManager responsible for running async tasks.
 * It's using cluster on http server to load balance work and also provides
 * timout handling
 */

var childProcess = require("child_process"),
    path = require("path"),
    uuid = require("uuid").v1,
    request = require("request"),
    _ = require("underscore"),
    S = require("string");

var ScriptsManager = module.exports = function (options) {
    this.options = options || {};
    this.options.numberOfWorkers = this.options.numberOfWorkers || 1;
    this.options.timeout = this.options.timeout || 10000;
    this._runningRequests = [];

    var self = this;
    process.once("exit", function () {
        self.kill();
    });
};

function findFreePort(cb) {
    var server = require("net-cluster").createServer();
    var port = 0;
    server.on('listening', function () {
        port = server.address().port;
        server.close();
    });
    server.on('close', function () {
        cb(port);
    });
    server.listen(0);
}

ScriptsManager.prototype.start = function (cb) {
    var self = this;

    findFreePort(function(port) {
        self.options.port = port;

        //fix freeze during debugging
        process.execArgv = _.filter(process.execArgv, function (arg) {
            return !S(arg).startsWith("--debug");
        });

        process.execArgv.push("--expose-gc");

        self.workersCluster = childProcess.fork(path.join(__dirname, "worker.js"), []);
        self.workersCluster.on("message", function (m) {
            if (m.action === "running") {
                self.isStarted = true;
                cb();
            }
        });

        self.workersCluster.on("message", function (m) {
            if (m.action === "register") {

                var reqOptions = _.findWhere(self._runningRequests, { rid: m.rid });

                if (!reqOptions)
                    return;

                //TODO we should actually kill only the script that caused timeout and resend other requests from the same worker... some more complicated logic is required here
                setTimeout(function () {
                    if (reqOptions.isDone)
                        return;

                    reqOptions.isDone = true;
                    self.workersCluster.send({action: "kill", rid: reqOptions.rid});

                    var error = new Error();
                    error.weak = true;
                    error.message = "Timeout";

                    self._runningRequests = _.without(self._runningRequests, _.findWhere(self._runningRequests, {rid: reqOptions.rid}));

                    reqOptions.cb(error);
                }, reqOptions.timeout || self.options.timeout);
            }
        });

        self.workersCluster.send({
            action: "start",
            port: self.options.port,
            numberOfWorkers: self.options.numberOfWorkers
        });
    });
};

ScriptsManager.prototype.ensureStarted = function (cb) {
    if (this.isStarted)
        return cb();

    this.start(cb);
};


ScriptsManager.prototype.execute = function (inputs, options, cb) {
    var self = this;

    options.rid = options.rid = uuid();
    options.isDone = false;
    options.cb = cb;

    var body = {
        inputs: inputs,
        options: options
    };

    this._runningRequests.push(options);

    request({
        method: "POST",
        url: "http://localhost:" + this.options.port,
        body: body,
        json: true
    }, function (err, httpResponse, body) {
        if (options.isDone)
            return;

        options.isDone = true;

        self._runningRequests = _.without(self._runningRequests, _.findWhere(self._runningRequests, {rid: options.rid}));

        if (err) {
            return cb(err);
        }

        if (body.error) {
            var e = new Error();
            e.message = body.error.message;
            e.stack = body.error.stack;
            e.weak = true;
            return cb(e);
        }

        cb(null, body);
    });
};

ScriptsManager.prototype.kill = function () {
    if (this.workersCluster) {
        this.workersCluster.kill();
    }
};
