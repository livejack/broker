var bodyParser = require('body-parser');
var backlog = require("socket.io-backlog");
var IoServer = require('socket.io');
var graphite = require('graphite');

var writer = require('./writer');

module.exports = function(app, server) {
	var config = app.settings;
	if (!config.servers) config.servers = [];

	IoServer.prototype.serve = require('./serve-client.js');
	var io = IoServer(server, {
		wsEngine: 'eiows',
		serveClient: true,
		clientTracking: false,
		perMessageDeflate: false
	});
	io.adapter(backlog({ cacheSize: 300, length: 1000 }));

	var spaces = {};

	for (var namespace in config.namespaces) {
		var nsp = io.of(namespace);
		var cns = config.namespaces[namespace];
		cns.errors = 0;
		spaces[namespace] = nsp;
		if (config.node > 0) {
			writer.slave(nsp, namespace, config);
		} else {
			writer.master(nsp, namespace, config);
		}
	}

	if (config.graphite) {
		if (config.graphite.url && config.graphite.bucket && config.graphite.namespaces) {
			var client = graphite.createClient(config.graphite.url);
			var interval = config.graphite.interval || 30000;
			if (interval < 10000) interval = 10000;
			setInterval(writeStats.bind(null, client, config), interval);
			console.info("graphite sending to", config.graphite.url, "every", interval, "ms");
		} else {
			console.error("graphite expects url, bucket, namespaces");
		}
	} else {
		console.info("no graphite config");
	}

	app.use(bodyParser.json());
	app.use(bodyParser.urlencoded({extended:true}));
	app.use(require('morgan')(':method :status :response-time ms :url - :res[content-length]'));

	app.post('/:namespace', writer.post(spaces));

	app.use(function(err, req, res, next) {
		if (err) console.error(err.stack || err.message || err);
		next();
	});

	function writeStats(client, config) {
		var metrics = {};
		Object.keys(config.graphite.namespaces).forEach(function(namespace) {
			var nsp = io.of(namespace);
			var connected = nsp.connected;
			var metric = [
				config.graphite.bucket,
				namespace,
				config.server,
				config.node
			].join('.');
			var pollings = 0;
			var websockets = 0;
			for (var k in connected) {
				if (connected[k].conn.transport.name == "polling") pollings++;
				else websockets++;
			}
			metrics[metric + '.pollings'] = pollings;
			metrics[metric + '.websockets'] = websockets;
			metrics[metric + '.errors'] = config.namespaces[namespace].errors || 0;
		});
		client.write(metrics, function(err) {
			if (err) return console.error("Error writing metrics", err);
		});
	}
};

