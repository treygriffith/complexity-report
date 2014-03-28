#!/usr/bin/env node

/*globals require, process, console, setImmediate */

'use strict';

var options, formatter, state,

reporter = require('./reporter'),
cli = require('commander'),
fs = require('fs'),
path = require('path'),
js = require('escomplex-js'),
check = require('check-types');

parseCommandLine();

state = {
    starting: true,
    openFileCount: 0,
    source: [],
    tooComplex: false,
    failingModules: []
};

expectFiles(cli.args, cli.help.bind(cli));
reporter(cli.args, cli, options, formatter, function (err, report) {

    if(err) {
        if(err.functionName) return error(err.functionName, err);
        return fail(err);
    }

    if(!cli.silent && !check.unemptyString(cli.output)) {
        console.log(report);
    }
});

function parseCommandLine () {
    cli.
        usage('[options] <path>').
        option('-o, --output <path>', 'specify an output file for the report').
        option('-f, --format <format>', 'specify the output format of the report').
        option('-a, --allfiles', 'include hidden files in the report').
        option('-p, --filepattern <pattern>', 'specify the files to process using a regular expression to match against file names').
        option('-P, --dirpattern <pattern>', 'specify the directories to process using a regular expression to match against directory names').
        option('-m, --maxfiles <number>', 'specify the maximum number of files to have open at any point', parseInt).
        option('-F, --maxfod <first-order density>', 'specify the per-project first-order density threshold', parseFloat).
        option('-O, --maxcost <change cost>', 'specify the per-project change cost threshold', parseFloat).
        option('-S, --maxsize <core size>', 'specify the per-project core size threshold', parseFloat).
        option('-M, --minmi <maintainability index>', 'specify the per-module maintainability index threshold', parseFloat).
        option('-C, --maxcyc <cyclomatic complexity>', 'specify the per-function cyclomatic complexity threshold', parseInt).
        option('-Y, --maxcycden <cyclomatic density>', 'specify the per-function cyclomatic complexity density threshold', parseInt).
        option('-D, --maxhd <halstead difficulty>', 'specify the per-function Halstead difficulty threshold', parseFloat).
        option('-V, --maxhv <halstead volume>', 'specify the per-function Halstead volume threshold', parseFloat).
        option('-E, --maxhe <halstead effort>', 'specify the per-function Halstead effort threshold', parseFloat).
        option('-s, --silent', 'don\'t write any output to the console').
        option('-l, --logicalor', 'disregard operator || as source of cyclomatic complexity').
        option('-w, --switchcase', 'disregard switch statements as source of cyclomatic complexity').
        option('-i, --forin', 'treat for...in statements as source of cyclomatic complexity').
        option('-t, --trycatch', 'treat catch clauses as source of cyclomatic complexity').
        option('-n, --newmi', 'use the Microsoft-variant maintainability index (scale of 0 to 100)').
        parse(process.argv);

    options = {
        logicalor: !cli.logicalor,
        switchcase: !cli.switchcase,
        forin: cli.forin || false,
        trycatch: cli.trycatch || false,
        newmi: cli.newmi || false
    };

    if (check.unemptyString(cli.format) === false) {
        cli.format = 'plain';
    }

    if (check.unemptyString(cli.filepattern) === false) {
        cli.filepattern = '\\.js$';
    }
    cli.filepattern = new RegExp(cli.filepattern);

    if (check.unemptyString(cli.dirpattern)) {
        cli.dirpattern = new RegExp(cli.dirpattern);
    }

    if (check.number(cli.maxfiles) === false) {
        cli.maxfiles = 1024;
    }

    try {
        formatter = require('./formats/' + cli.format);
    } catch (err) {
        formatter = require(cli.format);
    }
}

function expectFiles (paths, noFilesFn) {
    if (paths.length === 0) {
        noFilesFn();
    }
}

function error (functionName, err) {
    fail('Fatal error [' + functionName + ']: ' + err.message);
}

function fail (message) {
    console.log(message);
    process.exit(1);
}
