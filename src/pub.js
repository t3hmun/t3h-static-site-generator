'use strict';

/*
 * Copyright 2017 t3hmun (Manish Parekh)
 *
 * This file is part of t3h-static-site-generator.
 *
 *     t3h-static-site-generator is free software: you can redistribute it
 * and/or modify it under the terms of the GNU General Public License as
 * published by the Free Software Foundation, either version 3 of the License,
 * or (at your option) any later version.
 *
 *     t3h-static-site-generator is distributed in the hope that it will be
 * useful, but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU General
 * Public License for more details.
 *
 *     You should have received a copy of the GNU General Public License along
 * with t3h-static-site-generator. If not, see <http://www.gnu.org/licenses/>.
 */

/**
 * This is the main publishing code, most of everything is done here.
 */

const path = require('path');
const md = require('./md');
const pug = require('pug');
const less = require('less');
const t3hfs = require('t3h-fs-helper');

const CONFIG_FILE_NAME = 'config.json';

module.exports.generateDefaultConfig = generateDefaultConfig;
module.exports.publish = publish;
module.exports.CONFIG_FILE_NAME = CONFIG_FILE_NAME;


/**
 * Generates a default template config.
 * WebStorm/Intellij pulls the template for the site object type from here.. somehow.
 * @return {string} - JSON of the site config.
 */
function generateDefaultConfig() {
    let site = {
        title: 'a neat site',
        description: 'a rather neat site',
        baseUrl: 'https://t3hmun.github.io',
        nav: [
            {url: 'index.html', text: 'Home'},
            {url: 'info.html', text: 'Info'},
            {url: 'archive.html', text: 'Archive'}
        ],
        testDir: './preview',
        outputDir: {
            dir: './pages',
            dirs: {
                content: './',
                js: 'js',
                css: 'css',
                posts: 'posts'
            }
        },
        inputDir: {
            dir: './input',
            dirs: {
                posts: 'posts',
                templates: 'templates',
                css: 'css',
                js: 'js',
                content: 'content'
            }
        },
        lessFilesToOutput: [['main.less', 'main.css']]
    };

    return JSON.stringify(site, null, 4);
}

/**
 * Loads the config from a JSON file and modifies it based on process args.
 * @return {Promise.<[]>} - [site, debug, test]
 */
function loadConfig() {
    return t3hfs.read(CONFIG_FILE_NAME).then((conf) => {
        let site;
        try {
            site = JSON.parse(conf);
        } catch (err) {
            errorAndExit(err);
        }
        return site;
    }).catch((err) => {
        errorAndExit(err);
    }).then((site) => {
        let debug = false;
        let test = false;

        if (process.argv.length > 2) {
            console.log('Config:');
            if (process.argv.find((e) => e == 'debug')) {
                debug = true;
                debug && console.log(' Debug-mode on.');
            }
            if (process.argv.find((e) => e == 'test')) {
                test = true;
                // Fully resolved path allows testing without server.
                site.baseUrl = 'file:///' + path.resolve(site.testDir);
                // Replace outputDir with testDir.
                site.outputDir.dir = site.testDir;

                debug && console.log('test outputDir=' + site.outputDir.dir);
                console.log(' Test mode activated.');
            }
            console.log('');
        }

        return [site, debug, test];
    });
}

/**
 * Fires a load of promises that result in a static site.
 * @returns {void}
 */
