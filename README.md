# script-manager
[![NPM Version](http://img.shields.io/npm/v/script-manager.svg?style=flat-square)](https://npmjs.com/package/script-manager)
[![License](http://img.shields.io/npm/l/script-manager.svg?style=flat-square)](http://opensource.org/licenses/MIT)
[![Build Status](https://travis-ci.org/pofider/node-script-manager.png?branch=master)](https://travis-ci.org/pofider/node-script-manager)

**node.js manager for running foreign and potentially dangerous scripts in the cluster**


## Basics

You can use node.js vm module for running a custom javascript code, but when the code is bad it can quickly get your node.js process into an endless loop. For this reason it is better to run users's custom code in a separate node process which you can recycle when the script reaches timeout. This can be achieved using node child_process module, but a simple implementation has limitations in performance and scale because running each script in a new node child process can quickly spawn whole system with node processes. This package solves the problem of running user's custom javascript code in a load balanced cluster of node processes which are reused over the requests and recycled when needed.

```js
var scriptManager = require("script-manager")({ numberOfWorkers: 2 });

scriptManager.ensureStarted(function(err) {

	/*send user's script including some other specific options into
	wrapper specified by execModulePath*/
	scriptManager.execute({
		script: "return 'Jan';"
	}, {
		execModulePath: path.join(__dirname, "script.js"),
	    timeout: 10
	}, function(err, res) {
		console.log(res);
	});

});
```

```js
/*script.js
wrapper usually does some fancy thing and then runs the custom script using node.js vm module*/
module.exports = function(inputs, callback, done) {
	var result = require('vm').runInNewContext(inputs.script, {
		require: function() { throw new Error("Not supported"); }
	});
	done(result);
});
```

## Callbacks
The executing script can also callback to the caller process. The callback is provided using `node.js` cross process messages so it has some limitations, but should work when transferring just common objects in parameters.

To provide caller callback you can add the `callback` property to the `execute` options:

```js
scriptManager.execute({
		script: "return 'Jan';"
	}, {
		execModulePath: path.join(__dirname, "script.js"),
	    callback: function(argA, argB, cb) {
		    cb(null, "foo");
	    }
	}, function(err, res) {
		console.log(res);
	});
```

Then in the wrapper you can for example offer a function `funcA` to the users script which uses callback parameter to contact the original caller.

```js
module.exports = function(inputs, callback, done) {
	var result = require('vm').runInNewContext(inputs.script, {
		require: function() { throw new Error("Not supported"); },
		funcA: function(argA, cb) {
			callback(argA, cb);
		}
	});
	done(result);
});
```

## Options

```js
var scriptManager = require("script-manager")({
 		/* number of worker node.js processes */
		numberOfWorkers: 2,
		/* set a custom hostname on which script execution server is started, useful is cloud environments where you need to set specific IP */
		host: '127.0.0.1',
		/* set a specific port range for script execution server */
		portLeftBoundary: 1000,
		portRightBoundary: 2000,
		/* maximum size of message sent/received from/to worker in http-server strategy*/
		inputRequestLimit: 200e6,
		/* switch to use dedicated process for script evalution, this can help with
		some issues caused by corporate proxies */
		strategy: "http-server | dedicated-process | in-process",
		/* options passed to forked node worker process: { execArgv: ['�-max-old-space-size=128'] } */
		forkOptions: {}
	});
```


## License
See [license](https://github.com/pofider/node-script-manager/blob/master/LICENSE)
