'use strict';

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
        testDir: './offline-test',
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
            dir: './',
            dirs: {
                posts: 'posts',
                templates: 'templates',
                css: 'css',
                js: 'js',
                content: 'content'
            }
        }
    };

    return JSON.stringify(site, null, 4);
}

/**
 *
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
        errorAndExit(err)
    }).then((site) => {
        let debug = false;
        let outputDir = site.outputDir;
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
                site.baseUrl = 'file:///' + path.resolve('./test');
                outputDir = path.resolve('./test');
                debug && console.log('test outputDir=' + outputDir);
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
    loadConfig().then((conf) => {
        let [site, debug, test] = conf;

        // vars with names in past-tense are promises.
        let dirsCreated = resolveAndCreateDirs(site.inputDir).then(
            resolveAndCreateDirs(site.outputDir));

        let outDirs = site.outputDir.dirs;
        let inDirs = site.inputDir.dirs;

        // Read files from disk and perform any processing that doesn't rely on other files.
        let templatesLoaded = dirsCreated.then(loadTemplates(inDirs.templates, debug));
        let postsLoaded = dirsCreated.then(loadPosts(inDirs.posts, outDirs.posts, debug));
        // TODO: Issue #13 autodetect the correct less files.
        let lightCssRendered = dirsCreated.then(renderLessToCss('./css/light.less', !test, debug));
        let darkCssRendered = dirsCreated.then(renderLessToCss('./css/dark.less', !test, debug));
        let jsLoaded = dirsCreated.then(loadJS(inDirs.js, debug));

        // Creation tasks that rely on previously loaded files.
        let postTemplateApplied = Promise.all([postsLoaded, templatesLoaded]).then((tasksResults) => {
            return applyPostTemplates(...tasksResults, site, test, debug);
        });

        // Render and write pages - they require posts for generating the indexes.
        Promise.all([dirsCreated, postsLoaded]).then((results) => {
            let posts = results[1];
            posts.dir = outDirs.posts;
            return renderPugPages(inDirs.content, site, posts, test, debug).then((pages) => {
                let writeArr = Array.from(pages, (item) => {
                    return [outDirs.content, item.fileName, item.html]
                });
                return t3hfs.writeMany(writeArr);
            });
        }).catch((err) => {
            errorAndExit(err);
        });

        // Write files.
        let writePosts = Promise.all([postTemplateApplied, createDirs]).then((taskResults) => {
            let [posts] = taskResults;
            let writeArr = Array.from(posts, (item) => {
                return [outDirs.posts, item.urlName, item.html]
            });
            return t3hfs.writeMany(writeArr);
        }).catch((err) => {
            errorAndExit(err);
        });

        let writeCSS = Promise.all([lightCssRendered, darkCssRendered, createDirs]).then((results) => {
            let [light, dark] = results;
            let lightPromise = t3hfs.write(cssOutputDir, 'light.css', light.css);
            let darkPromise = t3hfs.write(cssOutputDir, 'dark.css', dark.css);
            return Promise.all([lightPromise, darkPromise]);
        }).catch((err) => {
            errorAndExit(err);
        });

        let writeJS = Promise.all([createDirs, jsLoaded]).then((results) => {
            let result = results[1];
            return t3hfs.writeMany(result, (file) => {
                return [jsOutputDir, file.name, file.data];
            });
        }).catch((err) => {
            errorAndExit(err)
        });

        Promise.all([writePosts, writeCSS, writeJS]).then(() => {
            console.log('Publish complete.');
        });
    });
}

/**
 *
 * @param dirObject
 * @param debug - debug output flag.
 * @return {Promise.<>}
 */
function resolveAndCreateDirs(dirObject, debug) {

    // Create dirs one after another.
    // Do not do in parallel otherwise super-dir creation can collide and fail.
    debug && console.log(dirObject);
    let chain = Promise.resolve();
    let dirs = dirObject.dirs;
    Object.keys(dirs).forEach((key) => {
        let fullDir = path.join(dirObject.dir, dirs[key]);
        dirs[key] = fullDir;
        chain = chain.then(() => {
            return t3hfs.ensureDirCreated(fullDir).then(() => {
                debug && console.log('created ' + fullDir)
            }).catch((err) => {
                errorAndExit(err);
            })
        });
    });

    return chain.then(() => {
        debug && console.log(dirObject)
    });
}

/**
 * Read all the files from the JS dir. Doesn't do anything else yet.
 * @param jsDir - Directory containing the js files.
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
                let html = pug.render(file.data, options);
                let info = path.parse(file.path);
                let page = {
                    filename: info.name + 'html',
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
                let options = {filename: file.path}; // Only needed to add detail to errors.
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
 * Loads posts from dir, reads info and converts md.
 * @param {string} dir - Dir to load posts from, not recursive.
 * @param {string} outputDir - Needed for generating the url.
 * @param {boolean} debug - Enable debug output (default false).
 * @return {Promise.<{}[]>} - List of {html, filePath, fileName, title, date, url, urlName}, the urls have spaces
 * replaced.
 */
function loadPosts(dir, outputDir, debug) {
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
            post.url = path.join(outputDir, post.urlName);
            posts.push(post);
        });
        debug && console.log('... posts loaded.');
        return posts;
    });
}

/**
 * Extracts title and date from filename, makes filename url friendly.
 * @param {{}} post - The post that will have properties added.
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