function publish() {
    let site, debug, test;
    loadConfig().then((conf) => {
        [site, debug, test] = conf;
        // Creating the folders and resolving their names must be done first.
        return resolveAndCreateDirs(site.inputDir, debug);
    }).then(() => {
        // Creating dirs must not be done in parallel because they may share a common base dir.
        return resolveAndCreateDirs(site.outputDir, debug);
    }).then(() => {
        // Some things within this block may occur in parallel.
        // Everything is ordered by chaining onto the promises that the step relies on.

        // # A note on output dirs
        // Output dirs have 2 purposes, define where to write the files, and help name links in pages.
        // Writing: outputDir + outputDir.dirs[x] + filename
        // Linking: baseUrl + outputDir.dirs[x] + filename
        // Relative linking:  outputDir.dirs[x] + filename
        // The outputDir is just the location on the dev computer to put the files.
        // The outputDir.dirs[x] is the location on the server after the baseUrl.
        // Therefore outputDir.full[x] is for writing files, the outputDir.dirs[x] is for link generation.
        // For input dirs only the full dirs are useful.

        let inDirs = site.inputDir.full;
        let linkOutDirs = site.outputDir.dirs;
        let writeOutDirs = site.outputDir.full;

        // Read files from disk and perform any processing that doesn't rely on other files.
        let templatesLoaded = loadTemplates(inDirs.templates, debug);
        let postsLoaded = loadPosts(inDirs.posts, linkOutDirs.posts, debug);
        let cssRendering = site.lessFilesToOutput.map((cssFile) => {
            return renderLessToCss(path.join(inDirs.css, cssFile[0]), !test, debug);
        });
        let jsLoaded = loadJS(inDirs.js, debug);

        // Creation tasks that rely on previously loaded files.
        let postTemplateApplied = Promise.all([postsLoaded, templatesLoaded]).then((tasksResults) => {
            return applyPostTemplates(...tasksResults, site, test, debug);
        });

        // Render and write pages - they require posts for generating the indexes.
        postsLoaded.then((posts) => {
            // This is for generating indexes in the pages.
            posts.dir = linkOutDirs.posts;
            return renderPugPages(inDirs.content, site, posts, test, debug).then((pages) => {
                let writeArr = Array.from(pages, (item) => {
                    return [writeOutDirs.content, item.fileName, item.html];
                });

                return t3hfs.writeMany(writeArr);
            });
        }).catch((err) => {
            errorAndExit(err);
        });

        // Write files.
        let writePosts = postTemplateApplied.then((posts) => {
            let writeArr = Array.from(posts, (item) => {
                return [writeOutDirs.posts, item.urlName, item.html];
            });
            return t3hfs.writeMany(writeArr);
        }).catch((err) => {
            errorAndExit(err);
        });

        let writeCSS = Promise.all(cssRendering).then((results) => {
            let written = [];
            for (let i = 0; i < site.lessFilesToOutput.length; i++) {
                // index [1] is the output file name.
                written.push(t3hfs.write(writeOutDirs.css, site.lessFilesToOutput[i][1], results[i].css));
            }
            return Promise.all(written);
        }).catch((err) => {
            errorAndExit(err);
        });

        let writeJS = jsLoaded.then((jsFiles) => {
            let writeArr = Array.from(jsFiles, (item) => {
                return [writeOutDirs.js, item.name, item.data];
            });
            return t3hfs.writeMany(writeArr);
        }).catch((err) => {
            errorAndExit(err);
        });

        Promise.all([writePosts, writeCSS, writeJS]).then(() => {
            console.log('Publish complete.');
        });
    });
}

/**
 * @typedef {Object} DirObject
 * @property {string} dir - The dir containing the dirs in the dirs property.
 * @property {{}} dirs - The unresolved dirs properties from the config file.
 * @property {{}} [full] - Copy of dirs modified to have dir joined to the front of each value.
 */

/**
 *
 * @param {DirObject} dirObject - Object representing dir and sub-dirs.
 * @param {boolean} debug - debug output flag.
 * @return {Promise} - Promise on completion of making and resolving dirs.
 */
function resolveAndCreateDirs(dirObject, debug) {

    // Create dirs one after another.
    // Do not do in parallel otherwise super-dir creation can collide and fail.
    debug && console.log('Start resolve:');
    debug && console.log(dirObject);
    let chain = Promise.resolve();
    let dirs = dirObject.dirs;
    let full = dirObject.full = {};
    Object.keys(dirs).forEach((key) => {
        let fullDir = path.join(dirObject.dir, dirs[key]);
        full[key] = fullDir;
        chain = chain.then(() => {
            return t3hfs.ensureDirCreated(fullDir).then(() => {
                debug && console.log('created ' + key + ': ' + fullDir);
            }).catch((err) => {
                errorAndExit(err);
            });
        });
    });

    return chain.then(() => {
        debug && console.log('End resolve:');
        debug && console.log(dirObject);
    });
}

