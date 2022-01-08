const fs = require('fs');
const path = require('path');

const { log, convertMessage } = require('../lib/log');
const esBuilder = require('../lib/builder');

/**
   * Check the file is an scss file.
   * @param {String} cssPath path of a file
   * @returns true when the file extension is scss, otherwise false
   */
const isScss = (cssPath) => {
  return /\.scss$/.test(cssPath);
};

/**
   *
   * @param {RegExp} regex regular expression for read a value from a string
   * @param {String} str base string
   * @returns a string value by the regex.
   */
const getValueByPattern = (regex = new RegExp(''), str = '') => {
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
const addInjects = (contents) => {
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

const moduleBuilder = (modulePath = '', moduleName = '', instance = null) => {
  return esBuilder({
    entryPoints: [modulePath],
    bundle: true,
    outfile: moduleName,
    write: false,
    treeShaking: true,
    loader: {
      '.html': 'text',
      '.css': 'text',
    },
    sourcemap: true,
    minify: true,
    plugins: [
      angularComponentDecoratorPlugin(instance),
    ],
    target: 'esnext',
  }).then( async result => {
    const writes = [];
    result.outputFiles.forEach( async file => {
      writes.push(instance.store.fileWriter(
        path.join(instance.outDir, path.basename(file.path)).replace(/\.ts/, '.js'),
        `${file.text}; console.log(OrdersModule);`,
      ));
      // log('result.outputFiles: ', file.text);
    });

    for (let write of writes) {
      write = await write;
    }
    return writes;
  });
};

const handleLoadChildren = (filePath, contents, instance) => {
  if (!/loadChildren.*\:.*\( *\)/g.test(contents)) {
    return contents;
  }

  const lazyModules = [];
  let requireImport = false;

  const regex = /loadChildren *\:.*import[ \r\n]*\([ \r\n]*['"`]([^'"`]*)/gmi;
  let m;
  const groups = [];
  while ((m = regex.exec(contents)) !== null) {
    // This is necessary to avoid infinite loops with zero-width matches
    if (m.index === regex.lastIndex) {
      regex.lastIndex++;
    }

    // The result can be accessed through the `m`-variable.
    const group = [];
    m.forEach((match, groupIndex) => {
      console.log(`Found match, group ${groupIndex}: ${match}`);
      group[groupIndex] = match;
    });
    groups.push(group);
  }

  log('9: ', lazyModules);
  console.log('10: ', contents);
  groups.forEach(async group => {
    const tsName = `${group[1]}.ts`;
    const tsPath = path.join(path.dirname(filePath), tsName);
    const writes = await moduleBuilder(tsPath, tsName, instance);
    log('14: ', writes[0]);
    // lazyModules.push({
    //   filePath,
    //   childName: match,
    //   childPath: path.join(path.dirname(filePath), match.includes('.ts') ? match : `${match}.ts`),
    // });
  })
  // contents = contents.replace(
  //   /loadChildren *\:[^\,\;]*import[ \r\n]*\(/gm,
  //   'loadChildren: () => __esbuild_require__('
  // ).replace()
  log('11: ', contents);


  return contents;
};

/**
   * Esbuild plugin to changing special angular components.
   * @returns an esbuild plugin object
   */
const angularComponentDecoratorPlugin = (instance) => {
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

          const templateUrl = getValueByPattern(/^ *templateUrl *\: *['"]*([^'"]*)/gm, source);

          if (/^ *templateUrl *\: *['"]*([^'"]*)/gm.test(contents)) {
            contents = `import templateSource from '${templateUrl}';
            ${contents}`;
          }

          if (/^ *styleUrls *\: *\[['"]([^'"\]]*)/gm.test(contents)) {
            const styleUrls = getValueByPattern(
              /^ *styleUrls *\: *\[['"]([^'"\]]*)/gm,
              source
            );
            if (isScss(styleUrls)) {
              await instance.scssProcessor(args.path.replace(/\.ts$/, '.scss'));
            } else {
              await instance.cssProcessor(args.path.replace(/\.ts$/, '.css'));
            }
          }

          contents = addInjects(contents);

          contents = handleLoadChildren(args.path, contents, instance);

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
          return { errors: [convertMessage(e)] }
        }
      });
    },
  }
};

module.exports = angularComponentDecoratorPlugin;
