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

module.exports.convert = function (data) {
    return markdownIt.render(data);
};

module.exports.extractFrontmatter = splitJsonAndFile;


/**
 * Splits the Json front-matter from the rest of the file, returns both parts.
 * @param {string} fileContents - The contents of a file with Json front-matter.
 * @return {{file: string, json}} Separated file and json {file, json}.
 */
function splitJsonAndFile(fileContents) {
    let prev = '';
    let open = 0;
    let close = 0;
    let end;

    for (let i = 0, len = fileContents.length; i < len; i++) {
        let current = fileContents[i];
        if (current == '{' && prev != '\\') open++;
        if (current == '}' && prev != '\\') close++;
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
    };
}