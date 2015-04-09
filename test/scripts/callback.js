module.exports = function(inputs, callerCallback, done) {

    callerCallback("test", function(err, resp) {
        done(null, { test: resp});
    });
};
