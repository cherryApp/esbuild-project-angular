const { build } = require('esbuild');
const liveServer = require("live-server");
const path = require('path');
const fs = require('fs');
const http = require('http');
const { exec } = require('child_process');
const { WebSocketServer } = require('ws');

const minimalLiveServer = (root = process.cwd(), port = 4200, socketPort = 8080) => {

  const wss = new WebSocketServer({ port: socketPort });
  wss.on('connection', function connection(ws) {
    ws.on('message', function message(data) {
      console.log('received: %s', data);
    });

    ws.send('Esbuild live server started');
  });

  const broadcast = message => {
    wss.clients.forEach(function each(client) {
      if (client.readyState === 1) {
        client.send(message);
      }
    });
  };

  const clientScript = `<script>
    const ws = new WebSocket('ws://127.0.0.1:8080');
    ws.onmessage = m => {
      if (m.data === 'location:refresh') {
        location.reload();
      }
    }
  </script>`;

  const server = http.createServer(async (request, response) => {
    // console.log('request ', request.url);

    const headers = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "OPTIONS, POST, GET, PUT, PATCH, DELETE",
      "Access-Control-Max-Age": 0, // No Cache
    };

    let isIndexPage = false;

    let filePath = '.' + request.url;
    if (filePath == './') {
      filePath = path.join(__dirname, root, 'index.html');
      isIndexPage = true;
    } else {
      filePath = path.join(__dirname, root, request.url);
      isIndexPage = false;
    }

    var extname = String(path.extname(filePath)).toLowerCase();
    var mimeTypes = {
      '.html': 'text/html',
      '.js': 'text/javascript',
      '.css': 'text/css',
      '.json': 'application/json',
      '.png': 'image/png',
      '.jpg': 'image/jpg',
      '.gif': 'image/gif',
      '.svg': 'image/svg+xml',
      '.wav': 'audio/wav',
      '.mp4': 'video/mp4',
      '.woff': 'application/font-woff',
      '.ttf': 'application/font-ttf',
      '.eot': 'application/vnd.ms-fontobject',
      '.otf': 'application/font-otf',
      '.wasm': 'application/wasm'
    };

    var contentType = mimeTypes[extname] || 'application/octet-stream';

    try {
      let content = await fs.promises.readFile(filePath, 'utf-8');
      response.writeHead(200, ({ ...headers, 'Content-Type': contentType }));
      if (isIndexPage) {
        content = content.replace(/\<\/body\>/g, `${clientScript}\n</body>`);
      }
      response.end(content);
    } catch (e) {
      if (e.code == 'ENOENT') {
        response.writeHead(404, ({ ...headers, 'Content-Type': 'text/html' }));
        response.end('Page Not Found!', 'utf-8');
      } else {
        response.writeHead(500);
        response.end('Sorry, check with the site admin for error: ' + e.code + ', ' + e);
      }
    }

  }).listen(4200);
  console.log(`Angular running at http://127.0.0.1:${port}/`);

  const start = (process.platform == 'darwin' ? 'open' : process.platform == 'win32' ? 'start' : 'xdg-open');
  exec(start + ` http://127.0.0.1:${port}/`);

  return {
    server,
    wss,
    broadcast,
  };
};


const times = [new Date().getTime(), new Date().getTime()];

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

const scssPlugin = {
  name: "scss",
  setup(build) {
    const path = require("path")
    const sass = require("sass")

    build.onLoad({ filter: /\.scss$/ }, async args => {
      try {
        console.log(args.path);
        const result = sass.renderSync({ file: args.path, });
        console.log(result.css.toString());
        return {
          contents: result.css.toString(),
          // contents: 'body { color: blue; }',
          loader: "css",
        }
      } catch (e) {
        return { errors: [convertMessage(e)] }
      }

    })
  },
};

const zoneJsPlugin = {
  name: "zoneJs",
  setup(build) {
    const fs = require('fs');
    build.onLoad({ filter: /main\.ts$/ }, async (args) => {
      try {
        const source = await fs.promises.readFile(args.path, 'utf8');
        const contents = `import 'zone.js';\n${source}`;
        return { contents, loader: 'ts' };
      } catch (e) {
        return { errors: [convertMessage(e)] }
      }
    });
  },
};