/**
 * Read all the files from the JS dir. Doesn't do anything else yet.
 * @param {string} jsDir - Directory containing the js files.
 * @param {boolean} debug - True enables debug mode.
 * @return {Promise<{}[]>} - List of {name, path, dir, data} objects.
 */
function loadJS(jsDir, debug) {
    // This could have a minify step but I don't have enough js to bother.
    let files = t3hfs.readFilesInDir(jsDir);
    if (debug) {
        files.then((result) => {
            console.log(`loaded ${result.length} js files`);
        });
    }
    return files;
}

/**
 * Renders the non-post pages of the website from Pug.
 * @param {string} pageDir - Folder containing pug pages.
 * @param {{}} site - Site vars.
 * @param {{}[]} posts - All the posts, used for index generating.
 * @param {boolean} test - True enables test mode, makes the HTML pretty.
 * @param {boolean} debug - True enables debug output.
 * @return {Promise<{}[]>} - List of {html, fileName}.
 */
function renderPugPages(pageDir, site, posts, test, debug) {
    debug && console.log('Rendering pug pages ...');
    return t3hfs.readFilesInDir(pageDir, (fileName) => fileName.endsWith('.pug')).then((files) => {
        let options = {
            site: site,
            posts: posts,
            pretty: test
        };

        let renders = [];
        files.forEach((file) => {
            renders.push(new Promise((resolve) => {
                options.filename = file.path;
                let html = pug.render(file.data, options, undefined);
                let info = path.parse(file.path);
                let page = {
                    fileName: info.name + '.html',
                    html: html
                };
                resolve(page);
            }));
        });
        debug && console.log('... rendered pug pages.');
        return Promise.all(renders);
    });
}

/**
 * Apply templates to posts.
 * @param {[]} posts - Posts with all their information.
 * @param {[]} templates - Name and compiled pug function {name, func}.
 * @param {{}} site - Lots of site info (see pug templates).
 * @param {boolean} test - True enables test mode, avoid minifying anything.
 * @param {boolean} debug - True enables debug output.
 * @return {Promise<[]>} - The posts, each with a .html property representing the final file data.
 */
function applyPostTemplates(posts, templates, site, test, debug) {
    debug && console.log('Applying post templates ...');
    return new Promise((resolve, reject) => {
        let postTemplate = templates.find((e) => e.name == 'post');
        try {
            posts.forEach((post) => {
                // The post template is just the contents of the main tag of the article page.
                post.html = postTemplate.func({
                    filename: post.fileName,
                    site: site,
                    page: post,
                    content: post.html,
                    pretty: test // neat output for test mode.
                });
            });
        } catch (err) {
            reject(err);
            return;
        }
        resolve(posts);
        debug && console.log('... applied post templates.');
    });
}

/**
 * Renders a LESS file to CSS, returning it as a string. Assumes all imports are in-lined so single file output.
 * @param {string} filePath - Less file path.
 * @param {boolean} compress - True to minify output.
 * @param {boolean} debug - True for debug output mode.
 * @return {Promise<string>} - Promise of the final CSS file contents.
 */
function renderLessToCss(filePath, compress, debug) {
    debug && console.log('Rendering CSS from LESS...');
    return t3hfs.read(filePath).then((data) => {
        let lessOptions = {
            filename: path.resolve(filePath),
            paths: path.parse(filePath).dir,
            compress: compress
        };
        // Is a promise that returns the CSS.
        debug && console.log('... rendered CSS from LESS.');
        return less.render(data, lessOptions);
    });
}


