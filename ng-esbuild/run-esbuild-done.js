const { build } = require('esbuild');
const liveServer = require("live-server");

const times = [new Date().getTime(), new Date().getTime()];

let angularComponentDecoratorPlugin = {
  name: 'example',
  async setup(build) {
    let path = require('path');
    let fs = require('fs');

    let indexFileContent = await fs.promises.readFile(
      path.join(__dirname, 'src/index.html'),
      'utf8',
    );

    indexFileContent = indexFileContent.replace(
      /\<\/body\>/gm,
      `<script src="esbuild-main.js"></script></body>`
    );

    await fs.promises.writeFile(
      path.join(__dirname, 'dist/esbuild-index.html'),
      indexFileContent,
      'utf8',
    );

    build.onStart(() => {
      console.log('build started');
      times[0] = new Date().getTime();
    });

    build.onEnd(() => {
      times[1] = new Date().getTime();
      console.log(`EsBuild complete in ${times[1] - times[0]}ms`);
    });

    build.onLoad({ filter: /\.component\.ts$/ }, async (args) => {
      // This converts a message in Svelte's format to esbuild's format
      let convertMessage = ({ message, start, end }) => {
        let location
        if (start && end) {
          let lineText = source.split(/\r\n|\r|\n/g)[start.line - 1]
          let lineEnd = start.line === end.line ? end.column : lineText.length
          location = {
            file: filename,
            line: start.line,
            column: start.column,
            length: lineEnd - start.column,
            lineText,
          }
        }
        return { text: message, location }
      }

      let getValueByPattern = (regex = new RegExp(''), str = '') => {
        let m;
        let results = [];

        while ((m = regex.exec(str)) !== null) {
          if (m.index === regex.lastIndex) {
            regex.lastIndex++;
          }

          m.forEach((match, groupIndex) => results.push(match));
        }

        return results.pop();
      };

      // Load the file from the file system
      let source = await fs.promises.readFile(args.path, 'utf8');
      let filename = path.relative(process.cwd(), args.path);

      // Convert Svelte syntax to JavaScript
      try {
        const templateUrl = getValueByPattern(/^ *templateUrl *\: *['"]*([^'"]*)/gm, source);
        const styleUrls = getValueByPattern(/^ *styleUrls *\: *\[['"]([^'"\]]*)/gm, source);

        let contents = source.replace(/\@Component/gmi, `
          import templateSource from '${templateUrl}';
          import styleSheet from '${styleUrls}';
          @Component
        `);

        contents = contents.replace(
          /^ *templateUrl *\: *['"]*([^'"]*)['"]/gm,
          "template: templateSource || ''"
        );

        contents = contents.replace(
          /^ *styleUrls *\: *\[['"]([^'"\]]*)['"]\]/gm,
          "styles: [styleSheet || '']"
        );
        return { contents, loader: 'ts' };
      } catch (e) {
        return { errors: [convertMessage(e)] }
      }
    });
  },
};

const liveServerParams = {
  port: 8181, // Set the server port. Defaults to 8080.
  host: "0.0.0.0", // Set the address to bind to. Defaults to 0.0.0.0 or process.env.IP.
  root: "./dist", // Set root directory that's being served. Defaults to cwd.
  open: true, // When false, it won't load your browser by default.
  // ignore: 'scss,my/templates', // comma-separated string for paths to ignore
  file: "/esbuild-index.html", // When set, serve this file (server root relative) for every 404 (useful for single-page applications)
  wait: 500, // Waits for all changes, before reloading. Defaults to 0 sec.
  // mount: [['/components', './node_modules']], // Mount a directory to a route.
  logLevel: 2, // 0 = errors only, 1 = some, 2 = lots
  middleware: [function (req, res, next) { next(); }] // Takes an array of Connect-compatible middleware that are injected into the server middleware stack
};

let liveServerIsRunning = false;
build({
  entryPoints: ['src/main.ts'],
  bundle: true,
  outfile: 'dist/esbuild-main.js',
  treeShaking: true,
  loader: {
    '.html': 'text',
    '.css': 'text',
  },
  sourcemap: true,
  minify: true,
  watch: {
    onRebuild(error, result) {
      if (error) console.error('watch build failed:', error)
      // else console.log('watch build succeeded:', result)
    },
  },
  plugins: [
    angularComponentDecoratorPlugin,
  ],
}).then(result => {
  if (!liveServerIsRunning) {
    liveServer.start(liveServerParams);
    liveServerIsRunning = true;
  }
});
