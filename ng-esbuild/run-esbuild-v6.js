/**
 * Goal: works correctly with loadChildren().
 */
const path = require('path');
const fs = require('fs');
const http = require('http');
const { exec } = require('child_process');

const chokidar = require('chokidar');
const { build } = require('esbuild');
const { WebSocketServer } = require('ws');
const sass = require('sass');

class NgEsbuild {
  constructor() {

    this.inMemory = true;
    this.inMemoryStore = {
      urlList: {},
    };

    this.timeStamp = new Date().getTime();

    this.dryRun = true;

    this.cssCache = '';

    this.sass = require('sass');

    this.angularSettings = {};

    this.outPath = 'dist/esbuild';

    this.workDir = process.cwd();

    this.outDir = path.join(this.workDir, this.outPath);

    this.componentBuffer = {};

    this.times = [new Date().getTime(), new Date().getTime()];

    this.liveServerIsRunning = false;
    this.buildInProgress = false;
    this.minimalServer = null;
    this.lastUpdatedFileList = [];

    this.buildTimeout = 0;

    this.initWatcher();

    this.lazyModules = [];
  }

  static log(...args) {
    console.log(...args);
  }

  pushToInMemoryStore(filePath, content) {
    this.inMemoryStore[filePath] = content;
    this.inMemoryStore.urlList[filePath] =
      filePath.replace(/\\/g, '/').split(this.outPath).pop();
  }

  async fileWriter(filePath, content, encoding = 'utf8') {
    if (!this.inMemory) {
      await fs.promises.writeFile(filePath, content, encoding);
    } else {
      this.pushToInMemoryStore(filePath, content);
    }
  }

  async fileCopier(srcPath, destPath) {
    if (!this.inMemory) {
      await fs.promises.copyFile(srcPath, destPath);
    } else {
      const content = await fs.promises.readFile(srcPath);
      this.pushToInMemoryStore(destPath, content);
    }
  }

  async fileCopierSync(srcPath, destPath) {
    if (!this.inMemory) {
      fs.copyFileSync(srcPath, destPath);
    } else {
      const content = fs.readFileSync(srcPath);
      this.pushToInMemoryStore(destPath, content);
    }
  }

  initWatcher() {
    if (!this.inMemory && !fs.existsSync(this.outDir)) {
      fs.mkdirSync(this.outDir, { recursive: true });
    }

    const watcher = chokidar.watch([
      'src/**/*.(css|scss|less|sass|js|ts|tsx|html)',
      'angular.json'
    ], {
      ignored: /(^|[\/\\])\../, // ignore dotfiles
      persistent: true
    });
    watcher
      .on('add', filePath => this.startBuild(filePath))
      .on('change', filePath => this.startBuild(filePath))
      .on('unlink', filePath => this.startBuild());
  }

  /**
   * Wrapper method to use esbuild.
   */
  builder() {
    this.buildInProgress = true;
    build({
      entryPoints: ['src/main.ts'],
      bundle: true,
      outfile: path.join(this.outDir, 'main.js'),
      write: !this.inMemory,
      treeShaking: true,
      loader: {
        '.html': 'text',
        '.css': 'text',
      },
      sourcemap: true,
      minify: true,
      plugins: [
        this.settingsResolver(this),
        this.indexFileProcessor(this),
        this.zoneJsPlugin(this),
        this.angularComponentDecoratorPlugin(this),
        this.cssResolver(this),
        this.jsResolver(this),
        this.assetsResolver(this),
      ],
    }).then(result => {
      if (result.outputFiles) {
        result.outputFiles.forEach(file => {
          const key = path.join(this.outDir, path.basename(file.path));
          this.pushToInMemoryStore(key, file.text);
        });
      }

      NgEsbuild.log('MODULES: ', this.lazyModules);

      if (!this.liveServerIsRunning) {
        this.minimalServer = NgEsbuild.minimalLiveServer(
          `${this.outPath}/`,
          this.inMemory ? this.inMemoryStore : null
        );
        this.liveServerIsRunning = true;
      }
      this.buildInProgress = false;
      this.minimalServer.broadcast('location:refresh');
      this.lastUpdatedFileList = [];
      this.cssCache = '';
      this.dryRun = false;

      this.times[1] = new Date().getTime();
      NgEsbuild.log(`EsBuild complete in ${this.times[1] - this.times[0]}ms`);
    });
  }


  startBuild(filePath = '') {
    if (filePath) {
      this.lastUpdatedFileList.push(
        path.join(process.cwd(), filePath)
      );
    }

    if (!this.lastUpdatedFileList.find(f => /.*angular\.json$/.test(f))) {
      this.dryRun = true;
    }

    // Refresh everything.
    this.dryRun = true;

    clearTimeout(this.buildTimeout);

    if (this.buildInProgress) {
      return;
    }

    this.buildTimeout = setTimeout(() => {
      clearTimeout(this.buildTimeout);
      this.times[0] = new Date().getTime();
      this.builder();
    }, 500);
  }

