
import { pixelPadding, latLonToMeters, getFilesizeInBytes, removeTransparentTile, getTiles } from './utils/utils';
const sharp = require('sharp'); // Image manipulation library, but could be any library handles image manipulation

export function createTiles(data, process = p => { }) {

    let abort = false;

    (async () => {
        console.log('preparing data');
        const zoomLevels = [];
        const tiles = [];
        const tileInformations = [];

        for (let i = 0; i <= (data.zoom.max - data.zoom.min); i++) {
            zoomLevels.push(data.zoom.min + i);
        }

        let progress = 0;

        const i1 = latLonToMeters(data.extent.west, data.extent.south);
        const i2 = latLonToMeters(data.extent.east, data.extent.north);

        const scaleX = data.width / (i2[0] - i1[0]);
        const scaleY = data.height / (i2[1] - i1[1]);

        for (const z of zoomLevels) {

            tiles.push(new Promise(resolve => {
                getTiles(data.extent, z, tilesPerZoom => {
                    let x0 = 0, y0 = 0, rows = 0, cols = 0;
                    const N = tilesPerZoom.length;
                    const [w, s] = tilesPerZoom[0].extent4326;
                    const [, , e, n] = tilesPerZoom[N - 1].extent4326;


                    const [left, bottom] = pixelPadding(w, s, data.extent.west, data.extent.south, scaleX, scaleY);
                    const [right, top] = pixelPadding(data.extent.east, data.extent.north, e, n, scaleX, scaleY);


                    tileInformations.push({
                        location: [],
                        top,
                        bottom,
                        left,
                        right,
                        rows: 0,
                        cols: 0
                    });

                    const latest = tileInformations.length - 1;

                    tilesPerZoom.forEach(({ google: [zoom, x, y] }) => {

                        if (x0 === 0 && y0 === 0) {
                            x0 = x;
                            y0 = y;
                        }

                        const X = x - x0;
                        const Y = y0 - y;

                        rows = Math.max(rows, Y);
                        cols = Math.max(cols, X);

                        tileInformations[latest].location.push({ url: `${zoom}.${x}.${y}.png`, col: X, row: Y });
                    });

                    tileInformations[latest].rows = rows + 1;
                    tileInformations[latest].cols = cols + 1;


                    progress += 1 / (4 * zoomLevels.length);
                    process(progress);

                    resolve();
                });
            }));
        }


        Promise.all(tiles).then(() => {
            const image = sharp('map/processed.png');

            console.log('extent created, tiling started');

            (async () => {
                for (const { top, bottom, left, right, rows, cols, location } of tileInformations) {

                    if (abort) {
                        console.log('aborted');
                        break;
                    }

                    const processed = await image
                        .extend({
                            top,
                            bottom,
                            left,
                            right,
                            background: { r: 0, g: 0, b: 0, alpha: 0 }
                        })
                        .toBuffer();

                    const tileSetHeight = rows * 256;
                    const tileSetWidth = cols * 256;
                    const newImage = await sharp(processed).resize(tileSetWidth, tileSetHeight, { fit: 'contain' });

                    for (const { url, row, col } of location) {
                        const mRow = Math.abs(row - (rows - 1)) * 256;
                        const mCol = col * 256
                        const fileUrl = `map/tiles/${url}`;

                        if (abort) {
                            break;
                        }

                        newImage
                            .extract({ left: mCol, top: mRow, width: 256, height: 256 })
                            .toFile(fileUrl, () => {
                                if (abort) {
                                    return;
                                }

                                if (getFilesizeInBytes(fileUrl) <= 680) {
                                    // Transparent tiles are 680kb or less in size.
                                    removeTransparentTile(fileUrl);
                                } else {
                                    console.log(url, 'created!', 'left:', mCol, 'top:', mRow, 'width:', tileSetWidth, 'height:', tileSetHeight);
                                }
                                progress += 3 / (4 * zoomLevels.length * location.length);

                                console.log(progress);
                                process(progress);
                            });
                    }
                }
            })();
        });
    })();

    return {
        abort: () => {
            abort = true;
        }
    }
}