/**
 * Quickly display error and crash. Fatal errors only.
 * @param  {Error} err - The error.
 * @returns {void} - Never (exits).
 */
function errorAndExit(err) {
    console.log(err);
    process.exit(1);
}


/**
 * Loads all pug templates from specified dir.
 * @param {string} dir - Path of the dir containing templates, not recursive.
 * @param {boolean} debug - Enable debug output (default false).
 * @returns {Promise.<{}[]>} - List of {name, compiledPugFunction} in a promise.
 */
function loadTemplates(dir, debug) {
    debug && console.log('Loading templates ...');
    let filter = (fileName) => fileName.endsWith('.pug');
    return t3hfs.readFilesInDir(dir, filter).then((files) => {
        let templates = [];
        try {
            files.forEach((file) => {
                let options = {
                    filename: file.path,
                    compileDebug: debug
                };
                // The inspection here is broken, Options type is undefined.
                //noinspection JSCheckFunctionSignatures
                let template = pug.compile(file.data, options);
                templates.push({
                    name: path.parse(file.path).name, //removes ext
                    func: template
                });
            });
        } catch (err) {
            return Promise.reject(err);
        }
        debug && console.log('... templates loaded.');
        return Promise.resolve(templates);
    });
}

/**
 * @typedef {Object} PathParse - path.parse(file) output.
 * @property {string} root
 * @property {string} dir
 * @property {string} base
 * @property {string} ext
 * @property {string} name
 */

/**
 * @typedef {Object} Post
 * @property {string} html - File contents.
 * @property {string} filePath
 * @property {string} fileName
 * @property {string} title
 * @property {Date} date
 * @property {string} url
 * @property {string} urlName
 * @property {PathParse} file
 */

/**
 * Loads posts from dir, reads info and converts md.
 * @param {string} dir - Dir to load posts from, not recursive.
 * @param {string} linkOutputDir - Needed for generating the url.
 * @param {boolean} debug - Enable debug output (default false).
 * @return {Promise.<{Post}[]>} - List of {html, filePath, fileName, title, date, url, urlName}, the urls have spaces
 * replaced.
 */
function loadPosts(dir, linkOutputDir, debug) {
    debug && console.log('Loading posts ...');
    let filter = (fileName) => fileName.endsWith('.md');
    return t3hfs.readFilesInDir(dir, filter).then((files) => {
        let posts = [];
        files.forEach((file) => {
            let mdContent;
            let post;
            if (file.data.startsWith('{')) {
                let res = md.extractFrontmatter(file.data);
                post = res.json;
                mdContent = res.file;
                debug && console.log(post.description);
            } else {
                post = {};
                mdContent = file.data;
            }

            post.filePath = file.path;
            post.fileName = file.name;
            post.html = md.convert(mdContent);

            setPostDateTitleInfo(post, debug);
            post.url = path.join(linkOutputDir, post.urlName);
            posts.push(post);
        });
        debug && console.log('... posts loaded.');
        return posts;
    });
}

/**
 * Extracts title and date from filename, makes filename url friendly.
 * @param {Post} post - The post that will have properties added.
 * @param {boolean} debug - Debug mode on, activates verbose output.
 * @returns {void}
 */
function setPostDateTitleInfo(post, debug) {
    let info = path.parse(post.filePath);
    post.file = info;
    let div = info.name.indexOf('_');
    let dateStr = info.name.slice(0, div);
    post.date = new Date(dateStr);
    post.title = info.name.slice(div + 1);
    // Urls are not fun with spaces or commas.
    let spacesReplaced = info.name.replace(/[\s.]/g, '-');
    // This replace is very custom to my web-log.
    let sharpReplaced = spacesReplaced.replace(/#/g, 'Sharp');
    let badWebUrlCharsRemoved = sharpReplaced.replace(/[£$%^&()+=,\[\]]/g, '');
    debug && console.log(badWebUrlCharsRemoved);
    post.urlName = badWebUrlCharsRemoved + '.html';
}


