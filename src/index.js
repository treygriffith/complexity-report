/*globals module, require */

'use strict';

var Filequeue = require('filequeue'),
    path = require('path'),
    js = require('escomplex-js'),
    merge = require('merge'),
    async = require('async'),
    plainFormatter = require('./formats/plain'),
    check = require('check-types');

module.exports = runReport;

var defaultOptions = {
    output: null,
    allfiles: null,
    dirpattern: null,
    filepattern: new RegExp('\\.js$'),
    maxfiles: 1024,
    maxfod: null,
    maxcost: null,
    maxsize: null,
    minmi: null,
    maxcyc: null,
    maxcycden: null,
    maxhd: null,
    maxhv: null,
    maxhe: null,
    silent: false
};

var defaultJsOptions = {
    logicalor: true,
    switchcase: true,
    forin: false,
    trycatch: false,
    newmi: false
};

var defaultFormatter = plainFormatter;

function runReport (paths, options, jsOptions, formatter, callback) {

    var reporter = new Reporter(paths, options, jsOptions, formatter);

    reporter.run(callback);
}

runReport.Reporter = Reporter;

function Reporter(paths, options, jsOptions, formatter) {
    if(!Array.isArray(paths)) {
        paths = [paths];
    }
    this.paths = paths;
    this.source = [];
    this.options = merge(options, defaultOptions);
    this.jsOptions = merge(jsOptions, defaultJsOptions);
    this.formatter = formatter || defaultFormatter;
    this.fq = new Filequeue(this.options.maxfiles);
}

Reporter.prototype.run = function (callback) {
    if(!this.paths.length) {
        return callback(error('run', 'No paths specified to report on.'));
    }

    this.readFiles(callback);
};

Reporter.prototype.readFiles = function (paths, callback) {
    var reporter = this;

    if(!callback) {
        callback = paths;
        paths = this.paths;
    }

    async.each(paths, function (path, cb) {

        reporter.fq.stat(path, function (err, stat) {
            if(err) {
                return cb(error('readFiles', err));
            }

            if (stat.isDirectory()) {
                if (!reporter.options.dirpattern || reporter.options.dirpattern.test(path)) {
                    reporter.readDirectory(path, cb);
                } else {
                    cb();
                }
            } else if (reporter.options.filepattern.test(path)) {
                reporter.readFile(path, cb);
            } else {
                cb();
            }
        });
    }, callback);
};

Reporter.prototype.readFile = function (filePath, callback) {
    var reporter = this;

    reporter.fq.readFile(filePath, {
        encoding: 'utf8'
    }, function (err, source) {
        if(err) {
            return callback(error('readFile', err));
        }

        if(beginsWithShebang(source)) {
            source = commentFirstLine(source);
        }

        var module = {
            path: filePath,
            source: source
        };

        reporter.source.push(module);

        callback(null, module);
    });
};


Reporter.prototype.readDirectory = function (directoryPath, callback) {
    var reporter = this;

    reporter.fq.readdir(directoryPath, function (err, files) {
        if(err) {
            return callback(error('readDirectory', err));
        }

        reporter.readFiles(files.filter(function (p) {
            return path.basename(p).charAt(0) !== '.' || reporter.options.allfiles;
        }).map(function (p) {
            return path.resolve(directoryPath, p);
        }), callback);
    });
};

Reporter.prototype.analyzeSource = function (callback) {

    var reporter = this,
        result,
        failingModules;

    try {
        result = js.analyse(reporter.source, reporter.jsOptions);

        if (!reporter.options.silent) {
            reporter.writeReports(result, callback);
        }

        failingModules = getFailingModules(result.reports, reporter.options);
        if (failingModules.length > 0) {
            return callback(error('analyzeSource', new Error('Warning: Complexity threshold breached!\nFailing modules:\n' + failingModules.join('\n'))));
        }

        if (isProjectComplexityThresholdSet(reporter.options) && isProjectTooComplex(result, reporter.options)) {
            return callback(error('analysSource', new Error('Warning: Project complexity threshold breached!')));
        }
    } catch (err) {
        callback(error('analyzeSource', err));
    }
};

Reporter.prototype.writeReports = function (result, callback) {

    var formatted = this.formatter.format(result);

    if (!check.unemptyString(this.options.output)) {
        return callback(null, formatted);
    }

    this.fq.writeFile(this.options.output, formatted, {
        format: 'utf8'
    }, function (err) {
        if (err) {
            return callback(error('writeReports', err));
        }
        
        callback(null, formatted);
    });

};

function getFailingModules (reports, options) {
    return reports.reduce(function (failingModules, report) {
        if (
            (isModuleComplexityThresholdSet(options) && isModuleTooComplex(report, options)) ||
            (isFunctionComplexityThresholdSet(options) && isFunctionTooComplex(report, options))
        ) {
            return failingModules.concat(report.path);
        }

        return failingModules;
    }, []);
}

function getFailingModules (reports) {
    return reports.reduce(function (failingModules, report) {
        if (
            (isModuleComplexityThresholdSet() && isModuleTooComplex(report)) ||
            (isFunctionComplexityThresholdSet() && isFunctionTooComplex(report))
        ) {
            return failingModules.concat(report.path);
        }

        return failingModules;
    }, []);
}

function isModuleComplexityThresholdSet (options) {
    return check.number(options.minmi);
}

function isModuleTooComplex (report, options) {
    if (isThresholdBreached(options.minmi, report.maintainability, true)) {
        return true;
    }
}

function isThresholdBreached (threshold, metric, inverse) {
    if (!inverse) {
        return check.number(threshold) && metric > threshold;
    }

    return check.number(threshold) && metric < threshold;
}

function isFunctionComplexityThresholdSet (options) {
    return check.number(options.maxcyc) || check.number(options.maxcycden) || check.number(options.maxhd) || check.number(options.maxhv) || check.number(options.maxhe);
}

function isFunctionTooComplex (report, options) {
    var i;

    for (i = 0; i < report.functions.length; i += 1) {
        if (isThresholdBreached(options.maxcyc, report.functions[i].cyclomatic)) {
            return true;
        }

        if (isThresholdBreached(options.maxcycden, report.functions[i].cyclomaticDensity)) {
            return true;
        }

        if (isThresholdBreached(options.maxhd, report.functions[i].halstead.difficulty)) {
            return true;
        }

        if (isThresholdBreached(options.maxhv, report.functions[i].halstead.volume)) {
            return true;
        }

        if (isThresholdBreached(options.maxhe, report.functions[i].halstead.effort)) {
            return true;
        }
    }

    return false;
}

function isProjectComplexityThresholdSet (options) {
    return check.number(options.maxfod) || check.number(options.maxcost) || check.number(options.maxsize);
}

function isProjectTooComplex (result, options) {
    if (isThresholdBreached(options.maxfod, result.firstOrderDensity)) {
        return true;
    }

    if (isThresholdBreached(options.maxcost, result.changeCost)) {
        return true;
    }

    if (isThresholdBreached(options.maxsize, result.coreSize)) {
        return true;
    }

    return false;
}

function beginsWithShebang (source) {
    return source[0] === '#' && source[1] === '!';
}

function commentFirstLine (source) {
    return '//' + source;
}

function error(fnName, err) {
    err.fnName = fnName;
    return err;
}
