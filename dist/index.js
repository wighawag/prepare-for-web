#!/usr/bin/env node
"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const path_1 = __importDefault(require("path"));
const fs_extra_1 = __importDefault(require("fs-extra"));
const favicons_1 = __importDefault(require("favicons"));
const yargs_1 = __importDefault(require("yargs"));
const handlebars_1 = __importDefault(require("handlebars"));
function print(message) {
    process.stdout.write(message);
}
function generateFavicons(exportFolder, icon, config) {
    print('generating favicons...');
    function generateFav(resolve, reject) {
        favicons_1.default(icon, config, async (error, response) => {
            if (error) {
                return reject(error);
            }
            for (const image of response.images) {
                // console.log(`copying ${image.name}...`);
                fs_extra_1.default.writeFileSync(`${exportFolder}/${image.name}`, image.contents);
            }
            for (const file of response.files) {
                // console.log(`copying ${file.name}...`);
                fs_extra_1.default.writeFileSync(`${exportFolder}/${file.name}`, file.contents);
            }
            resolve(response.html);
        });
    }
    let timer;
    return new Promise((resolve, reject) => {
        timer = setTimeout(() => {
            console.log('timed out, retrying...');
            timer = null;
            generateFav(resolve, reject);
        }, 30000);
        generateFav((r) => {
            if (timer) {
                resolve(r);
            }
        }, (e) => {
            if (timer) {
                reject(e);
            }
        });
    }).then((r) => {
        print(' done\n');
        if (timer) {
            clearTimeout(timer);
        }
        return r;
    });
}
const makeHtmlAttributes = (attributes) => {
    if (!attributes) {
        return '';
    }
    const keys = Object.keys(attributes);
    // eslint-disable-next-line no-param-reassign
    return keys.reduce((result, key) => (result += ` ${key}="${attributes[key]}"`), '');
};
async function generateBasicIndexHTML(templateFilePath, folder, { title, meta, faviconsOutput }, targetFile, base) {
    print('generating html...');
    const templateContent = fs_extra_1.default.readFileSync(templateFilePath).toString();
    const template = handlebars_1.default.compile(templateContent);
    let favicons = '';
    for (const faviconHTML of faviconsOutput) {
        favicons = favicons + faviconHTML + '\n';
    }
    let metaTags = '';
    if (meta) {
        const metas = meta
            .map((input) => {
            const attrs = makeHtmlAttributes(input);
            return `<meta${attrs}>`;
        })
            .join('\n');
        metaTags += `${metas}\n`;
    }
    metaTags += '\n';
    // ensure base as specified by application.js is used for meta and favicons
    if (base !== undefined && base !== '/') {
        // src should not be needed, as favicons and meta tags do not use that atrribute, leaving it though...
        const findSrc = 'src="/';
        const reSrc = new RegExp(findSrc, 'g');
        const findHref = 'href="/';
        const reHref = new RegExp(findHref, 'g');
        const findContent = 'content="/';
        const reContent = new RegExp(findContent, 'g');
        favicons = favicons
            .replace(reSrc, 'src="' + base)
            .replace(reHref, 'href="' + base)
            .replace(reContent, 'content="' + base);
        metaTags = metaTags
            .replace(reSrc, 'src="' + base)
            .replace(reHref, 'href="' + base)
            .replace(reContent, 'content="' + base);
    }
    const metaTagsAndFavicons = metaTags + '\n' + favicons;
    handlebars_1.default.registerPartial('META_TAGS', '{{{metaTags}}}');
    handlebars_1.default.registerPartial('FAVICONS', '{{{favicons}}}');
    handlebars_1.default.registerPartial('APPLICATION', '{{{metaTagsAndFavicons}}}'); // backward compatibility
    const newHTMLString = template({
        title,
        metaTags,
        favicons,
        metaTagsAndFavicons
    });
    const dest = targetFile ? targetFile : path_1.default.join(folder, 'index.html');
    fs_extra_1.default.writeFileSync(dest, newHTMLString);
    print(' done\n');
}
function replaceRootPaths(folder, files) {
    const findSrc = 'src="/';
    const reSrc = new RegExp(findSrc, 'g');
    const findDirect = '"/';
    const reDirect = new RegExp(findDirect, 'g');
    for (const file of files) {
        const filepath = path_1.default.join(folder, file);
        if (fs_extra_1.default.existsSync(filepath)) {
            let content = fs_extra_1.default.readFileSync(filepath).toString();
            if (file.endsWith('.html') || file.endsWith('.xml')) {
                content = content.replace(reSrc, 'src="../');
            }
            else {
                content = content.replace(reDirect, '"../');
            }
            fs_extra_1.default.writeFileSync(filepath, content);
        }
    }
}
async function generateApp(options) {
    const publicFolder = options.targetFolder;
    const version = options.version;
    console.log(`preparing from ${options.configPath} to ${publicFolder}...`);
    fs_extra_1.default.ensureDirSync(publicFolder);
    if (!fs_extra_1.default.existsSync(options.configPath)) {
        console.error(`The ${options.configPath} file is required to prepare the web application`);
        process.exit(1);
    }
    if (!fs_extra_1.default.existsSync(options.templateFilePath)) {
        console.error(`The ${options.templateFilePath} file is required to prepare the web application`);
        process.exit(1);
    }
    let CACHE_FILE = options.cachePath;
    if (!CACHE_FILE) {
        if (fs_extra_1.default.existsSync('node_modules')) {
            CACHE_FILE = path_1.default.join('node_modules', '.prepare-for-web-cache');
        }
        else {
            CACHE_FILE = '.prepare-for-web-cache';
        }
    }
    const now = Math.floor(Date.now() / 1000);
    const config = JSON.parse(fs_extra_1.default.readFileSync(options.configPath).toString());
    const sources = [options.configPath, options.templateFilePath];
    if (config.icon) {
        sources.push(config.icon);
    }
    if (config.maskable_icons) {
        for (const maskableIcon of config.maskable_icons) {
            sources.push(path_1.default.join(publicFolder, maskableIcon.src));
        }
    }
    const maxTime = Math.max(...sources.map((v) => {
        try {
            return fs_extra_1.default.statSync(v).mtime.getTime();
        }
        catch (e) {
            return Date.now();
        }
    }));
    let lastTime = 0;
    try {
        lastTime = fs_extra_1.default.statSync(CACHE_FILE).mtime.getTime();
    }
    catch (e) {
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
    if (!ensName &&
        config.url &&
        (config.url.endsWith('.eth.link') || config.url.endsWith('.eth.limo'))) {
        ensName = config.url.slice(0, config.url.length - 5);
    }
    if (ensName) {
        if (ensName.startsWith('https://')) {
            ensName = ensName.slice(8);
        }
        if (ensName.startsWith('http://')) {
            ensName = ensName.slice(7);
        }
        fs_extra_1.default.writeFileSync(path_1.default.join(publicFolder, 'robots.txt'), 'Dwebsite: ' + ensName);
    }
    const faviconFolder = path_1.default.join(publicFolder, 'pwa');
    fs_extra_1.default.ensureDirSync(faviconFolder);
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
        path: '/pwa/'
    });
    if (config.maskable_icons) {
        const manifestPath = path_1.default.join(faviconFolder, 'manifest.json');
        let manifest;
        try {
            manifest = JSON.parse(fs_extra_1.default.readFileSync(manifestPath).toString());
        }
        catch (e) {
            console.error(`failed to parse manifest ("${manifestPath}")`, e);
        }
        for (const maskableIcon of config.maskable_icons) {
            const maskableIconPath = path_1.default.join(publicFolder, maskableIcon.src);
            if (fs_extra_1.default.existsSync(maskableIconPath)) {
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
            }
            else {
                console.warn(`maskable icon file ("${maskableIconPath}") does not exist`);
            }
        }
        try {
            fs_extra_1.default.writeFileSync(manifestPath, JSON.stringify(manifest, null, '  '));
        }
        catch (e) {
            console.error(`failed to write manifest ("${manifestPath}")`, e);
        }
    }
    replaceRootPaths(faviconFolder, [
        'manifest.json',
        'yandex-browser-manifest.json',
        'manifest.webapp',
        'browserconfig.xml'
    ]);
    await generateBasicIndexHTML(options.templateFilePath, publicFolder, {
        title,
        faviconsOutput,
        meta: [
            { charset: 'utf-8' },
            { name: 'viewport', content: 'width=device-width,initial-scale=1' },
            {
                name: 'title',
                content: title
            },
            { name: 'description', content: config.appDescription },
            { property: 'og:type', content: 'website' },
            { property: 'og:url', content: config.url },
            { property: 'og:title', content: title },
            {
                property: 'og:description',
                content: config.appDescription
            },
            {
                property: 'og:image',
                content: previewURL
            },
            { property: 'twitter:card', content: 'summary_large_image' },
            { property: 'twitter:url', content: config.url },
            {
                property: 'twitter:title',
                content: title
            },
            {
                property: 'twitter:description',
                content: config.appDescription
            },
            {
                property: 'twitter:image',
                content: previewURL
            }
        ]
    }, options.targetFile, config.base);
    print('caching...');
    for (const source of sources) {
        try {
            fs_extra_1.default.utimesSync(source, now, now);
        }
        catch (e) { }
    }
    fs_extra_1.default.writeFileSync(CACHE_FILE, Date.now().toString());
    fs_extra_1.default.utimesSync(CACHE_FILE, now, now);
    print('done\n');
}
(async () => {
    const args = yargs_1.default.options({
        config: {
            type: 'string',
            default: 'application.json',
            description: 'path to config file'
        },
        template: {
            type: 'string',
            default: 'index.template.html',
            description: 'path to template index html file'
        },
        target: {
            type: 'string',
            default: 'public',
            description: 'path to folder where file will be generated'
        },
        targetFile: {
            type: 'string',
            default: undefined,
            description: 'file name for generated index.html'
        },
        url: { type: 'string', description: 'url of the application' },
        cache: { type: 'string', description: 'path to the cache file' },
        'app-version': { type: 'string', description: 'version of the app' },
        'use-package-version': {
            type: 'boolean',
            description: 'whether to read version for package.json'
        },
        cwd: { type: 'string', description: 'path in which to execute' },
        force: {
            type: 'boolean',
            description: 'force prepare regardless of cache'
        }
    }).argv;
    if (args['use-package-version'] && args['app-version']) {
        console.error(`cannot specify both --use-package-version and --app-version`);
        process.exit(1);
    }
    let version = undefined;
    if (args['use-package-version']) {
        const pkg = JSON.parse(fs_extra_1.default.readFileSync('./package.json').toString());
        version = pkg.version;
    }
    else if (args['app-version']) {
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
