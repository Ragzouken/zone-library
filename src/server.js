const { nanoid } = require("nanoid");
const { parse, dirname, join } = require("path");
const { mkdir, rename, unlink } = require("fs").promises;
const { createWriteStream, createReadStream } = require('fs');
const glob = require("glob");
const { Readable } = require("stream");
const srt2vtt = require('srt-to-vtt');

const express = require("express");
const fileUpload = require('express-fileupload');

const ffprobe = require("ffprobe");
const ffprobeStatic = require("ffprobe-static");
const youtubedl = require('youtube-dl-exec');

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
const YOUTUBE_PATH = join(MEDIA_PATH, "youtube");

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


app.post("/library-get-youtube", requireAuth, async (request, response) => {
    const youtubeId = request.body.youtubeId;
    const youtubeUrl = `http://www.youtube.com/watch?v=${youtubeId}`;
    const path = `${YOUTUBE_PATH}/${youtubeId}.mp4`;

    try {
        const { title } = await youtubedl(youtubeUrl, {
            format: "18",
            forceIpv4: true,
            dumpSingleJson: true,
        });
        await youtubedl(youtubeUrl, {
            format: "18",
            forceIpv4: true,
            o: path,
        }, { execPath: __dirname });
        const entry = await addFromLocalFile(path);
        entry.title = title;
        response.json(entry);
    } catch (error) {
        response.status(503).json("download failed");

        statuses.set(youtubeId, "failed");
        console.log("error", error);
        console.log("DELETING", youtubeId, "FROM", path);
        await unlink(path).catch(() => {});
    }
});

app.post("/library-get-tweet", requireAuth, async (request, response) => {
    const url = request.body.url;
    const path = `${YOUTUBE_PATH}/${nanoid()}.mp4`;
    console.log(path);

    try {
        await youtubedl(url, { o: path }, { execPath: __dirname });
        const entry = await addFromLocalFile(path);
        response.json(entry);
    } catch (error) {
        response.status(503).json("download failed");
        console.log("error", error);
        await unlink(path).catch(() => {});
    }
});

const listener = app.listen(process.env.PORT, process.env.HOST, () => {
    console.log("zone library serving on http://localhost:" + listener.address().port);
});
