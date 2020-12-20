const { nanoid } = require("nanoid");
const { extname, basename } = require ("path");
const { mkdir, rename } = require("fs").promises;
const glob = require("glob");

const express = require("express");
const fileUpload = require('express-fileupload');

const ffprobe = require("ffprobe");
const ffprobeStatic = require("ffprobe-static");

require('dotenv').config();

const low = require('lowdb')
const FileSync = require('lowdb/adapters/FileSync');
const db = low(new FileSync(process.env.DATA_PATH, { serialize: JSON.stringify, deserialize: JSON.parse }));

process.title = "zone library";
mkdir(process.env.MEDIA_PATH).catch(console.log);

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
    const id = nanoid();
    const type = extname(file);
    const path = `${process.env.MEDIA_PATH}/${id}${type}`;

    await rename(file, path);
    const duration = await getMediaDurationInSeconds(path);
    
    const info = {
        id,
        title: basename(file),
        src: path,
        duration,
    }
    
    library.set(id, info);
    save();
    return info;
}

async function addLocalFiles() {
    return new Promise((resolve, reject) => {
        glob("dump/**/*.{mp3,mp4}", (error, matches) => {
            const added = Promise.all(matches.map(addFromLocalFile));
            resolve(added);
        });
    });
}

app.get("/library-update-local", async (request, response) => {
    const added = await addLocalFiles();
    response.status(201).json(added);
});

app.get("/library", (request, response) => {
    response.json(Array.from(library.values()));
});

app.get("/library/:id", (request, response) => {
    const info = library.get(request.params.id);

    if (info) {
        response.json(info);
    } else {
        response.status(404).json({ title: "Entry does not exist." });
    }
});

app.post("/library", async (request, response) => {
    if (request.body.password !== process.env.PASSWORD) {
        response.status(401).json({ title: "Invalid password." });
    } else {
        const id = nanoid();
        const file = request.files.media;
        const type = extname(file.name);
        const path = `${process.env.MEDIA_PATH}/${id}${type}`;

        await file.mv(path);
        const duration = await getMediaDurationInSeconds(path);
        
        const info = {
            id,
            title: request.body.title,
            src: path,
            duration,
        }
        
        library.set(id, info);
        response.json(info);
        save();
    }
});

app.put("/library/:id", (request, response) => {
    
});

const listener = app.listen(process.env.PORT, "localhost", () => {
    console.log("zone library serving on " + listener.address().port);
});
