const { nanoid } = require("nanoid");
const { extname } = require ("path");
const { mkdir } = require("fs");

const express = require("express");
const fileUpload = require('express-fileupload');

require('dotenv').config();

const low = require('lowdb')
const FileSync = require('lowdb/adapters/FileSync');
const db = low(new FileSync(process.env.DATA_PATH, { serialize: JSON.stringify, deserialize: JSON.parse }));

process.title = "zone library";
mkdir(process.env.MEDIA_PATH, () => {});

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
        const duration = await getMediaDurationInSeconds(path).catch(() => 0);
        
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
