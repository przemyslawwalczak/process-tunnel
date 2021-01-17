"use strict";
exports.__esModule = true;
var Tunnel = require("../lib");
var path = require("path");
var cluster = require("cluster");
if (cluster.isMaster) {
    console.log('master pid:', process.pid);
    new Tunnel.Server()
        .setContext({
        ca: [path.join(process.cwd(), 'ssl', 'cert.pem')],
        cert: path.join(process.cwd(), 'ssl', 'cert.pem'),
        key: path.join(process.cwd(), 'ssl', 'key.pem')
    })
        .listen(8082, 'localhost')
        .then(function (server) {
        console.log(server.address());
    })["catch"](function (e) {
        console.log(e);
    });
    for (var i = 0; i < 2; i++) {
        cluster.fork();
    }
}
else {
    console.log('fork pid:', process.pid);
    new Tunnel.Server()
        .listen(8082, 'localhost')
        .then(function (server) {
        console.log(server.address());
        setInterval(function () {
            var array = [50, 60, 70];
            server.map('hello.world', array)
                .then(function (result) {
                console.log('returned result:', result);
            })["catch"](function (e) {
                console.log('message not sent:', e);
            });
        }, 5000);
    })["catch"](function (e) {
        console.log(e);
    });
}
