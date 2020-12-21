const { nanoid } = require("nanoid");
const { parse, dirname } = require("path");
const { mkdir, rename } = require("fs").promises;
const glob = require("glob");

const express = require("express");
const fileUpload = require('express-fileupload');

const ffprobe = require("ffprobe");
const ffprobeStatic = require("ffprobe-static");

require('dotenv').config();
require('dotenv').config({ path: ".env.defaults" });

mkdir(process.env.MEDIA_PATH).catch(() => {});
mkdir(dirname(process.env.DATA_PATH)).catch(() => {});

const low = require('lowdb')
const FileSync = require('lowdb/adapters/FileSync');
const db = low(new FileSync(process.env.DATA_PATH, { serialize: JSON.stringify, deserialize: JSON.parse }));

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

const app = express();
app.use(fileUpload({
    abortOnLimit: true,
    uriDecodeFileNames: true,
    limits: { fileSize: 16 * 1024 * 1024 },
}));

process.on('SIGINT', () => {
    save();
    process.exit();
});

app.use(express.static("public"));
app.use("/media", express.static("media"));

async function addFromLocalFile(file) {
    const parsed = parse(file);
    const id = nanoid();
    const filename = id + parsed.ext
    const path = `${process.env.MEDIA_PATH}/${filename}`;

    await rename(file, path);
    const duration = await getMediaDurationInSeconds(path) * 1000;
    
    const info = {
        id,
        title: parsed.name,
        filename,
        duration,
    }
    
    library.set(id, info);
    save();
    return info;
}

async function addLocalFiles() {
    return new Promise((resolve, reject) => {
        glob(`${process.env.MEDIA_PATH}/dump/**/*.{mp3,mp4}`, (error, matches) => {
            if (error) reject(error);
            else resolve(Promise.all(matches.map(addFromLocalFile)));
        });
    });
}

function withSource(info) {
    return { ...info, source: process.env.MEDIA_PATH_PUBLIC + "/" + info.filename };
}

app.get("/library-update-local", async (request, response) => {
    const added = await addLocalFiles();
    response.status(201).json(added);
});

app.get("/library", (request, response) => {
    const entries = Array.from(library.values()).map(withSource);

    if (request.query.q) {
        const results = entries.filter((entry) => entry.title.includes(request.query.q));
        response.json(results);
    } else {
        response.json(entries);
    }    
});

app.get("/library/:id", (request, response) => {
    const info = library.get(request.params.id);

    if (info) {
        response.json(withSource(info));
    } else {
        response.status(404).json({ title: "Entry does not exist." });
    }
});

app.post("/library", async (request, response) => {
    if (request.body.password !== process.env.PASSWORD) {
        response.status(401).json({ title: "Invalid password." });
    } else {
        const file = request.files.media;
        const parsed = parse(file.name);
        const id = nanoid();
        const filename = id + parsed.ext
        const path = `${process.env.MEDIA_PATH}/${filename}`;

        await file.mv(path);
        const duration = await getMediaDurationInSeconds(path) * 1000;
        
        const info = {
            id,
            title: request.body.title,
            filename,
            duration,
        }
        
        library.set(id, info);
        response.json(info);
        save();
    }
});

app.put("/library/:id", (request, response) => {
    const info = library.get(request.params.id);

    if (info) {
        info.title = request.body.title || info.title;
        response.json(info);
        save();
    } else {
        response.status(404).json({ title: "Entry does not exist." });
    }
});

const listener = app.listen(process.env.PORT, "localhost", () => {
    console.log("zone library serving on " + listener.address().port);
});
