const mix = require('laravel-mix');
require('laravel-mix-code-splitter');

mix.js('../dist/esbuild/main.js', 'js')
  .extract('../dist/mix/');
  // .split(mix.js, '../dist/splitted/output');
