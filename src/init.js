'use strict';

/**
 * Initialises a folder for the web-log generator.
 */

const path = require('path');
const t3hfs = require('t3h-fs-helper');
const pub = require('./pub.js');
const CONFIG_FILE_NAME = pub.CONFIG_FILE_NAME;


go();

/**
 * Creates default config if missing, otherwise reads config and creates dirs.
 */
function go() {
    let debug = false;

    if (process.argv.length > 2) {
        if (process.argv.find((e) => e == 'debug')) {
            debug = true;
            debug && console.log(' Debug-mode on.');
        }
    }

    t3hfs.read(CONFIG_FILE_NAME).then((conf) => {
        let site;
        try {
            site = JSON.parse(conf);
        } catch (err) {
            logAndQuit(err)
        }
        debug && console.log(site);

        createDirs(site, debug)

    }).catch((err) => {
        if (err.code == 'ENOENT') {
            let conf = pub.generateDefaultConfig();
            t3hfs.write('./', CONFIG_FILE_NAME, conf).then(() => {
                console.log('Default config written. Please modify and then run createDirs again.');
            }).catch((err) => {
                logAndQuit(err)
            });
        } else {
            logAndQuit(err);
        }
    });
}

/**
 * Logs an error and kills the node process.
 * @param err - The error.
 */
function logAndQuit(err) {
    console.log(err);
    process.exit(1);
}

/**
 * Creates the folders in the config.
 * @param site - Site config, the parsed config.json.
 * @param debug - Debug output setting.
 */
function createDirs(site, debug) {

    // Create dirs one after another.
    // Do not do in parallel otherwise super-dir creation can collide and fail.
    let chain = Promise.resolve();
    let dirs = site.inputDir.dirs;
    Object.keys(dirs).forEach((key) => {
        let fullDir = path.join(site.inputDir.dir, dirs[key]);
        chain = chain.then(() => {
            return t3hfs.ensureDirCreated(fullDir).then(() => {
                debug && console.log('created ' + fullDir)
            }).catch((err) => {
                logAndQuit(err)
            })
        });
    });
}