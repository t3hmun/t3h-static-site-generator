This is a very basic setup for manually testing basic features.

Run `node ./../src/publish.js debug test` to see if the output is working.
The `debug` and `test` flags are optional.

The input folder should not change, the output folders should be wiped manually.

The base-url in the config is set to my website.
This is useful because the links in the publish output will point to my website if things are working.
This includes the css from my website.