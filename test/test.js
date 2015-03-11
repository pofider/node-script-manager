var should = require("should"),
    path = require("path"),
    fs = require("fs"),
    ScriptsManager = require("../lib/manager.js");


describe("scripts manager", function () {

    var scriptsManager;

    beforeEach(function (done) {
        scriptsManager = new ScriptsManager();
        scriptsManager.start(function (err) {
            if (err)
                return done(err);

            done();
        });
    });

    afterEach(function () {

    });

    it("should be able to execute simple script", function (done) {
        scriptsManager.execute({foo: "foo"}, {execModulePath: path.join(__dirname, "scripts", "script.js")}, function (err, res) {
            if (err)
                return done(err);

            res.foo.should.be.eql("foo");
            done();
        });
    });

    it("should handle script error", function (done) {
        scriptsManager.execute({foo: "foo"}, {execModulePath: path.join(__dirname, "scripts", "error.js")}, function (err, res) {
            if (!err)
                return done(new Error("It should have failed."));

            done();
        });
    });

    it("should handle timeouts", function (done) {
        var timeouted = false
        scriptsManager.execute({foo: "foo"},
            {
                execModulePath: path.join(__dirname, "scripts", "timeout.js"),
                timeout: 10
            }, function (err, res) {
                timeouted = true;
                done();
            });

        setTimeout(function () {
            if (!timeouted)
                done(new Error("It should timeout"));

        }, 500);
    });
});

