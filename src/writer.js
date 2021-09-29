const ioclient = require('socket.io-client');
const got = require('got');
const jwt = require('jsonwebtoken');

// if node > 0 connect to node 0 room * as a slave
// and broadcast all messages that come from that slave to its own nsp

// if node == 0 accept authorized messages and broadcast them

exports.master = function(nsp, namespace, config) {
	// connect clients of this node to namespace room
	const nsconfig = config.namespaces[namespace];
	nsp.on('connection', function(socket) {
		socket.on('join', function(data) {
			if (!data.room) {
				return console.error("Need a room to join " + JSON.stringify(data));
			}
			if (socket.backlog) {
				socket.backlog(data.mtime);
			}
			if (data.bearer) {
				initScopes(socket, data.bearer, nsconfig, data.room, function(err) {
					if (err) {
						// errors do not prevent from joining room
						if (err.name == 'TokenExpiredError') {
							console.info("token expired", namespace);
						} else {
							console.error(err);
						}
					}
					socket.join(data.room);
				});
			} else {
				socket.join(data.room);
			}
		});
		socket.on('leave', function(data) {
			socket.leave(data.room);
		});
		// messages written to this master node are distributed to its rooms,
		// to slave nodes (by the same canal), and using POST to other master nodes
		socket.on('message', function(msg) {
			if (!socket.request._query) {
				return console.error("_query object has disappeared");
			}
			const room = getRoom(msg);
			if (!room) {
				return console.warn("Cannot write message without room");
			}
			if (!checkScopes(socket.request.scopes, room, msg.scopes) &&
			socket.request._query.token != nsconfig.token) {
				return console.warn("Permission denied to write", msg);
			}
			// why socket.to(...) does not work here is a mistery to me
			if (!msg.mtime) {
				// nsocket is the clock
				msg.mtime = (new Date()).toISOString();
			}
			setImmediate(function() {
				nsp.to('*').to(room).emit('message', msg);
				balance(msg, namespace, config);
			});
		});
	});
};

exports.slave = function(nsp, namespace, config) {
	// listen to master messages and write message to clients in namespace room
	const nsconfig = config.namespaces[namespace];
	const clientUrl = new URL(config.servers[config.server][0]);
	clientUrl.pathname = namespace;
	const client = ioclient(clientUrl.href);

	client.on('connect', function() {
		client.emit('join', {room: '*'});
	});

	client.on('connect_error', function(err) {
		if (err) console.error(err);
	});

	client.on('message', function(msg) {
		const room = getRoom(msg);
		if (room) {
			setImmediate(function() {
				nsp.to('*').to(room).emit('message', msg);
			});
		} else {
			console.warn("Cannot route message without room");
		}
	});

	client.on('error', function(err) {
		if (err) console.error("Error in client", err);
	});

	nsp.on('connection', function(socket) {
		// connect clients of this node to namespace room
		socket.on('join', function(data) {
			if (socket.backlog) socket.backlog(data.mtime);
			//if (data.bearer) {
			//	initScopes(socket, data.bearer, nsconfig, data.room, function(err) {
			//		if (err) console.error(err); // errors do not prevent from joining room
			//		socket.join(data.room);
			//	});
			//} else {
			socket.join(data.room);
			//}
		});
		socket.on('leave', function(data) {
			socket.leave(data.room);
		});
		socket.on('message', function(msg) {
			if (!socket.request._query) {
				return console.error("_query object has disappeared");
			}
			const room = getRoom(msg);
			if (!room) {
				return console.warn("Cannot write message without room");
			}
			if (!checkScopes(socket.request.scopes, room, msg.scopes) &&
			socket.request._query.token != nsconfig.token) {
				return console.warn("Permission denied to write", msg);
			}
			// why socket.to(...) does not work here is a mistery to me
			if (!msg.mtime) {
				// nsocket is the clock
				msg.mtime = (new Date()).toISOString();
			}
			setImmediate(function() {
				balance(msg, namespace, config);
			});
		});
	});
};

