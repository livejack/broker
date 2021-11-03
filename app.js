// always resolve paths relative to app.js directory
process.chdir(__dirname);

const express = require('express');
const ini = require('./src/express-ini');
const format = require('util').format;
const { readFileSync, mkdirSync } = require('fs');

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
	const certPath = `${config.dirs.config}/${config.site.hostname}`;
	mkdirSync(certPath, { recursive: true });
	cert.key = readFileSync(`${certPath}/privkey.pem`);
	cert.cert = readFileSync(`${certPath}/fullchain.pem`);
} catch (err) {
	console.info("No certificate is available - will only start on http", err.toString());
}

const server = cert.cert && config.site.protocol == "https:" ?
	require('https').createServer(cert, app)
	:
	require('http').createServer(app);

if (config.certbot && config.certbot.webroot) {
	const acmeRoot = '/.well-known/acme-challenge';
	console.info("Listening for acme challenges:", config.certbot.webroot);
	let exitTo;
	app.use(
		acmeRoot,
		(req, res, next) => {
			if (!exitTo) {
				exitTo = setTimeout(() => {
					console.info("Restarting after successful certbot renew");
					process.exit(0);
				}, (parseInt(config.certbot.timeout) || 15) * 1000);
			}
			next();
		},
		express.static(config.certbot.webroot),
		(req, res, next) => {
			if (exitTo) {
				clearTimeout(exitTo);
				exitTo = null;
			}
			console.info("File not found", req.path);
			res.sendStatus(404);
		}
	);
}

require('./src/express.js')(app, server);

process.title = format("ws-%s-%d-%d", app.settings.env, config.server, config.node);
process.on('uncaughtException', (err) => {
	console.error(err.stack || err.message || err);
});

server.listen(config.site.port);

console.info("%s\n%s", process.title, config.site.href);
