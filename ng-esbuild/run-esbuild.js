// esbuild src/main.ts --bundle --outfile=dist/main.js --loader:.html=text --watch --sourcemap --serve --port 4200
// require('esbuild').serve({
//   servedir: '.',
//   port: 4200,
// }, {
//   entryPoints: ['src/main.ts'],
//   bundle: true,
//   outfile: 'dist/main.js',
//   loader: {
//     '.html': 'text',
//   },
//   sourcemap: true,
// }).then(server => {
//   // Call "stop" on the web server to stop serving
//   // server.stop();
// });

// import esbuild from 'esbuild'
// import textReplace from 'esbuild-plugin-text-replace'

// await esbuild.build(
//   {
//     entryPoints: ['src/main.ts'],
//     bundle: true,
//     outfile: 'dist/main.js',
//     loader: {
//       '.html': 'text',
//     },
//     sourcemap: true,
//     watch: true,
//     plugins: [

//       textReplace(
//         {
//           include: /src\/app\/.*\/component\.ts$/,
//           pattern: [
//             [/title.*\=.*/, 'title: \'Hello Eslint!\';'],
//           ]
//         }
//       )
//     ],
//   }
// )

import textReplace from 'esbuild-plugin-text-replace'
import esbuild from 'esbuild';

esbuild.build({
  entryPoints: ['src/main.ts'],
  bundle: true,
  outfile: 'dist/main.js',
  loader: {
    '.html': 'text',
  },
  sourcemap: true,
  minify: true,
  watch: {
    onRebuild(error, result) {
      if (error) console.error('watch build failed:', error)
      else console.log('watch build succeeded:', result)
    },
  },
  plugins: [

    textReplace(
      {
        include: /src\/app\/.*\.ts$/,
        pattern: [
          [/title.*\=.*/],
          ['title = \'Hello Eslint!\';']
        ]
      }
    )
  ],
}).then(result => {
  console.log('watching...')
})
