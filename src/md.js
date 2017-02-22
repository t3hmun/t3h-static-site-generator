'use strict';

const markdownItOptions = {
    highlight: function (str, lang) {
        if (lang && highlightJs.getLanguage(lang)) {
            try {
                return highlightJs.highlight(lang, str).value;
            }
            catch (err) {
                console.log('markdownIt highlight error');
                console.log(err);
                process.exit();
            }
        }
        return ''; // use external default escaping
    }
};

const highlightJs = require('highlight.js');
const markdownIt = require('markdown-it')(markdownItOptions);

module.exports.convert = function(data){
    return markdownIt.render(data);
};

module.exports.extractFrontmatter = splitJsonAndFile;

/**
 * Splits the Json front-matter from the rest of the file, returns both parts.
 * @param fileContents - The contents of a file with Json front-matter.
 * @returns {{}} Separated file and json {file, json}.
 */
function splitJsonAndFile(fileContents){
    var prev = '';
    var open = 0;
    var close = 0;
    var end;

    for (var i = 0, len = fileContents.length; i < len; i++) {
        let current = fileContents[i];
        if (current == "{" && prev != '\\') open++;
        if (current == "}" && prev != '\\') close++;
        if (open == close) {
            end = i;
            break;
        }
        prev = current;
    }

    let data = fileContents.slice(end + 1);
    let front = fileContents.slice(0, end + 1);

    return {
        file: data,
        json: JSON.parse(front)
    }
}