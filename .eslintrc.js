module.exports = {
    "env": {
        "es6": true,
        "node": true
    },
    "extends": "eslint:recommended",
    "rules": {
        "no-console": "off",
        "indent": [
            "error",
            4
        ],
        "linebreak-style": [
            "error",
            "unix"
        ],
        "quotes": [
            "error",
            "single"
        ],
        "semi": [
            "error",
            "always"
        ],
        "no-extra-parens":[
            "error",
            "all"
        ],
        "arrow-parens": ["error", "always"],
        "valid-jsdoc": ["warn"],
        "curly": ["warn", "multi-line"],
        "strict": ["error"],
        "callback-return": ["error"]
    }
};