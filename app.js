// always resolve paths relative to app.js directory
process.chdir(__dirname);

var express = require('express');
var ini = require('./lib/express-ini');
var format = require('util').format;
var nopt = require("nopt");
var URL = require('url');
var readfile = require('fs').readFileSync;
var mkdirp = require('mkdirp');

// APP
var app = express();

var config = ini(app);

ini(app, './private/namespaces.ini');
ini(app, './private/servers.ini');

Object.keys(config.namespaces).forEach(function(ns) {
	var token = config.namespaces[ns];
	var obj = {
		namespace: ns,
		token: config.namespaces[ns]
	};
	try {
		obj.publicKey = readfile('private/' + ns + '.pem');
	} catch(ex) {
		console.warn("No public key for", ns);
	}
	config.namespaces[ns] = obj;
});

var parsed = nopt({
	"server" : Number,
	"node": Number
});
config.server = parsed.server || 0;
config.node = parsed.node || 0;

config.servers = Object.keys(config.servers).map(function(val) {
	var list = val.split(' ');
	var hostname = list.shift();
	var nodes = list.map(function(item) {
		var itemUrl = URL.parse(item);
		return URL.parse(URL.format({
			hostname: hostname,
			port: parseInt(itemUrl.path),
			protocol: itemUrl.protocol || 'http:'
		}));
	});
	return nodes;
});

config.site = config.servers[config.server][config.node];
config.site.port = config.site.port || 80;
config.listen = config.listen || config.site.port;

var server = config.site.protocol == "https:" ?
	require('https').createServer({
		key:readfile(format('private/%s/privkey.pem', config.site.hostname)),
		cert:readfile(format('private/%s/fullchain.pem', config.site.hostname))
	}, app)
	:
	require('http').createServer(app);

var acmeRoot = '/.well-known/acme-challenge';
mkdirp.sync(__dirname + acmeRoot);
app.use(
	acmeRoot,
	express.static(__dirname + acmeRoot),
	function(req, res, next) {
		console.info("File not found", req.path);
		res.sendStatus(404);
	}
);

require('./lib/express.js')(app, server);

process.title = format("ws-%s-%d-%d", app.settings.env, config.server, config.node);
process.on('uncaughtException', function(err) {
	console.log(err.stack || err.message || err);
});

server.listen(config.listen);

console.log("%s\n%s", process.title, app.settings.site.href);

