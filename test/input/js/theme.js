'use strict';
window.onload = function () {
    document.getElementById('theme-button').onclick = function () {
        let mainCssEle = document.getElementById('main-css');
        let cssUrl = mainCssEle.getAttribute('href');
        if(cssUrl.endsWith('dark.css'))
            cssUrl = cssUrl.replace('dark', 'light');
        else
            cssUrl = cssUrl.replace('light', 'dark');
        mainCssEle.setAttribute('href', cssUrl);
    }
};