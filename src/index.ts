#!/usr/bin/env node
import path from 'path';
import fs from 'fs-extra';
import type {FaviconResponse, FaviconOptions} from 'favicons';
import favicons from 'favicons';
import yargs from 'yargs';
import Handlebars from "handlebars";

function print(message: string) {
  process.stdout.write(message);
}

function generateFavicons(
  exportFolder: string,
  icon: string,
  config: Partial<FaviconOptions>
): Promise<string[]> {
  print('generating favicons...');
  function generateFav(resolve: (html: string[]) => void, reject: (error: unknown) => void) {
    favicons(
      icon,
      config,
      async (error: unknown, response: FaviconResponse) => {
        if (error) {
          return reject(error);
        }
        for (const image of response.images) {
          // console.log(`copying ${image.name}...`);
          fs.writeFileSync(`${exportFolder}/${image.name}`, image.contents);
        }

        for (const file of response.files) {
          // console.log(`copying ${file.name}...`);
          fs.writeFileSync(`${exportFolder}/${file.name}`, file.contents);
        }
        resolve(response.html);
      }
    );
  }
  let timer: NodeJS.Timeout | null;
  return new Promise<string[]>((resolve, reject) => {
    timer = setTimeout(() => {
      console.log('timed out, retrying...');
      timer = null;
      generateFav(resolve, reject);
    }, 30000);
    generateFav(
      (r) => {
        if (timer) {
          resolve(r);
        }
      },
      (e) => {
        if (timer) {
          reject(e);
        }
      }
    );
  }).then((r) => {
    print(' done\n');
    if (timer) {
      clearTimeout(timer);
    }
    return r;
  });
}

const makeHtmlAttributes = (attributes: {[key: string]: string}) => {
  if (!attributes) {
    return '';
  }

  const keys = Object.keys(attributes);
  // eslint-disable-next-line no-param-reassign
  return keys.reduce(
    (result, key) => (result += ` ${key}="${attributes[key]}"`),
    ''
  );
};

async function generateBasicIndexHTML(
  templateFilePath: string,
  targetFile: string,
  folder: string,
  {
    title,
    meta,
    faviconsOutput,
  }: {title: string; meta: {[key: string]: string}[]; faviconsOutput: string[]}
) {
  print('generating html...');
  const templateContent = fs.readFileSync(templateFilePath).toString();

  const template = Handlebars.compile(templateContent);

  let inject = '';
  if (meta) {
    const metas = meta
      .map((input) => {
        const attrs = makeHtmlAttributes(input);
        return `<meta${attrs}>`;
      })
      .join('\n');
    inject += `${metas}\n`;
  }
  inject += '\n';
  for (const faviconHTML of faviconsOutput) {
    inject = inject + faviconHTML + '\n';
  }

  Handlebars.registerPartial('APPLICATION', '{{{inject}}}')
  const newHTMLString = template({ title, inject })
  fs.writeFileSync(path.join(folder, targetFile), newHTMLString);
  print(' done\n');
}

function replaceRootPaths(folder: string, files: string[]) {
  const findSrc = 'src="/';
  const reSrc = new RegExp(findSrc, 'g');
  const findDirect = '"/';
  const reDirect = new RegExp(findDirect, 'g');
  for (const file of files) {
    const filepath = path.join(folder, file);
    if (fs.existsSync(filepath)) {
      let content = fs.readFileSync(filepath).toString();
      if (file.endsWith('.html') || file.endsWith('.xml')) {
        content = content.replace(reSrc, 'src="../');
      } else {
        content = content.replace(reDirect, '"../');
      }
      fs.writeFileSync(filepath, content);
    }
  }
}

type Options = {
  configPath: string;
  templateFilePath: string;
  targetFolder: string;
  targetFile: string;
  cachePath?: string;
  applicationURL?: string;
  version?: string;
  force?: boolean;
}

