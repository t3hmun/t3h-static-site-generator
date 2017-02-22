'use strict';

const path = require('path');
const md = require('./md');
const pug = require('pug');
const less = require('less');
const effess = require('t3h-fs-helper');

publish(...configure());

/**
 * Manually edit config here. Anything that was a global is now in here.
 * @return {*[]} Config that can be spread for publish call params.
 */
function configure() {
    // Default config, modified by args after.
    let debug = false;
    let outputDir = './t3hmun.github.io';
    let test = false;

    const site = {
        title: 't3hmun',
        description: 't3hmun\'s web log',
        baseUrl: 'https://t3hmun.github.io',
        nav: [
            {url: 'index.html', text: 'Home'},
            {url: 'info.html', text: 'Info'},
            {url: 'archive.html', text: 'Archive'}
        ],
        postDir: 'posts',
        pageDir: 'pages',
        cssDir: 'css',
        jsDir: 'js'
    };

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

    return [site, outputDir, debug, test];
}

/**
 * Fires a load of promises that result in a static site.
 * @param {{}} site - site config, used by pug templates.
 * @param {string} outputDir - Where the complete site will be written.
 * @param {boolean} debug - True to enable debug output.
 * @param {boolean} test - True to avoid minifying.
 * @returns {void}
 */
function publish(site, outputDir, debug, test) {
    // TODO: Move remaining string literals from here to configure().
    let cssOutputDir = path.join(outputDir, site.cssDir);
    let postOutputDir = path.join(outputDir, site.postDir); // Must be relative for url generation.
    let jsOutputDir = path.join(outputDir, site.jsDir);

    // Read files from disk and perform any processing that doesn't rely on other files.
    let templatesLoaded = loadTemplates('./templates', debug);
    let postsLoaded = loadPosts('./posts', postOutputDir, debug);
    let lightCssRendered = renderLessToCss('./css/light.less', !test, debug);
    let darkCssRendered = renderLessToCss('./css/dark.less', !test, debug);
    let jsLoaded = loadJS('./js', debug);

    // Create output directories - don't try doing this in parallel, they both try to create the test dir.
    let createDirs = effess.ensureDirCreated(postOutputDir).then(() => {
        return effess.ensureDirCreated(cssOutputDir);
    }).then(() => {
        return effess.ensureDirCreated(jsOutputDir);
    }).catch((err) => {
        errorAndExit(err);
    });

    // Creation tasks that rely on previously loaded files.
    let postTemplateApplied = Promise.all([postsLoaded, templatesLoaded]).then((tasksResults) => {
        return applyPostTemplates(...tasksResults, site, test, debug);
    });

    // Render and write pages - they require posts for generating the indexes.
    Promise.all([createDirs, postsLoaded]).then((results) => {
        let posts = results[1];
        posts.dir = site.postDir;
        return renderPugPages('./pages', site, posts, test, debug).then((pages) => {
            return effess.writeMany(pages, (page) => {
                return [outputDir, page.fileName, page.html];
            });
        });
    }).catch((err) => {
        errorAndExit(err);
    });

    // Write files.
    let writePosts = Promise.all([postTemplateApplied, createDirs]).then((taskResults) => {
        let [posts] = taskResults;
        return effess.writeMany(posts, (post) => {
            return [postOutputDir, post.urlName, post.html];
        });
    }).catch((err) => {
        errorAndExit(err);
    });

    let writeCSS = Promise.all([lightCssRendered, darkCssRendered, createDirs]).then((results) => {
        let [light, dark] = results;
        let lightPromise = effess.write(cssOutputDir, 'light.css', light.css);
        let darkPromise = effess.write(cssOutputDir, 'dark.css', dark.css);
        return Promise.all([lightPromise, darkPromise]);
    }).catch((err) => {
        errorAndExit(err);
    });

    let writeJS = Promise.all([createDirs, jsLoaded]).then((results) => {
        let result = results[1];
        return effess.writeMany(result, (file) => {
            return [jsOutputDir, file.name, file.data];
        });
    }).catch((err) => {
        errorAndExit(err)
    });

    Promise.all([writePosts, writeCSS, writeJS]).then(() => {
        console.log('Publish complete.');
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
    let files = effess.readFilesInDir(jsDir);
    if(debug){
        files.then((result)=>{
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
    return effess.readFilesInDir(pageDir, (fileName) => fileName.endsWith('.pug')).then((files) => {
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
                let page = {};
                let info = path.parse(file.path);
                page.fileName = info.name + '.html';
                page.html = html;
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
    return effess.read(filePath).then((data) => {
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
    process.exit();
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
    return effess.readFilesInDir(dir, filter).then((files) => {
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
    return effess.readFilesInDir(dir, filter).then((files) => {
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