  /**
   *
   * @param {RegExp} regex regular expression for read a value from a string
   * @param {String} str base string
   * @returns a string value by the regex.
   */
  static getValueByPattern(regex = new RegExp(''), str = '') {
    let m;
    let results = [];

    let array1 = null;

    while ((array1 = regex.exec(str)) !== null) {
      results.push(array1[1]);
    }

    return results.pop();
  };

  /**
   * Place @Inject statements
   * @param {String} contents content of the target .ts file
   * @returns the new conent that changed
   */
  static addInjects(contents) {
    if (/constructor *\(([^\)]*)/gm.test(contents)) {
      let requireInjectImport = false;
      const matches = contents.matchAll(/constructor *\(([^\)]*)/gm);
      for (let match of matches) {
        if (match[1] && /\:/gm.test(match[1])) {
          requireInjectImport = true;
          let flat = match[1].replace(/[\n\r]/gm, '');
          const flatArray = flat.split(',').map(inject => {
            const parts = inject.split(':');
            return parts.length === 2
              ? `@Inject(${parts[1]}) ${inject}`
              : inject;
          });

          contents = contents.replace(
            /constructor *\([^\)]*\)/gm,
            `constructor(${flatArray.join(',')})`
          );
        }
      }

      if (requireInjectImport && !/Inject[ ,\}\n\r].*'@angular\/core.*\;/.test(contents)) {
        contents = `import { Inject } from '@angular/core';\n\r${contents}`;
      }

    }

    return contents;
  }

  handleLoadChildren(filePath, contents) {
    if (!/loadChildren.*\:.*\( *\)/g.test(contents)) {
      return contents;
    }

    const regex = /loadChildren *\:.*import[ \r\n]*\([ \r\n]*['"]([^'"]*)/gmi;
    let m;
    while ((m = regex.exec(contents)) !== null) {
      // This is necessary to avoid infinite loops with zero-width matches
      if (m.index === regex.lastIndex) {
        regex.lastIndex++;
      }

      // The result can be accessed through the `m`-variable.
      m.forEach((match, groupIndex) => {
        console.log(`Found match, group ${groupIndex}: ${match}`);
        if (groupIndex > 0) {
          this.lazyModules.push({
            filePath,
            match: path.join(path.dirname(filePath), match.includes('.ts') ? match : `${match}.ts`),
          });
        }
      });
    }


    return contents;
  }

  /**
   * Copy whole directories.
   * @param {String} src path of the source directory
   * @param {String} dest path of the target directory
   */
  async copyDir(src, dest) {
    if (!this.inMemory) {
      await fs.promises.mkdir(dest, { recursive: true });
    }

    let entries = await fs.promises.readdir(src, { withFileTypes: true });

    for (let entry of entries) {
      let srcPath = path.join(src, entry.name);
      let destPath = path.join(dest, entry.name);

      entry.isDirectory() ?
        await this.copyDir(srcPath, destPath) :
        await this.fileCopier(srcPath, destPath);
    }
  }

  /**
   * Check the file is an scss file.
   * @param {String} cssPath path of a file
   * @returns true when the file extension is scss, otherwise false
   */
  static isScss(cssPath) {
    return /\.scss$/.test(cssPath);
  }

  /**
   * Process .scss and .css files.
   * @param {String} scssPath path of the scss file
   */
  async scssProcessor(scssPath) {
    const workDir = path.dirname(scssPath);

    const result = sass.renderSync({
      file: scssPath,
      includePaths: [workDir],
    });

    let cssContent = result.css.toString();

    const matches = cssContent.matchAll(/url\(['"]?([^\)'"\?]*)[\"\?\)]?/gm);
    for (let match of matches) {
      if (!/data\:/.test(match[0])) {
        try {
          const sourcePath = path.join(workDir, match[1]);
          const fileName = path.basename(sourcePath);
          const targetPath = path.join(this.outDir, fileName);
          this.fileCopierSync(
            sourcePath,
            targetPath,
          );
          cssContent = cssContent.replace(match[1], fileName);
        } catch (e) {
          console.error('ERROR: ', e);
        }
      }
    }

    this.cssCache += `\n\n${cssContent}`;
  }

  /**
   * Read .css content and add it to the cache.
   * @param {String} cssPath path of the .css file
   */
  async cssProcessor(cssPath) {
    const result = await fs.promises.readFile(cssPath, 'utf8');
    this.cssCache += `\n\n${result}`;
  }

  /**
   * Minimal live-server for developing purposes.
   * @param {String} root root of the file-server
   * @param {Number} port http port
   * @param {Number} socketPort websocket port
   * @param {Object} fileBuffer a buffer to loading files from the memory
   * @returns an object with the server and websocket-server instances
   */
  static minimalLiveServer(
    root = process.cwd(),
    fileBuffer = {},
    port = 4200,
    socketPort = 8080,
  ) {

    const wss = new WebSocketServer({ port: socketPort });
    wss.on('connection', function connection(ws) {
      ws.on('message', function message(data) {
        NgEsbuild.log('received: %s', data);
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

      const headers = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "OPTIONS, POST, GET, PUT, PATCH, DELETE",
        "Access-Control-Max-Age": 0, // No Cache
      };

      let isIndexPage = false;

      let filePath = '.' + request.url;
      if (filePath == './') {
        filePath = path.join(root, 'index.html');
        isIndexPage = true;
      } else {
        filePath = path.join(root, request.url);
        isIndexPage = false;
      }
      filePath = filePath.split('?')[0];

      const absPath = path.resolve(filePath);
      let inMemoryFile = null;
      if (fileBuffer && fileBuffer[absPath]) {
        inMemoryFile = fileBuffer[absPath];
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

      const contentType = mimeTypes[extname] || 'application/octet-stream';
      const encoding = ['.html', '.js', '.css'].includes(extname)
        ? 'utf8'
        : null;

      try {
        let content = inMemoryFile || await fs.promises.readFile(filePath, encoding);
        response.writeHead(200, ({ ...headers, 'Content-Type': contentType }));
        if (isIndexPage) {
          content = content.replace(/\<\/body\>/g, `${clientScript}\n</body>`);
        }
        response.end(content);
      } catch (e) {
        if (e.code == 'ENOENT') {
          NgEsbuild.log('ENOENT: ', Object.keys(fileBuffer));
          response.writeHead(404, ({ ...headers, 'Content-Type': 'text/html' }));
          response.end('Page Not Found!', 'utf8');
        } else {
          response.writeHead(500);
          response.end('Sorry, check with the site admin for error: ' + e.code + ', ' + e);
        }
      }

    }).listen(4200);
    NgEsbuild.log(`Angular running at http://127.0.0.1:${port}/`);

    const start = (process.platform == 'darwin' ? 'open' : process.platform == 'win32' ? 'start' : 'xdg-open');
    exec(start + ` http://127.0.0.1:${port}/`);

    return {
      server,
      wss,
      broadcast,
    };
  }

  /**
   * Converts error messages to the esbuild format.
   * @param {Object} param0 object of the error message
   * @returns converted error message for esbuild
   */
  static convertMessage({ message, start, end }) {
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
  ////////////////////////////// Plugins //////////////////////////////

  /**
   * Esbuild plugin to changing the main.ts file.
   * @returns an esbuild plugin object
   */
  zoneJsPlugin(instance) {
    return {
      name: "zoneJs",
      setup(build) {
        build.onLoad({ filter: /main\.ts$/ }, async (args) => {
          try {
            if (!instance.lastUpdatedFileList.includes(args.path) && instance.componentBuffer[args.path]) {
              return { contents: instance.componentBuffer[args.path], loader: 'ts' };
            }

            const source = await fs.promises.readFile(args.path, 'utf8');
            const contents = `import 'zone.js';\n${source}`;
            instance.componentBuffer[args.path] = contents;
            return { contents, loader: 'ts' };
          } catch (e) {
            return { errors: [NgEsbuild.convertMessage(e)] }
          }
        });
      },
    }
  }

  /**
   * Esbuild plugin to process index.html file and place scripts and styles
   * into it.
   * @returns an esbuild plugin to changing the index.html file
   */
  indexFileProcessor(instance) {
    return {
      name: 'indexProcessor',
      async setup(build) {
        build.onStart(async () => {
          if (!instance.dryRun) {
            return;
          }

          let path = require('path');
          let fs = require('fs');

          let indexFileContent = await fs.promises.readFile(
            path.join(instance.workDir, 'src/index.html'),
            'utf8',
          );

          indexFileContent = indexFileContent.replace(
            /\<\/body\>/gm,
            `<script data-version="0.2" src="vendor.js"></script>
          <script data-version="0.2" src="main.js"></script>
          </body>`
          );

          indexFileContent = indexFileContent.replace(
            /\<\/head\>/gm,
            `<link rel="stylesheet" href="main.css">
          </head>`
          );

          await instance.fileWriter(
            path.join(instance.outDir, 'index.html'),
            indexFileContent
          );
        });
      }
    }
  }

  /**
   * Esbuild plugin to changing special angular components.
   * @returns an esbuild plugin object
   */
  angularComponentDecoratorPlugin(instance) {
    return {
      name: 'angularComponentProcessor',
      async setup(build) {
        build.onLoad({ filter: /src.*\.(component|pipe|service|directive|module)\.ts$/ }, async (args) => {
          // Check the cache.
          if (!instance.lastUpdatedFileList.includes(args.path) && instance.componentBuffer[args.path]) {
            return { contents: instance.componentBuffer[args.path], loader: 'ts' };
          }

          // Load the file from the file system
          let source = await fs.promises.readFile(args.path, 'utf8');

          // Convert Svelte syntax to JavaScript
          try {

            let contents = source;

            const templateUrl = NgEsbuild.getValueByPattern(/^ *templateUrl *\: *['"]*([^'"]*)/gm, source);

            if (/^ *templateUrl *\: *['"]*([^'"]*)/gm.test(contents)) {
              contents = `import templateSource from '${templateUrl}';
              ${contents}`;
            }

            if (/^ *styleUrls *\: *\[['"]([^'"\]]*)/gm.test(contents)) {
              const styleUrls = NgEsbuild.getValueByPattern(
                /^ *styleUrls *\: *\[['"]([^'"\]]*)/gm,
                source
              );
              if (NgEsbuild.isScss(styleUrls)) {
                await instance.scssProcessor(args.path.replace(/\.ts$/, '.scss'));
              } else {
                await instance.cssProcessor(args.path.replace(/\.ts$/, '.css'));
              }
            }

            contents = NgEsbuild.addInjects(contents);

            contents = instance.handleLoadChildren(args.path, contents);

            contents = contents.replace(
              /^ *templateUrl *\: *['"]*([^'"]*)['"]/gm,
              "template: templateSource || ''"
            );

            contents = contents.replace(
              /^ *styleUrls *\: *\[['"]([^'"\]]*)['"]\]\,*/gm, ''
            );

            instance.componentBuffer[args.path] = contents;

            return { contents, loader: 'ts' };
          } catch (e) {
            return { errors: [NgEsbuild.convertMessage(e)] }
          }
        });
      },
    }
  }


  settingsResolver(instance) {
    return {
      name: 'angularSettingsResolver',
      async setup(build) {
        if (!instance.dryRun) {
          return;
        }

        instance.angularSettings = JSON.parse(await fs.promises.readFile(
          path.join(instance.workDir, 'angular.json'),
          'utf8',
        ));
      }
    }
  }

  cssResolver(instance) {
    return {
      name: 'angularCSSProcessor',
      async setup(build) {
        build.onEnd(async () => {
          if (!instance.lastUpdatedFileList.find(f => /src(\\|\/).*(\.css|\.scss|\.less|\.sass)$/.test(f)) && !instance.dryRun) {
            return;
          }

          let cache = '';

          const project = Object.entries(instance.angularSettings.projects)[0][1];
          const baseStylePaths = project.architect.build.options.styles;
          baseStylePaths.forEach((item = '') => {
            const itemPath = item.includes('/')
              ? path.join(instance.workDir, item)
              : path.join(instance.workDir, 'src', item);
            instance.scssProcessor(itemPath);
          });

          const cssOutputPath = path.join(instance.outDir, `main.css`);
          await instance.fileWriter(cssOutputPath, instance.cssCache, 'utf8');
        });
      }
    }
  };

  jsResolver(instance) {
    return {
      name: 'angularVendorJSResolver',
      async setup(build) {
        build.onEnd(async () => {
          if (!instance.dryRun) {
            return;
          }

          let cache = '';

          const project = Object.entries(instance.angularSettings.projects)[0][1];
          const baseStylePaths = project.architect.build.options.scripts;
          baseStylePaths.forEach((item = '') => {
            const itemPath = item.includes('/')
              ? path.join(instance.workDir, item)
              : path.join(instance.workDir, 'src', item);
            const content = fs.readFileSync(itemPath, 'utf8');
            cache += `\n\n${content}`;
          });

          const jsOutputPath = path.join(instance.outDir, `vendor.js`);
          await instance.fileWriter(jsOutputPath, cache, 'utf8');
        });
      }
    }
  };

  assetsResolver(instance) {
    return {
      name: 'angularAssetsResolver',
      async setup(build) {
        if (!instance.lastUpdatedFileList.find(f => /src\\assets|src\/assets/.test(f)) && !instance.dryRun) {
          return;
        }

        await instance.copyDir(
          path.join(instance.workDir, 'src/assets'),
          path.join(instance.outDir, 'assets'),
        );
        await instance.fileCopier(
          path.join(instance.workDir, 'src/favicon.ico'),
          path.join(instance.outDir, 'favicon.ico'),
        );
      }
    }
  }

}

// -> END CLASS
/////////////////////////////////////////
/////////////////////////////////////////
/////////////////////////////////////////


new NgEsbuild();