exports.post = function(spaces) {
	return function(req, res, next) {
		const config = req.app.settings;
		const namespace = req.params.namespace;
		const msg = req.body;
		if (!msg) {
			return res.status(400).send("Missing message");
		}
		if (!namespace) {
			return res.status(400).send("Missing namespace query parameter");
		}
		const nsconfig = config.namespaces[namespace];
		if (!nsconfig) {
			return res.status(400).send("Unknown namespace");
		}
		if (nsconfig.token != req.query.token) {
			return res.status(401).send("Missing or wrong authorization");
		}
		const nsp = spaces[namespace];
		if (!nsp) {
			return res.sendStatus(503);
		}
		const room = getRoom(msg);
		if (!room) {
			return res.status(400).send("Message received without room");
		}

		if (!msg.mtime) {
			// nsocket is the clock
			msg.mtime = Date.now();
			res.status(200).send({mtime: msg.mtime});
		} else {
			res.sendStatus(204);
		}
		setImmediate(function() {
			// write message to this node room
			if (config.node == 0) nsp.to('*').to(room).emit('message', msg);
			// balance to other master nodes if needed
			if (!req.query.balanced) {
				balance(msg, namespace, config);
			}
		});
	};
};

function balance(msg, namespace, config) {
	if (!config.servers || config.servers.length == 0) return;
	const us = config.servers[config.server][config.node];
	const cns = config.namespaces[namespace];
	return Promise.all(config.servers.map(function(item) {
		const server = item[0];
		if (server.href == us.href) return Promise.resolve();
		const clientUrl = new URL(server);
		clientUrl.pathname = namespace;
		clientUrl.searchParams.set('token', cns.token);
		clientUrl.searchParams.set('balanced', 'true');
		clientUrl.searchParams.set('from', config.server);
		return got.post(clientUrl, {
			timeout: parseInt(config.btimeout) || 10000,
			json: msg
		}).catch(function(err) {
			console.error("Balance error to", url, err);
			cns.errors++;
		});
	}));
}

function getRoom(msg) {
	let room;
	if (msg.parents) {
		// compatibility with raja
		room = msg.parents[msg.parents.length - 1];
	}
	if (!room) {
		if (msg.key) {
			// compatibility with old broker version
			room = msg.key;
		} else {
			// this is current version
			room = msg.room;
		}
	}
	return room;
}

function checkScopes(socketScopes, room, scopes) {
	if (!socketScopes) return false;
	const rscopes = socketScopes[room];
	if (!rscopes) return false;
	scopes = scopes || ["public"];
	// make sure socket has write permissions for all those scopes
	return scopes.every(function(scope) {
		const perms = rscopes[scope];
		if (!perms) return false;
		return perms.add || perms.write;
	});
}

function initScopes(socket, bearer, nsconfig, room, cb) {
	// wrong assumption: socket.scopes is populated when joining a room,
	// where it should be populated upon connection
	if (!nsconfig.publicKey) return cb("No public key for that namespace " + nsconfig.namespace);
	jwt.verify(bearer, nsconfig.publicKey, {
		algorithm: 'RS256',
		issuer: nsconfig.namespace
	}, function(err, obj) {
		if (err) return cb(err);
		const scopes = obj.scopes;
		if (!scopes) return cb();
		let spocks = socket.request.scopes;
		if (!spocks) spocks = socket.request.scopes = {};
		const rscopes = spocks[room] || {};
		// handle expiration
		const expiration = parseInt(obj.exp);
		if (!Number.isNaN(expiration)) { // do not handle expiration for now
			if (rscopes.deletion) {
				clearTimeout(rscopes.deletion);
				delete rscopes.deletion;
			}
			const delay = expiration * 1000 - Date.now();
			if (delay > 0) rscopes.deletion = setTimeout(function() {
				delete rscopes.deletion;
				delete spocks[room];
			}, delay);
		}
		spocks[room] = scopes;
		cb();
	});
}
