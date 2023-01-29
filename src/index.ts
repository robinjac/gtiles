import { createTiles } from './createTiles';

const express = require('express');
const bodyparser = require('body-parser'); // Serialize data.
const SSE = require('sse-express'); // To send events to the client.
const axios = require('axios');
const cors = require('cors'); // To enable cors.
const fs = require('fs');
const rimraf = require('rimraf'); // To delete folders.
const app = express();

let progressFn = undefined; // This will be the container for the SSE event emitter.
let tilingProcess = undefined;

// Current state (if tiling or not).
let isTiling = false;

// Keep track of current progress in percentage.
let currentProgress = 0;

// Which user is occupying the tiler.
let usedBy = undefined;

// Users authenticate token.
let authentication = undefined;

// Which server the tiling is being done for.
let server = undefined;

// Which map is selected.
let selectedMap = undefined;

// If it has tiles, they should be removed.
let hasTiles = false;

// Error has fired during upload.
let errorFired = false;

// File urls.
const url = {
    processedImage: './map/processed.png',
    originalImage: './map/original.png',
    mapData: './map/mapData.json',
}

// Object containing saved data during tiling that can be sent back to user.
const savedData = {
    img: null,
    mapData: null
}

// Tells the GUI everything is done.
function done() {
    console.log('uploading done');
    // Tiling done, start sending to the server.
    progressFn.sse('progress', {
        msg: 'close',
        tiling: false,
        usedBy,
        server
    });
    isTiling = false;
    hasTiles = false;
    currentProgress = 0;
    usedBy = undefined;
    server = undefined;
    authentication = undefined;
    selectedMap = undefined;
    errorFired = false;
}

function uploadToServer() {
    // Update map data.
    axios({
        url: `${server}/locations/maps/${selectedMap.Id}`,
        method: 'PUT',
        headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'X-Authenticate-Token': authentication
        },
        data: selectedMap
    })
        .catch(error => console.log(error))
        .then(() => {
            console.log('Map object updated.');
        });

    fs.readdir('map/tiles', (_, files) => {
        let uploaded = 0.5;
        let i = 0;
        files.forEach(file => {
            const fileurl = `map/tiles/${file}`;

            const data = `"${Buffer.from(fs.readFileSync(fileurl)).toString('base64')}"`;

            axios({
                url: `${server}/locations/maps/${selectedMap.Id}/tiles/${file}`,
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json',
                    'X-Authenticate-Token': authentication
                },
                data
            })
                .catch(res => {
                    console.log(res);
                    errorFired = true;
                    // Terminate.
                    done();
                    uploaded = 0;
                    i = 0;
                })
                .then(() => {
                    console.log('tile sent:', file);
                    if (!errorFired) {
                        if (i === files.length - 1) {
                            done();
                            uploaded = 0;
                            i = 0;
                        } else {
                            // Tile uploaded.
                            progressFn.sse('progress', {
                                msg: Math.round(uploaded * 100),
                                tiling: true,
                                usedBy,
                                server
                            });
                            uploaded += 1 / (2 * files.length);
                            i++;
                        }
                    }
                });
        });
    });
}

function startTiling(data) {
    isTiling = true;

    // Emit progress to GUI.
    progressFn.sse('progress', {
        msg: 0,
        tiling: true,
        usedBy,
        server
    });

    tilingProcess = createTiles(data, progress => {
        let currentProgress = Math.round(progress * 100);
        if (currentProgress === 100) {
            // Tiling done, start sending to the server.
            progressFn.sse('progress', {
                msg: 'uploading',
                tiling: true,
                usedBy,
                server
            });

            if (hasTiles) {
                console.log('overwriting existing tiles');
                axios({
                    url: `${server}/locations/maps/${selectedMap.Id}/tiles`,
                    method: 'DELETE',
                    headers: {
                        'Content-Type': 'application/json',
                        'Accept': 'application/json',
                        'X-Authenticate-Token': authentication
                    }
                }).then(() => {
                    // Have to wait for the tiles to be removed. In the future the response should come when
                    // the tiles are already removed.

                    let uploaded = 0;
                    const delayUpload = () => {
                        console.log('delaying...', Math.floor(uploaded * 100));
                        progressFn.sse('progress', {
                            msg: Math.floor(uploaded * 100),
                            tiling: true,
                            usedBy,
                            server
                        });

                        uploaded += 1 / 24;

                        if (uploaded <= 0.5) {
                            setTimeout(delayUpload, 5000);
                        } else {
                            uploadToServer();
                        }
                    }

                    delayUpload();
                })
            } else {
                uploadToServer();
            }

        } else {
            // Emit progress to GUI.
            progressFn.sse('progress', {
                msg: currentProgress,
                tiling: true,
                usedBy,
                server
            });
        }
    });
}

// Middlewares.
app.use(cors());

app.listen(3000, () => {
    console.log('node server running on port 3000!');
});

app.get('/GEPSTilemaster', SSE, (_, res) => {
    progressFn = res;

    // Emit progress to GUI.
    progressFn.sse('progress', {
        msg: currentProgress,
        tiling: isTiling,
        usedBy,
        server
    });
});

app.get('/status', (_, res) => {

    savedData.img = fs.existsSync(url.processedImage) ? Buffer.from(fs.readFileSync(url.processedImage)).toString('base64') : null;
    savedData.mapData = fs.existsSync(url.mapData) ? Buffer.from(fs.readFileSync(url.mapData)).toString() : null;

    res.json({ tiling: isTiling, progress: currentProgress, usedBy, server, savedData });
});

app.post('/abort', (_, res) => {
    console.log('\n abort requested.');

    if (tilingProcess) {
        tilingProcess.abort();
        tilingProcess = undefined;
        isTiling = false;
        currentProgress = 0;
        usedBy = undefined;
        server = undefined;
        hasTiles = false;
        res.json({ msg: 'Tiling aborted.' });
    } else {
        console.log("\n Can't abort, tiling has not started.");
        res.json({ msg: "Can't abort, tiling has not started." });
    }
});

app.post('/tile', bodyparser.text({ limit: '50mb' }), (req, res) => {
    console.log('Image received');
    const data = JSON.parse(req.body);
    usedBy = data.credentials.Id;
    server = data.credentials.Server;
    hasTiles = data.hasTiles;
    authentication = data.credentials.AuthenticateToken;
    selectedMap = data.selectedMap;

    const mapData = { extent: data.extent, zoom: data.zoom, center: data.center };

    // If maps folder does not exist, create it.
    if (!fs.existsSync('./map')) {
        fs.mkdirSync('./map');
    }

    if (fs.existsSync('./map/tiles')) {
        console.log('Tiles folder exists! Removing...');
        rimraf.sync('./map/tiles');
        console.log('Tiles folder has been removed.');
    } else {
        console.log('No tiles folder. Proceeding...');
    }

    // Retrive the image data from the base64 encoding.
    const base64Data = data.img.replace(/^data:image\/png;base64,/, "");

    fs.mkdirSync('./map/tiles');

    // Create a new .png image of the processed data.
    fs.writeFile('./map/processed.png', base64Data, 'base64', () => startTiling(data));

    // Save geospatial data of the new maps location in google maps.
    fs.writeFile('./map/mapdata.json', JSON.stringify(mapData), () => { });

    res.json({ 'msg': 'Image reveived and ready for processing!' });
});