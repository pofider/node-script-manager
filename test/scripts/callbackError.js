module.exports = function(inputs, callerCallback, done) {

    callerCallback("test", function(err, resp) {
        done(new Error("foo"));
    });
};
