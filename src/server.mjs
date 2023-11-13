import * as dotenv from 'dotenv';
dotenv.config();
dotenv.config({ path: ".env.defaults" });

process.title = "zone library";

const options = {
    host: process.env.HOST ?? "localhost",
    port: parseInt(process.env.PORT ?? "3000"), 
};

process.on('SIGINT', () => {
    save();
    process.exit();
});

import { parse, dirname, join } from "node:path";
import { mkdir, rename, unlink } from "node:fs/promises";
import { createWriteStream, createReadStream } from "node:fs";

const MEDIA_PATH = process.env.MEDIA_PATH;
const DUMP_PATH = join(MEDIA_PATH, "dump");

mkdir(MEDIA_PATH).catch(() => {});
mkdir(DUMP_PATH).catch(() => {});
mkdir(dirname(process.env.DATA_PATH)).catch(() => {});

import { LowSync } from "lowdb";
import { JSONFileSync } from "lowdb/node";

const db = new LowSync(new JSONFileSync(process.env.DATA_PATH));
db.read();
db.data ||= { entries: [] };
db.write();

const library = new Map(db.data.entries);

function save() {
    db.data.entries = Array.from(library);
    db.write();
}

async function getMediaDurationInSeconds(file) {
    const info = await ffprobe(file, { path: ffprobeStatic.path });
    return info.streams[0].duration ?? 0;
}

import express from "express";
import fileUpload from "express-fileupload";

import ffprobe from "ffprobe";
import ffprobeStatic from "ffprobe-static";

import joi from "joi";
import glob from 'glob';
import { nanoid } from 'nanoid';
import srt2vtt from 'srt-to-vtt';
import { Readable } from 'node:stream';

const app = express();
app.use(fileUpload({
    abortOnLimit: true,
    uriDecodeFileNames: true,
    limits: { fileSize: process.env.UPLOAD_LIMIT_MB * 1024 * 1024 },
}));
app.use(express.json());

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

app.param("media", (request, response, next, mediaId) => {
    request.libraryEntry = library.get(mediaId);

    if (request.libraryEntry) {
        next();
    } else {
        response.status(404).json({ title: "Entry does not exist." });
    }
});

async function addFromLocalFile(file) {
    const parsed = parse(file);
    const mediaId = nanoid();
    const filename = mediaId + parsed.ext
    const path = join(MEDIA_PATH, filename);

    await rename(file, path);
    const duration = await getMediaDurationInSeconds(path) * 1000;
    
    const info = {
        mediaId,
        title: parsed.name,
        filename,
        duration,
        tags: [],
    }
    
    library.set(mediaId, info);
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

function withSrc(info) {
    const src = process.env.MEDIA_PATH_PUBLIC + "/" + info.filename;
    const subtitle = info.subtitle && process.env.MEDIA_PATH_PUBLIC + "/" + info.subtitle;

    return { ...info, src, subtitle };
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

// general libraries API
app.get("/library", (request, response) => {
    let entries = searchLibrary(request.query || {});
    response.json(entries.map(withSrc));
});

app.get("/library/:media", (request, response) => {
    response.json(withSrc(request.libraryEntry));
});

app.get("/library/:media/status", (request, response) => {
    response.json("available");
});

app.get("/library/:media/progress", (request, response) => {
    response.json(1);
});

app.post("/library/:media/request", (request, response) => {
    response.status(202).send();
});
//

app.get("/library-limit", async (request, response) => {
    response.json({ limit: process.env.UPLOAD_LIMIT_MB * 1024 * 1024 });
});

app.post("/library/auth", requireAuth, async (request, response) => {
    response.json({ authorized: true });
});

app.post("/library", requireAuth, async (request, response) => {
    const file = request.files.media;
    const parsed = parse(file.name);
    const mediaId = nanoid();
    const filename = mediaId + parsed.ext
    const path = join(MEDIA_PATH, filename);

    await file.mv(path);
    const duration = await getMediaDurationInSeconds(path) * 1000;
    
    const info = {
        mediaId,
        title: request.body.title,
        filename,
        duration,
        tags: [],
    }
    
    library.set(mediaId, info);
    response.json(info);
    save();
});

app.put("/library/:media/subtitles", requireAuth, async (request, response) => {
    const file = request.files.subtitles;
    const filename = request.libraryEntry.mediaId + ".vtt";
    const path = join(MEDIA_PATH, filename);
    
    if (file.name.endsWith(".vtt")) {
        await file.mv(path);
    } else {
        // don't know how to await this properly
        const read = file.data 
                   ? Readable.from(file.data.toString()) 
                   : createReadStream(file.tempFilePath);
        read
        .pipe(srt2vtt())
        .pipe(createWriteStream(path))
        .on("error", (e) => console.log("SUBTITLE FAILED: ", e));
    }

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

app.patch("/library/:media", requireAuth, (request, response) => {
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

app.delete("/library/:media", requireAuth, async (request, response) => {
    library.delete(request.libraryEntry.mediaId);
    await unlink(getLocalPath(request.libraryEntry));
    response.json(request.libraryEntry);
    save();
});

const listener = app.listen(options.port, options.host, () => {
    console.log(`${process.title} serving on http://${listener.address().address}:${listener.address().port}`);
});
