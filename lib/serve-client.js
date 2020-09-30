var zlib = require('zlib');
var accepts = require('accepts');
var readSync = require('fs').readFileSync;

var clientVersion = require('socket.io-client/package').version;
var lastModified = new Date().toUTCString();
var clientSource = require('uglify-js').minify(
	readSync(require.resolve('socket.io-client/dist/socket.io.slim.js')).toString()
).code;
var clientSourceGz = zlib.gzipSync(clientSource, {level: zlib.Z_BEST_COMPRESSION});
var clientSourceDfl = zlib.deflateSync(clientSource, {level: zlib.Z_BEST_COMPRESSION});

// every six hours, set expiration 12 hours later
var expires;
expiration();

function expiration() {
	expires = new Date(Date.now() + 1000 * 3600 * 12).toUTCString();
}

setInterval(expiration, 1000 * 3600 * 6);

module.exports = function(req, res) {
	var etag = req.headers['if-none-match'];
	if (etag) {
		if (clientVersion == etag) {
			res.writeHead(304);
			res.end();
			return;
		}
	}
	var method = accepts(req).encoding('gzip', 'deflate');
	var data;
	if (method == 'gzip') {
		res.setHeader('Content-Encoding', 'gzip');
		data = clientSourceGz;
	} else if (method == 'deflate') {
		res.setHeader('Content-Encoding', 'deflate');
		data = clientSourceDfl;
	} else {
		data = clientSource;
	}

	res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
	res.setHeader('ETag', clientVersion);
	res.setHeader('Expires', expires);
	res.writeHead(200);
	res.end(data);

};