const indexFileProcessor = {
  name: 'indexProcessor',
  async setup(build) {
    build.onStart(async () => {
      let path = require('path');
      let fs = require('fs');

      const distPath = path.join(__dirname, 'dist');
      if (!fs.existsSync(distPath)) {
        fs.mkdirSync(distPath);
      }

      const esbuildPath = path.join(__dirname, 'dist/esbuild');
      if (!fs.existsSync(esbuildPath)) {
        fs.mkdirSync(esbuildPath);
      }

      let indexFileContent = await fs.promises.readFile(
        path.join(__dirname, 'src/index.html'),
        'utf8',
      );

      indexFileContent = indexFileContent.replace(
        /\<\/body\>/gm,
        `<script data-version="0.2" src="main.js"></script></body>`
      );

      indexFileContent = indexFileContent.replace(
        /\<\/head\>/gm,
        `<meta name="time" value="${new Date().getTime()}">
        <link rel="stylesheet" href="main.css">
        </head>`
      );

      await fs.promises.writeFile(
        path.join(__dirname, 'dist/esbuild/index.html'),
        indexFileContent,
        'utf8',
      );
    });
  }
};

let angularComponentDecoratorPlugin = {
  name: 'angularDecorator',
  async setup(build) {
    const fs = require('fs');
    const sass = require('sass');

    const cssCache = [];

    const scssProcessor = async scssPath => {
      const result = sass.renderSync({ file: scssPath });
      cssCache.push(result.css.toString());
    };

    build.onStart(() => {
      console.log('build started');
      times[0] = new Date().getTime();
    });

    build.onEnd(async () => {
      const cssPath = path.join(__dirname, 'dist/esbuild/main.css');
      await fs.promises.writeFile(cssPath, cssCache.join(`\n\n`), 'utf8');

      times[1] = new Date().getTime();
      console.log(`EsBuild complete in ${times[1] - times[0]}ms`);
    });

    build.onLoad({ filter: /\.component\.ts$/ }, async (args) => {

      let getValueByPattern = (regex = new RegExp(''), str = '') => {
        let m;
        let results = [];

        while ((array1 = regex.exec(str)) !== null) {
          results.push(array1[1]);
        }

        return results.pop();
      };

      // Load the file from the file system
      let source = await fs.promises.readFile(args.path, 'utf8');
      let filename = path.relative(process.cwd(), args.path);

      // Convert Svelte syntax to JavaScript
      try {

        let contents = source;

        const templateUrl = getValueByPattern(/^ *templateUrl *\: *['"]*([^'"]*)/gm, source);

        if (/^ *templateUrl *\: *['"]*([^'"]*)/gm.test(contents)) {
          contents = `
          import templateSource from '${templateUrl}';
          ${contents}`;
        }

        if (/^ *styleUrls *\: *\[['"]([^'"\]]*)/gm.test(contents)) {
          const styleUrls = getValueByPattern(
            /^ *styleUrls *\: *\[['"]([^'"\]]*)/gm,
            source
          );
          scssProcessor(filename.replace(/\.ts$/, '.scss'));
        }

        contents = contents.replace(
          /^ *templateUrl *\: *['"]*([^'"]*)['"]/gm,
          "template: templateSource || ''"
        );

        contents = contents.replace(
          /^ *styleUrls *\: *\[['"]([^'"\]]*)['"]\]\,*/gm, ''
        );

        console.log('CONTENTS: ', contents);

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
  root: "./dist/esbuild/", // Set root directory that's being served. Defaults to cwd.
  open: true, // When false, it won't load your browser by default.
  // ignore: 'scss,my/templates', // comma-separated string for paths to ignore
  file: "index.html", // When set, serve this file (server root relative) for every 404 (useful for single-page applications)
  wait: 1000, // Waits for all changes, before reloading. Defaults to 0 sec.
  // mount: [['/components', './node_modules']], // Mount a directory to a route.
  logLevel: 2, // 0 = errors only, 1 = some, 2 = lots
  middleware: [function (req, res, next) { next(); }] // Takes an array of Connect-compatible middleware that are injected into the server middleware stack
};

let liveServerIsRunning = false;
let minimalServer = null;
build({
  entryPoints: ['src/main.ts'],
  bundle: true,
  outfile: 'dist/esbuild/main.js',
  treeShaking: true,
  loader: {
    '.html': 'text',
    '.css': 'text',
  },
  sourcemap: true,
  minify: false,
  watch: {
    onRebuild(error, result) {
      if (error) console.error('watch build failed:', error);
      else {
        console.log('watch build succeeded:', result);
        minimalServer.broadcast('location:refresh');
      }
    },
  },
  plugins: [
    indexFileProcessor,
    zoneJsPlugin,
    // scssPlugin,
    angularComponentDecoratorPlugin,
  ],
}).then(async (result) => {
  console.log(result);
  for (let k in liveServer) {
    console.log(k, liveServer[k]);
  }
  if (!liveServerIsRunning) {
    // liveServer.start(liveServerParams);
    minimalServer = minimalLiveServer('dist/esbuild/');
    liveServerIsRunning = true;
  }
});
