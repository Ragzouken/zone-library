const { nanoid } = require("nanoid");
const { parse, dirname, join } = require("path");
const { mkdir, rename, unlink } = require("fs").promises;
const glob = require("glob");

const express = require("express");
const fileUpload = require('express-fileupload');
const bodyParser = require('body-parser');

const ffprobe = require("ffprobe");
const ffprobeStatic = require("ffprobe-static");

const joi = require("joi");

require('dotenv').config();
require('dotenv').config({ path: ".env.defaults" });

mkdir(process.env.MEDIA_PATH).catch(() => {});
mkdir(dirname(process.env.DATA_PATH)).catch(() => {});

const low = require('lowdb')
const FileSync = require('lowdb/adapters/FileSync');
const db = low(new FileSync(process.env.DATA_PATH, { serialize: JSON.stringify, deserialize: JSON.parse }));

const MEDIA_PATH = process.env.MEDIA_PATH;
const DUMP_PATH = join(MEDIA_PATH, "dump");

process.title = "zone library";

db.defaults({
    entries: [],
}).write();

const library = new Map(db.get("entries"));

function save() {
    db.set("entries", Array.from(library)).write();
}

async function getMediaDurationInSeconds(file) {
    const info = await ffprobe(file, { path: ffprobeStatic.path });
    return info.streams[0].duration;
}

process.on('SIGINT', () => {
    save();
    process.exit();
});

const app = express();
app.use(fileUpload({
    abortOnLimit: true,
    uriDecodeFileNames: true,
    limits: { fileSize: 16 * 1024 * 1024 },
}));
app.use(bodyParser.json());

app.use(express.static("public"));
app.use("/media", express.static("media"));

/**
 * @param {express.Request} request 
 * @param {express.Response} response 
 * @param {express.NextFunction} next 
 */
function requireAuth(request, response, next) {
    const auth = request.headers.authorization;

    if (auth && auth.startsWith("Bearer") && auth.endsWith(process.env.PASSWORD)) {
        next();
    } else if (request.body && request.body.password === process.env.PASSWORD) {
        next();
    } else {
        response.status(401).json({ title: "Invalid password." });
    }
}

/**
 * @param {express.Request} request 
 * @param {express.Response} response 
 * @param {express.NextFunction} next 
 */
function requireLibraryEntry(request, response, next) {
    request.libraryEntry = library.get(request.params.id);

    if (request.libraryEntry) {
        next();
    } else {
        response.status(404).json({ title: "Entry does not exist." });
    }
}

async function addFromLocalFile(file) {
    const parsed = parse(file);
    const id = nanoid();
    const filename = id + parsed.ext
    const path = join(MEDIA_PATH, filename);

    await rename(file, path);
    const duration = await getMediaDurationInSeconds(path) * 1000;
    
    const info = {
        id,
        title: parsed.name,
        filename,
        duration,
        tags: [],
    }
    
    library.set(id, info);
    save();
    return info;
}

async function addLocalFiles() {
    return new Promise((resolve, reject) => {
        glob(join(DUMP_PATH, "**/*.{mp3,mp4}"), (error, matches) => {
            if (error) reject(error);
            else resolve(Promise.all(matches.map(addFromLocalFile)));
        });
    });
}

function withSource(info) {
    const source = process.env.MEDIA_PATH_PUBLIC + "/" + info.filename;
    const subtitle = info.subtitle && process.env.MEDIA_PATH_PUBLIC + "/" + info.subtitle;

    return { ...info, source, subtitle };
}

function getLocalPath(info) {
    return join(MEDIA_PATH, info.filename);
}

function searchLibrary(options) {
    let results = Array.from(library.values());
    
    if (options.tag) {
        const tag = options.tag.toLowerCase();
        results = results.filter((entry) => entry.tags.includes(tag));
    }

    if (options.q) {
        const search = options.q.toLowerCase();
        results = results.filter((entry) => entry.title.toLowerCase().includes(search));
    }

    return results;
}

app.get("/library-update-local", async (request, response) => {
    const added = await addLocalFiles();
    response.status(201).json(added);
});

app.get("/library", (request, response) => {
    let entries = searchLibrary(request.query || {});
    response.json(entries.map(withSource));
});

app.get("/library/:id", requireLibraryEntry, (request, response) => {
    response.json(withSource(request.libraryEntry));
});

app.post("/library", requireAuth, async (request, response) => {
    const file = request.files.media;
    const parsed = parse(file.name);
    const id = nanoid();
    const filename = id + parsed.ext
    const path = join(MEDIA_PATH, filename);

    await file.mv(path);
    const duration = await getMediaDurationInSeconds(path) * 1000;
    
    const info = {
        id,
        title: request.body.title,
        filename,
        duration,
        tags: [],
    }
    
    library.set(id, info);
    response.json(info);
    save();
});

app.put("/library/:id/subtitles", requireAuth, requireLibraryEntry, async (request, response) => {
    const file = request.files.subtitles;
    const id = request.params.id;
    
    const filename = id + ".vtt";
    const path = join(MEDIA_PATH, filename);
    await file.mv(path);

    request.libraryEntry.subtitle = filename;
    response.json(request.libraryEntry);
    save();
});

const tagSchema = joi.string().lowercase().min(1).max(32);
const patchSchema = joi.object({
    setTitle: joi.string().min(1).max(128),
    addTags: joi.array().items(tagSchema).default([]),
    delTags: joi.array().items(tagSchema).default([]),
});

app.patch("/library/:id", requireAuth, requireLibraryEntry, (request, response) => {
    const { value: actions, error } = patchSchema.validate(request.body);

    if (error) {
        response.status(400).json(error);
    } else {
        if (actions.setTitle) request.libraryEntry.title = actions.setTitle;

        const tags = new Set(request.libraryEntry.tags);
        actions.addTags.forEach((tag) => tags.add(tag));
        actions.delTags.forEach((tag) => tags.delete(tag));
        request.libraryEntry.tags = Array.from(tags);

        response.json(request.libraryEntry);
        save();
    }
});

app.delete("/library/:id", requireAuth, requireLibraryEntry, async (request, response) => {
    library.delete(request.libraryEntry.id);
    await unlink(getLocalPath(request.libraryEntry));
    response.json(request.libraryEntry);
    save();
});

const listener = app.listen(process.env.PORT, "localhost", () => {
    console.log("zone library serving on " + listener.address().port);
});
