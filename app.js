// always resolve paths relative to app.js directory
process.chdir(__dirname);

const express = require('express');
const ini = require('./src/express-ini');
const format = require('util').format;
const { readFileSync } = require('fs');

// APP
const app = express();

const config = ini(app);

Object.keys(config.namespaces).forEach((ns) => {
	const obj = {
		namespace: ns,
		token: config.namespaces[ns]
	};
	try {
		obj.publicKey = readFileSync('private/' + ns + '.pem');
	} catch(ex) {
		console.warn("No public key for", ns);
	}
	config.namespaces[ns] = obj;
});

const argv = (process.argv.length == 3 ? process.argv[2] : "0-0")
	.split('-')
	.map((x) => parseInt(x));
if (!argv.length == 2) throw new Error("node app.js <server>-<node>");

config.server = argv[0];
config.node = argv[1];

config.servers = config.servers.map((val) => {
	const list = val.split(' ');
	const hostname = list.shift();
	const nodes = list.map((item) => {
		const itemUrl = new URL(`http://${hostname}`);
		const parts = item.split(':');
		itemUrl.port = parseInt(parts.pop());
		if (parts.length > 0) itemUrl.protocol = parts[0];
		return itemUrl;
	});
	return nodes;
});

config.site = config.servers[config.server][config.node];

const cert = {};

try {
	cert.key = readFileSync(format(`${config.dirs.config}/%s/privkey.pem`, config.site.hostname));
	cert.cert = readFileSync(format(`${config.dirs.config}/%s/fullchain.pem`, config.site.hostname));
} catch (err) {
	console.info("No certificate is available - will only start on http");
}

const server = cert.cert && config.site.protocol == "https:" ?
	require('https').createServer(cert, app)
	:
	require('http').createServer(app);

const acmeRoot = '/.well-known/acme-challenge';
let exitTo;
app.use(
	acmeRoot,
	(req, res, next) => {
		if (!exitTo) {
			console.info("Restart in 30 seconds after new certificate has been installed");
			exitTo = setTimeout(() => {
				process.exit(0);
			}, 30 * 1000);
		}
		next();
	},
	express.static(config.certbotWebroot || "/var/www/certbot"),
	(req, res, next) => {
		console.info("File not found", req.path);
		res.sendStatus(404);
	}
);

require('./src/express.js')(app, server);

process.title = format("ws-%s-%d-%d", app.settings.env, config.server, config.node);
process.on('uncaughtException', (err) => {
	console.error(err.stack || err.message || err);
});

server.listen(config.site.port);

console.info("%s\n%s", process.title, config.site.href);