async function generateApp(options: Options) {
  const publicFolder = options.targetFolder;
  const version = options.version;

  console.log(`preparing from ${options.configPath} to ${publicFolder}...`);
  fs.ensureDirSync(publicFolder);

  if (!fs.existsSync(options.configPath)) {
    console.error(`The ${options.configPath} file is required to prepare the web application`);
    process.exit(1);
  }

  if (!fs.existsSync(options.templateFilePath)) {
    console.error(`The ${options.templateFilePath} file is required to prepare the web application`);
    process.exit(1);
  }

  let CACHE_FILE = options.cachePath;
  if (!CACHE_FILE) {
    if (fs.existsSync('node_modules')) {
      CACHE_FILE = path.join('node_modules', '.prepare-for-web-cache');
    } else {
      CACHE_FILE = '.prepare-for-web-cache';
    }
  }

  const now = Math.floor(Date.now() / 1000);
  const config = JSON.parse(fs.readFileSync(options.configPath).toString());
  const sources = [options.configPath, options.templateFilePath];
  if (config.icon) {
    sources.push(config.icon);
  }
  if (config.maskable_icons) {
    for (const maskableIcon of config.maskable_icons) {
      sources.push(path.join(publicFolder, maskableIcon.src));
    }
  }
  const maxTime = Math.max(
    ...sources.map((v) => {
      try {
        return fs.statSync(v).mtime.getTime();
      } catch (e) {
        return Date.now();
      }
    })
  );
  let lastTime = 0;
  try {
    lastTime = fs.statSync(CACHE_FILE).mtime.getTime();
  } catch (e) {
    lastTime = 0;
  }
  if (!options.force && lastTime >= maxTime) {
    // console.log({maxTime, lastTime, CACHE_FILE});
    return;
  }
  const overrideURL = options.applicationURL;
  if (overrideURL && overrideURL !== '') {
    config.url = overrideURL;
  }
  const title = config.appName + ' - ' + config.appShortDescription;
  const previewURL = config.url + '/' + (config.preview || 'preview.png');

  let ensName = config.ensName;
  if (ensName && !ensName.endsWith('.eth')) {
    ensName += '.eth';
  }
  if (!ensName && config.url && config.url.endsWith('.eth.link')) {
    ensName = config.url.slice(0, config.url.length - 5);
  }
  if (ensName) {
    if (ensName.startsWith('https://')) {
      ensName = ensName.slice(8);
    }
    if (ensName.startsWith('http://')) {
      ensName = ensName.slice(7);
    }
    fs.writeFileSync(
      path.join(publicFolder, 'robots.txt'),
      'Dwebsite: ' + ensName
    );
  }

  const faviconFolder = path.join(publicFolder, 'pwa');
  fs.ensureDirSync(faviconFolder);
  const faviconsOutput = await generateFavicons(faviconFolder, config.icon, {
    appName: config.appName,
    appShortName: config.appShortName,
    appDescription: config.appDescription,
    developerName: config.developerName,
    developerURL: config.developerURL,
    background: config.background,
    theme_color: config.theme_color,
    appleStatusBarStyle: config.appleStatusBarStyle,
    display: config.display,
    scope: '/',
    start_url: '/',
    version,
    logging: false,
    pixel_art: true,
    path: '/pwa/',
  });

  if (config.maskable_icons) {
    const manifestPath = path.join(faviconFolder, 'manifest.json');
    let manifest;
    try {
      manifest = JSON.parse(fs.readFileSync(manifestPath).toString());
    } catch (e) {
      console.error(
        `failed to parse manifest ("${manifestPath}")`,
        e
      );
    }
    for (const maskableIcon of config.maskable_icons) {
      const maskableIconPath = path.join(publicFolder, maskableIcon.src);
      if (fs.existsSync(maskableIconPath)) {
        let found = false;
        if (maskableIconPath.startsWith('pwa')) {
          for (const icon of manifest.icons) {
            if (icon.src.endsWith(`/${maskableIconPath}`)) {
              icon.purpose = 'any maskable';
              found = true;
            }
          }
        }
        if (!found) {
          manifest.icons.push({
            src: '../' + maskableIcon.src,
            sizes: maskableIcon.sizes,
            type: maskableIcon.type,
            purpose: 'maskable'
          });
        }
      } else {
        console.warn(`maskable icon file ("${maskableIconPath}") does not exist`);
      }
    }
    try {
      fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, '  '));
    } catch (e) {
      console.error(
        `failed to write manifest ("${manifestPath}")`,
        e
      );
    }
            
  }

  replaceRootPaths(faviconFolder, [
    'manifest.json',
    'yandex-browser-manifest.json',
    'manifest.webapp',
    'browserconfig.xml',
  ]);

  await generateBasicIndexHTML(options.templateFilePath, options.targetFile, publicFolder, {
    title,
    faviconsOutput,
    meta: [
      {charset: 'utf-8'},
      {name: 'viewport', content: 'width=device-width,initial-scale=1'},
      {
        name: 'title',
        content: title,
      },
      {name: 'description', content: config.appDescription},

      {property: 'og:type', content: 'website'},
      {property: 'og:url', content: config.url},
      {property: 'og:title', content: title},
      {
        property: 'og:description',
        content: config.appDescription,
      },
      {
        property: 'og:image',
        content: previewURL,
      },
      {property: 'twitter:card', content: 'summary_large_image'},
      {property: 'twitter:url', content: config.url},
      {
        property: 'twitter:title',
        content: title,
      },
      {
        property: 'twitter:description',
        content: config.appDescription,
      },
      {
        property: 'twitter:image',
        content: previewURL,
      },
    ],
  });

  print('caching...');
  for (const source of sources) {
    try {
      fs.utimesSync(source, now, now);
    } catch (e) {}
  }

  fs.writeFileSync(CACHE_FILE, Date.now().toString());
  fs.utimesSync(CACHE_FILE, now, now);
  print('done\n');
}

(async () => {
  const args = yargs.options({
    'config': { type: 'string', default: 'application.json', description: 'path to config file'},
    'template': { type: 'string', default: 'index.template.html', description: 'path to template index html file'},
    'target': { type: 'string', default: 'public', description: 'path to folder where file will be generated'},
    'targetFile': {type: 'string', default: 'index.html', description: 'file name for generated index.html'},
    'url': { type: 'string', description: 'url of the application'},
    'cache': { type: 'string', description: 'path to the cache file'},
    'app-version': { type: 'string', description: 'version of the app'},
    'use-package-version': { type: 'boolean', description: 'whether to read version for package.json'},
    'cwd': { type: 'string', description: 'path in which to execute'},
    'force': { type: 'boolean', description: 'force prepare regardless of cache'},
  }).argv;

  if (args['use-package-version'] && args['app-version']) {
    console.error(`cannot specify both --use-package-version and --app-version`);
    process.exit(1);
  }

  let version = undefined;
  if (args['use-package-version']) {
    const pkg = JSON.parse(fs.readFileSync('./package.json').toString());
    version = pkg.version;
  } else if (args['app-version']) {
    version = args['app-version'];
  }

  if (args.cwd) {
    process.chdir(args.cwd);
  }

  await generateApp({
    configPath: args.config,
    templateFilePath: args.template,
    targetFolder: args.target,
    cachePath: args.cache,
    targetFile: args.targetFile,
    applicationURL: args.url || process.env.WEB_APPLICATION_URL,
    version,
    force: args.force
  });
  console.log('DONE');
  process.exit(0);
})();
